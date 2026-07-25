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
images = []
for i in range(max_pages):
    out = os.path.join(tmp_dir, f"p{i:04d}.png")
    doc[i].get_pixmap(matrix=mat).save(out)
    images.append(out)
    # Extract embedded images from this page
    if output_dir:
        for img_index, xref in enumerate(doc.get_page_images(i)):
            xref_id = xref[0]
            pix = fitz.Pixmap(doc, xref_id)
            if pix.n > 4:
                pix = fitz.Pixmap(fitz.csRGB, pix)
            img_name = f"page_{i+1:04d}_img_{img_index}.png"
            pix.save(os.path.join(output_dir, img_name))
            pix = None
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
from PIL import Image

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

# Get page dimensions and compute bbox scale factor
# Model processes at image_size=1024 on longest side; bbox is in model space
tmp_img_0 = os.path.join(tmp_dir, "p0000.png")
page_w, page_h = 2480, 3508
if os.path.exists(tmp_img_0):
    with Image.open(tmp_img_0) as im:
        page_w, page_h = im.size

# Generate positioned HTML per page
page_divs = []
for pi, blocks in enumerate(pages):
    png_path = os.path.join(tmp_dir, f"p{pi:04d}.png")
    parts = [f'<div class="page" style="position:relative;width:{page_w}px;height:{page_h}px;margin:0 auto;overflow:hidden;background:#fff;">']

    # Background: PDF page screenshot (copy to output_dir for browser access)
    bg_src = ""
    if output_dir and os.path.exists(png_path):
        bg_name = f"page_bg_{pi:04d}.png"
        import shutil as _su
        _su.copy(png_path, os.path.join(output_dir, bg_name))
        bg_src = bg_name
    if bg_src:
        parts.append(f'<img src="{bg_src}" style="position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none;">')

    # Foreground: bbox-positioned blocks (bbox in page-pixel space)
    for bi, b in enumerate(blocks):
        x1,y1,x2,y2 = b["bbox"]
        w,h = x2-x1, y2-y1
        ct = b["content"]
        tp = b["type"]

        if tp == "table":
            sty = f"position:absolute;left:{x1}px;top:{y1}px;width:{w}px;height:{h}px;overflow:auto;z-index:2;"
            parts.append(f'<div class="det-table" style="{sty}">{ct}</div>')
        elif tp in ("header","footer","page_number"):
            sty = f"position:absolute;left:{x1}px;top:{y1}px;width:{w}px;z-index:2;"
            if tp == "header": sty += "color:#888;font-size:10px;"
            if tp == "footer": sty += "color:#888;font-size:9px;"
            if tp == "page_number": sty += "color:#888;font-size:9px;text-align:right;"
            safe = ct.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
            parts.append(f'<div style="{sty}">{safe}</div>')
        elif tp == "image":
            sty = f"position:absolute;left:{x1}px;top:{y1}px;width:{w}px;height:{h}px;z-index:2;"
            crop_name = f"crop_p{pi:04d}_{bi}.png"
            crop_path = os.path.join(output_dir, crop_name) if output_dir else ""
            if os.path.exists(png_path):
                try:
                    Image.open(png_path).crop((x1,y1,x2,y2)).save(crop_path)
                except: crop_path = ""
            src = os.path.basename(crop_path) if crop_path and os.path.exists(crop_path) else ""
            parts.append(f'<div class="det-image" style="{sty}"><img src="{src}" style="width:100%;height:100%;"></div>')
        else:
            sty = f"position:absolute;left:{x1}px;top:{y1}px;width:{w}px;z-index:2;font-size:11px;line-height:1.4;"
            safe = ct.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
            parts.append(f'<div style="{sty}">{safe}</div>')

    parts.append("</div>")
    page_divs.append("\\n".join(parts))

css = """<style>
body{margin:0;padding:20px 0;background:#666;font-family:sans-serif;}
.det-table table{border-collapse:collapse;width:100%;table-layout:fixed;background:rgba(255,255,255,0.85);word-wrap:break-word;}
.det-table td,.det-table th{border:1px solid #aaa;padding:2px 4px;font-size:11px;}
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
