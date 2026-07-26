import { execa } from "execa";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { StageResult } from "../types/pipeline.js";

const WSL_PYTHON = "/root/ptl-ocr-env/bin/python3";
const OCR_MODEL_PATH =
  "/root/models/Unlimited-OCR/models/PaddlePaddle--Unlimited-OCR/snapshots/master";

/** WSL-accessible path to the Python script (relative to project root) */
function wslScriptPath(): string {
  // From WSL, C:\Users\... becomes /mnt/c/Users/...
  const abs = resolve("tmp_ocr.py");
  return abs
    .replace(/^([A-Za-z]):\\/, (_m, d: string) => `/mnt/${d.toLowerCase()}/`)
    .replace(/\\/g, "/");
}

const PYTHON_SCRIPT = `
import torch, os, sys, io, re, json, fitz, tempfile
from PIL import Image

os.environ["TOKENIZERS_PARALLELISM"] = "false"
model_path = sys.argv[1]
args = json.loads(sys.argv[2])
pdf_path = args["pdf_path"]
output_dir = args.get("output_dir", "")

from transformers import AutoModel, AutoTokenizer

tok = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
model = AutoModel.from_pretrained(model_path, trust_remote_code=True,
    use_safetensors=True, dtype=torch.bfloat16).eval().cuda()

# Convert PDF to images
doc = fitz.open(pdf_path)
tmp_dir = tempfile.mkdtemp(prefix="ptl_ocr_")
mat = fitz.Matrix(300 / 72, 300 / 72)
max_pages = min(len(doc), 5)

# Compute 300 DPI page dimensions from the PDF page rect
PDF_PT_W = doc[0].rect.width   # e.g. 595
PDF_PT_H = doc[0].rect.height  # e.g. 842
page_w = int(PDF_PT_W * 300 / 72)  # 2481
page_h = int(PDF_PT_H * 300 / 72)  # 3508
PDF_TO_PAGE = 300 / 72  # PDF point → 300 DPI pixel
MODEL_SIZE = 1024

images = []
embedded_images = []  # (page_idx, crop_filename, model_bbox)
for i in range(max_pages):
    out = os.path.join(tmp_dir, f"p{i:04d}.png")
    doc[i].get_pixmap(matrix=mat).save(out)
    images.append(out)
    # Extract embedded images via page render crops (get_image_info → PDF pt → 300 DPI px)
    if output_dir:
        for img_info in doc[i].get_image_info():
            bbox_pdf = img_info["bbox"]
            # Convert PDF point bbox to 300 DPI pixel coords for cropping
            crop_x1 = int(bbox_pdf[0] * PDF_TO_PAGE)
            crop_y1 = int(bbox_pdf[1] * PDF_TO_PAGE)
            crop_x2 = int(bbox_pdf[2] * PDF_TO_PAGE)
            crop_y2 = int(bbox_pdf[3] * PDF_TO_PAGE)
            # Convert PDF point bbox to model space [0,1024] for overlap matching
            mx1 = bbox_pdf[0] * PDF_TO_PAGE / (page_w / MODEL_SIZE)
            my1 = bbox_pdf[1] * PDF_TO_PAGE / (page_h / MODEL_SIZE)
            mx2 = bbox_pdf[2] * PDF_TO_PAGE / (page_w / MODEL_SIZE)
            my2 = bbox_pdf[3] * PDF_TO_PAGE / (page_h / MODEL_SIZE)
            img_name = f"emb_p{i:04d}_n{img_info['number']}.png"
            img_path = os.path.join(output_dir, img_name)
            if not os.path.exists(img_path):
                try:
                    Image.open(out).crop((crop_x1, crop_y1, crop_x2, crop_y2)).save(img_path)
                except:
                    continue
            embedded_images.append((i, img_name, (mx1, my1, mx2, my2)))

# ── Extract PDF text with font info for dual-path styling ──
page_fonts = []
for i in range(max_pages):
    page = doc[i]
    blocks = page.get_text("dict")["blocks"]
    spans = []
    for b in blocks:
        if b["type"] != 0:
            continue
        for line in b["lines"]:
            for sp in line["spans"]:
                t = sp["text"].strip()
                if not t:
                    continue
                # Convert PDF point bbox to model space
                bx1 = sp["bbox"][0] * PDF_TO_PAGE / (page_w / MODEL_SIZE)
                by1 = sp["bbox"][1] * PDF_TO_PAGE / (page_h / MODEL_SIZE)
                bx2 = sp["bbox"][2] * PDF_TO_PAGE / (page_w / MODEL_SIZE)
                by2 = sp["bbox"][3] * PDF_TO_PAGE / (page_h / MODEL_SIZE)
                spans.append({
                    "text": t,
                    "bbox": (bx1, by1, bx2, by2),
                    "font": sp["font"],
                    "size": sp["size"],
                    "bold": bool(sp["flags"] & 32),
                    "italic": bool(sp["flags"] & 2),
                    "color": sp["color"],
                })
    page_fonts.append(spans)
doc.close()

# Sequential inference (CUDA + sys.stdout not thread-safe for parallelism)
os.makedirs("/tmp/ptl_ocr_out", exist_ok=True)
old_stdout = sys.stdout
sys.stdout = buf = io.StringIO()
for img in images:
    model.infer(tok, prompt="<image>document parsing.",
        image_file=img, output_path="/tmp/ptl_ocr_out",
        base_size=1024, image_size=1024, crop_mode=False,
        max_length=32768, no_repeat_ngram_size=35, ngram_window=128)
    print("<PAGE_BREAK>", flush=True)
sys.stdout = old_stdout
raw = buf.getvalue()
 
# ── Parse det tags into positioned blocks ──

DET_RE = re.compile(
    r"<\\|det\\|>(\\w+)\\s+\\[(\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)\\]\\s*<\\|/det\\|>"
)

def parse_blocks(text):
    blocks = []
    pos = 0
    while pos < len(text):
        m = DET_RE.search(text, pos)
        if not m:
            break
        t = m.group(1)
        x1,y1,x2,y2 = int(m.group(2)),int(m.group(3)),int(m.group(4)),int(m.group(5))
        tag_end = m.end()
        next_m = DET_RE.search(text, tag_end)
        content = text[tag_end:next_m.start()].strip() if next_m else text[tag_end:].strip()
        blocks.append({"type":t,"bbox":(x1,y1,x2,y2),"content":content})
        pos = next_m.start() if next_m else len(text)
    return blocks

def dedup_blocks(blocks, threshold=15):
    """Remove near-duplicate blocks (same type, same text, close positions)."""
    if not blocks:
        return blocks
    kept = []
    for b in blocks:
        text = b["content"].strip()
        if not text:
            continue
        cx = (b["bbox"][0] + b["bbox"][2]) // 2
        cy = (b["bbox"][1] + b["bbox"][3]) // 2
        dup = False
        for k in kept:
            if b["type"] != k["type"]:
                continue
            k_cx = (k["bbox"][0] + k["bbox"][2]) // 2
            k_cy = (k["bbox"][1] + k["bbox"][3]) // 2
            if abs(cx - k_cx) < threshold and abs(cy - k_cy) < threshold:
                if b["content"].strip() == k["content"].strip():
                    dup = True
                    break
        if not dup:
            kept.append(b)
    return kept

# Group by page
pages_raw = re.split(r"<PAGE_BREAK>\\s*", raw)
pages = [dedup_blocks(parse_blocks(p)) for p in pages_raw if p.strip()]

# Output page dimensions (display scale)
PAGE_W = 1024
PAGE_H = int(PAGE_W * (page_h / page_w))

# ── Match OCR blocks to PDF font spans ──
def bbox_overlap(a, b):
    dx = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    dy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    return dx * dy

def span_area(s):
    return (s[2] - s[0]) * (s[3] - s[1])

def css_font_name(pdf_name):
    n = pdf_name.lower()
    if "times" in n:
        return "'Times New Roman',Times,serif"
    if "calibri" in n:
        return "Calibri,'Segoe UI',Arial,sans-serif"
    if "arial" in n:
        return "Arial,Helvetica,sans-serif"
    if "source" in n:
        return "'Source Sans Pro','Segoe UI',sans-serif"
    if "hand" in n or "adobe" in n:
        return "'Brush Script MT',cursive"
    return f"'{pdf_name}',sans-serif"

for pi, blocks in enumerate(pages):
    spans = page_fonts[pi] if pi < len(page_fonts) else []
    for b in blocks:
        if b["type"] == "image":
            continue
        ob = b["bbox"]
        matching = []
        for s in spans:
            oa = bbox_overlap(ob, s["bbox"])
            if oa > 0 and oa / span_area(s["bbox"]) > 0.25:
                matching.append((oa, s))
        if matching:
            matching.sort(key=lambda x: -x[0])
            best = matching[0][1]
            b["font_family"] = css_font_name(best["font"])
            b["font_size"] = best["size"] * (PAGE_W / PDF_PT_W)
            b["bold"] = best["bold"]
            b["italic"] = best["italic"]
            b["font_color"] = best["color"]

# ── Match embedded PDF images to OCR blocks ──
for pi, page_blocks in enumerate(pages):
    page_imgs = [(f, b) for (p, f, b) in embedded_images if p == pi]
    if not page_imgs:
        continue
    for b in page_blocks:
        if b["type"] == "table":
            continue
        ob = b["bbox"]
        ob_area = (ob[2] - ob[0]) * (ob[3] - ob[1])
        if ob_area <= 0:
            continue
        for img_file, img_bbox in page_imgs:
            overlap = bbox_overlap(ob, img_bbox)
            if overlap / ob_area > 0.3:
                b["type"] = "image"
                b["embedded_img"] = img_file
                break

# Compute page dimensions for reconstruction (already set above)

def scale_coord(c, dim):
    return int(c / MODEL_SIZE * dim)

def fmt_color(c):
    return f"#{c:06x}" if c and c != 0 else "black"

# Generate positioned HTML per page
page_divs = []
for pi, blocks in enumerate(pages):
    parts = [f'<div class="page" style="position:relative;width:{PAGE_W}px;height:{PAGE_H}px;margin:0 auto;overflow:hidden;background:#fff;">']

    for bi, b in enumerate(blocks):
        x1,y1,x2,y2 = b["bbox"]
        ct = b["content"]
        tp = b["type"]

        sx1 = scale_coord(x1, PAGE_W)
        sy1 = scale_coord(y1, PAGE_H)
        sx2 = scale_coord(x2, PAGE_W)
        sy2 = scale_coord(y2, PAGE_H)
        sw = sx2 - sx1
        sh = sy2 - sy1

        # Build font style from matched PDF font info (or fallback by type)
        ff = b.get("font_family", "")
        fs = b.get("font_size", None)
        fb = "bold" if b.get("bold") else "normal"
        fi = "italic" if b.get("italic") else "normal"
        fc = fmt_color(b["font_color"]) if "font_color" in b else ""
        if not fs:
            fs = 10.0 if tp in ("header","footer","page_number") else 12.0
        font_sty = ""
        if ff: font_sty += f"font-family:{ff};"
        font_sty += f"font-size:{fs:.1f}px;font-weight:{fb};font-style:{fi};"
        if fc: font_sty += f"color:{fc};"

        if tp == "table":
            sty = f"position:absolute;left:{sx1}px;top:{sy1}px;z-index:2;"
            parts.append(f'<div class="det-table" style="{sty}">{ct}</div>')
        elif tp in ("header", "footer", "page_number"):
            safe = ct.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
            if "\\n" in ct:
                cpl = max(1, int(sw / ((fs or 12) * 0.6)))
                nlines = 0
                for part in ct.split("\\n"):
                    nlines += max(1, -(-len(part) // cpl))
                min_h = int(nlines * (fs or 12) * 1.5)
                sty = f"position:absolute;left:{sx1}px;top:{sy1}px;width:{sw}px;max-height:{min_h}px;z-index:2;white-space:pre-line;overflow:hidden;" + font_sty
            else:
                sty = f"position:absolute;left:{sx1}px;top:{sy1}px;width:{sw}px;z-index:2;white-space:nowrap;overflow:visible;" + font_sty
            if tp == "page_number": sty += "text-align:right;"
            parts.append(f'<div style="{sty}">{safe}</div>')
        elif tp == "image":
            sty = f"position:absolute;left:{sx1}px;top:{sy1}px;width:{sw}px;height:{sh}px;z-index:2;"
            if b.get("embedded_img"):
                src = b["embedded_img"]
            else:
                crop_name = f"crop_p{pi:04d}_{bi}.png"
                crop_path = os.path.join(output_dir, crop_name) if output_dir else ""
                png_path = os.path.join(tmp_dir, f"p{pi:04d}.png")
                if os.path.exists(png_path):
                    try:
                        Image.open(png_path).crop((x1,y1,x2,y2)).save(crop_path)
                    except: crop_path = ""
                src = os.path.basename(crop_path) if crop_path and os.path.exists(crop_path) else ""
            alt = b.get("content", "").replace('"', "&quot;")
            parts.append(f'<div class="det-image" style="{sty}"><img src="{src}" alt="{alt}" style="width:100%;height:100%;"></div>')
        elif tp == "title":
            safe = ct.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
            if "\\n" in ct:
                cpl = max(1, int(sw / ((fs or 12) * 0.6)))
                nlines = 0
                for part in ct.split("\\n"):
                    nlines += max(1, -(-len(part) // cpl))
                min_h = int(nlines * (fs or 12) * 1.5)
                sty = f"position:absolute;left:{sx1}px;top:{sy1}px;width:{sw}px;max-height:{min_h}px;z-index:2;white-space:pre-line;overflow:hidden;" + font_sty
            else:
                sty = f"position:absolute;left:{sx1}px;top:{sy1}px;width:{sw}px;z-index:2;white-space:nowrap;overflow:hidden;" + font_sty
            parts.append(f'<div style="{sty}">{safe}</div>')
        else:
            # No explicit width — let text flow naturally to avoid wrapping-induced overlap
            sty = f"position:absolute;left:{sx1}px;top:{sy1}px;z-index:2;" + font_sty + "line-height:1.5;"
            safe = ct.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
            parts.append(f'<div style="{sty}">{safe}</div>')

    parts.append("</div>")
    page_divs.append("\\n".join(parts))

css = """<style>
body{margin:0;padding:20px 0;background:#666;font-family:sans-serif;}
.page{box-shadow:0 2px 8px rgba(0,0,0,0.15);margin-bottom:24px;}
.det-table table{border-collapse:collapse;width:auto;table-layout:fixed;word-wrap:break-word;}
.det-table td,.det-table th{border:1px solid #888;padding:3px 6px;font-size:12px;overflow-wrap:break-word;}
.det-table th{background:#e8e8e8;font-weight:bold;}
.det-image img{max-width:100%;height:auto;}
</style>"""

html = f"<!DOCTYPE html>\\n<html><head><meta charset=\\"utf-8\\">{css}</head><body>\\n" + "\\n".join(page_divs) + "\\n</body></html>"
print(html)

import shutil
shutil.rmtree(tmp_dir, ignore_errors=True)
`.trim();

export async function stageConvertWithOcr(
  inputPath: string,
  outputPath?: string,
): Promise<StageResult> {
  try {
    const absInput = resolve(inputPath);
    const wslInputPath = absInput
      .replace(/^([A-Za-z]):\\/, (_m: string, d: string) => `/mnt/${d.toLowerCase()}/`)
      .replace(/\\/g, "/");
    const scriptPath = wslScriptPath();

    // Write inference script to project root (accessible from WSL as /mnt/c/...)
    await writeFile("tmp_ocr.py", PYTHON_SCRIPT, "utf-8");

    const outputDir = outputPath ? dirname(outputPath) : "";
    const wslOutputDir = outputDir
      ? outputDir.replace(/^([A-Za-z]):\\/, (_m: string, d: string) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, "/")
      : "";
    const argsJson = JSON.stringify({ pdf_path: wslInputPath, output_dir: wslOutputDir });

    const result = await execa(
      "wsl",
      [WSL_PYTHON, scriptPath, OCR_MODEL_PATH, argsJson],
      {
        timeout: 1_200_000,  // 20 min for 33 pages
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    if (result.exitCode !== 0) {
      return {
        stage: "convert",
        success: false,
        error: result.stderr || `OCR exited with code ${result.exitCode}`,
      };
    }

    if (outputPath) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, result.stdout, "utf-8");
      return { stage: "convert", success: true, outputPath };
    }

    return { stage: "convert", success: true, output: result.stdout };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { stage: "convert", success: false, error: `OCR failed: ${message}` };
  }
}
