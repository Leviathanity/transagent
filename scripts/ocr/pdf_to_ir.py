"""PDF → Document IR JSON via Unlimited-OCR.

Usage: python pdf_to_ir.py <model_path> '<json args>'

Emits a JSON document on stdout:
{
  "pages": [{
    "width": 1024, "height": <PAGE_H>,
    "blocks": [{
      "type": "paragraph|title|header|footer|page_number|table|image",
      "bbox": [x1, y1, x2, y2],            # display space
      "text": "...",                        # text blocks only
      "html": "<table>...",                 # table blocks only
      "src": "emb_p0000_n0.png",            # image blocks only
      "alt": "...",
      "font": {"family": "...", "size": 12.0, "bold": false, "italic": false, "color": "#000000"},
      "table_images": [{"src": "...", "left": .., "top": .., "width": .., "height": ..}]
    }]
  }]
}
"""

import io
import json
import os
import re
import sys
import tempfile

import fitz  # PyMuPDF
import torch
from PIL import Image
from transformers import AutoModel, AutoTokenizer

os.environ["TOKENIZERS_PARALLELISM"] = "false"

model_path = sys.argv[1]
args = json.loads(sys.argv[2])
pdf_path = args["pdf_path"]
output_dir = args.get("output_dir", "")

tok = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
model = AutoModel.from_pretrained(
    model_path,
    trust_remote_code=True,
    use_safetensors=True,
    dtype=torch.bfloat16,
).eval().cuda()

doc = fitz.open(pdf_path)
tmp_dir = tempfile.mkdtemp(prefix="ptl_ocr_")
mat = fitz.Matrix(300 / 72, 300 / 72)
max_pages = args.get("max_pages", len(doc))

# Compute page dimensions: PDF pt → 300 DPI px → model/display space
PDF_PT_W = doc[0].rect.width
PDF_PT_H = doc[0].rect.height
page_w = int(PDF_PT_W * 300 / 72)
page_h = int(PDF_PT_H * 300 / 72)
PDF_TO_PAGE = 300 / 72
MODEL_SIZE = 1024
PAGE_W = 1024
PAGE_H = int(PAGE_W * (page_h / page_w))

images = []
embedded_images = []  # (page_idx, crop_filename, model_bbox)
for i in range(max_pages):
    out = os.path.join(tmp_dir, f"p{i:04d}.png")
    doc[i].get_pixmap(matrix=mat).save(out)
    images.append(out)
    if output_dir:
        for img_info in doc[i].get_image_info():
            bbox_pdf = img_info["bbox"]
            mx1 = bbox_pdf[0] * PDF_TO_PAGE / (page_w / MODEL_SIZE)
            my1 = bbox_pdf[1] * PDF_TO_PAGE / (page_h / MODEL_SIZE)
            mx2 = bbox_pdf[2] * PDF_TO_PAGE / (page_w / MODEL_SIZE)
            my2 = bbox_pdf[3] * PDF_TO_PAGE / (page_h / MODEL_SIZE)
            img_name = f"emb_p{i:04d}_n{img_info['number']}.png"
            img_path = os.path.join(output_dir, img_name)
            if not os.path.exists(img_path):
                try:
                    crop_x1 = int(bbox_pdf[0] * PDF_TO_PAGE)
                    crop_y1 = int(bbox_pdf[1] * PDF_TO_PAGE)
                    crop_x2 = int(bbox_pdf[2] * PDF_TO_PAGE)
                    crop_y2 = int(bbox_pdf[3] * PDF_TO_PAGE)
                    Image.open(out).crop((crop_x1, crop_y1, crop_x2, crop_y2)).save(img_path)
                except Exception:
                    continue
            embedded_images.append((i, img_name, (mx1, my1, mx2, my2)))

# PDF text spans with font info (model space) for dual-path styling
page_fonts = []
for i in range(max_pages):
    spans = []
    for b in doc[i].get_text("dict")["blocks"]:
        if b["type"] != 0:
            continue
        for line in b["lines"]:
            for sp in line["spans"]:
                t = sp["text"].strip()
                if not t:
                    continue
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
    model.infer(
        tok,
        prompt="<image>document parsing.",
        image_file=img,
        output_path="/tmp/ptl_ocr_out",
        base_size=1024,
        image_size=1024,
        crop_mode=False,
        max_length=32768,
        no_repeat_ngram_size=35,
        ngram_window=128,
    )
    print("<PAGE_BREAK>", flush=True)
sys.stdout = old_stdout
raw = buf.getvalue()

DET_RE = re.compile(
    r"<\|det\|>(\w+)\s+\[(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\]\s*<\|/det\|>"
)


def parse_blocks(text):
    blocks = []
    pos = 0
    while pos < len(text):
        m = DET_RE.search(text, pos)
        if not m:
            break
        t = m.group(1)
        x1, y1, x2, y2 = (int(m.group(i)) for i in range(2, 6))
        tag_end = m.end()
        next_m = DET_RE.search(text, tag_end)
        content = text[tag_end:next_m.start()].strip() if next_m else text[tag_end:].strip()
        blocks.append({"type": t, "bbox": (x1, y1, x2, y2), "content": content})
        pos = next_m.start() if next_m else len(text)
    return blocks


def dedup_blocks(blocks, threshold=15):
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


pages_raw = re.split(r"<PAGE_BREAK>\s*", raw)
pages = [dedup_blocks(parse_blocks(p)) for p in pages_raw if p.strip()]


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


def fmt_color(c):
    return f"#{c:06x}" if c else "black"


# Match OCR blocks to PDF font spans
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
            b["font"] = {
                "family": css_font_name(best["font"]),
                "size": round(best["size"] * (PAGE_W / PDF_PT_W), 1),
                "bold": best["bold"],
                "italic": best["italic"],
                "color": fmt_color(best["color"]),
            }

# Match embedded PDF images to OCR blocks
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
                b["src"] = img_file
                b["img_bbox"] = img_bbox
                break

# Unmatched embedded images become standalone image blocks
for pi, page_blocks in enumerate(pages):
    page_imgs = [(f, b) for (p, f, b) in embedded_images if p == pi]
    if not page_imgs:
        continue
    matched = {b.get("src") for b in page_blocks if b.get("src")}
    for img_file, img_bbox in page_imgs:
        if img_file not in matched:
            page_blocks.append({
                "type": "image",
                "bbox": img_bbox,
                "content": "",
                "src": img_file,
                "img_bbox": img_bbox,
            })

# Detect vector graphics in gaps between text blocks
for pi, page_blocks in enumerate(pages):
    occupied = []
    for b in page_blocks:
        bb = b.get("img_bbox", b["bbox"])
        y1 = bb[1] / MODEL_SIZE * PAGE_H
        y2 = bb[3] / MODEL_SIZE * PAGE_H
        occupied.append((y1, y2))
    occupied.sort(key=lambda x: x[0])

    page_tables_bb = [b["bbox"] for b in page_blocks if b.get("type") == "table"]
    png_path = os.path.join(tmp_dir, f"p{pi:04d}.png")
    if not os.path.exists(png_path):
        continue

    prev_end = 60
    for y1, y2 in occupied:
        gap_h = y1 - prev_end
        if gap_h >= 120 and gap_h <= PAGE_H * 0.7:
            my1 = prev_end / PAGE_H * MODEL_SIZE
            my2 = y1 / PAGE_H * MODEL_SIZE
            gap_bbox = (0, my1, MODEL_SIZE, my2)
            gap_area = MODEL_SIZE * (my2 - my1)
            overlaps_table = False
            for tb in page_tables_bb:
                ov = bbox_overlap(gap_bbox, tb)
                tb_bottom = tb[3] / MODEL_SIZE * PAGE_H
                if ov / max(gap_area, 1) > 0.3 or (prev_end - tb_bottom) < 200:
                    overlaps_table = True
                    break
            if overlaps_table:
                prev_end = max(prev_end, y2)
                continue
            ry1 = int(prev_end / PAGE_H * page_h)
            ry2 = int(y1 / PAGE_H * page_h)
            try:
                full = Image.open(png_path)
                crop = full.crop((0, ry1, page_w, ry2))
                gray = crop.convert("L")
                pixels = list(gray.getdata())
                non_white = sum(1 for p in pixels if p < 235)
                if non_white > len(pixels) * 0.03:
                    crop_name = f"vect_p{pi:04d}_g{len(page_blocks)}.png"
                    crop_path = os.path.join(output_dir, crop_name) if output_dir else ""
                    crop.save(crop_path)
                    page_blocks.append({
                        "type": "image",
                        "bbox": gap_bbox,
                        "content": "",
                        "src": crop_name,
                        "img_bbox": gap_bbox,
                    })
            except Exception:
                pass
        prev_end = max(prev_end, y2)

# Remove text blocks overlapping images
for pi, page_blocks in enumerate(pages):
    image_bboxes = [b["img_bbox"] for b in page_blocks if b.get("img_bbox")]
    if not image_bboxes:
        continue
    kept = []
    for b in page_blocks:
        if b.get("img_bbox") and b["type"] == "image":
            kept.append(b)
            continue
        ob = b["bbox"]
        ob_area = (ob[2] - ob[0]) * (ob[3] - ob[1])
        if ob_area <= 0:
            kept.append(b)
            continue
        overlap_ratio = 0.0
        for ib in image_bboxes:
            ov = bbox_overlap(ob, ib)
            overlap_ratio = max(overlap_ratio, ov / ob_area)
        if overlap_ratio < 0.5:
            kept.append(b)
    pages[pi] = kept

# Embed images inside overlapping table blocks
for pi, page_blocks in enumerate(pages):
    tables = [(i, b) for i, b in enumerate(page_blocks) if b.get("type") == "table"]
    img_indices = set()
    for ti, tb in tables:
        tbb = tb["bbox"]
        tb["table_images"] = []
        for ii, ib in enumerate(page_blocks):
            if not ib.get("img_bbox") or ib["type"] != "image":
                continue
            ibb = ib["img_bbox"]
            ov = bbox_overlap(tbb, ibb)
            ia = (ibb[2] - ibb[0]) * (ibb[3] - ibb[1])
            if ia > 0 and ov / ia > 0.5:
                tb["table_images"].append({
                    "src": ib["src"],
                    "left": round((ibb[0] - tbb[0]) / MODEL_SIZE * PAGE_W, 1),
                    "top": round((ibb[1] - tbb[1]) / MODEL_SIZE * PAGE_H, 1),
                    "width": round((ibb[2] - ibb[0]) / MODEL_SIZE * PAGE_W, 1),
                    "height": round((ibb[3] - ibb[1]) / MODEL_SIZE * PAGE_H, 1),
                })
                img_indices.add(ii)
    pages[pi] = [b for i, b in enumerate(page_blocks) if i not in img_indices]


def scale_coord(c, dim):
    return int(c / MODEL_SIZE * dim)


out_pages = []
for pi, page_blocks in enumerate(pages):
    blocks_out = []
    for b in page_blocks:
        bb = b.get("img_bbox", b["bbox"])
        entry = {
            "type": b["type"],
            "bbox": [
                scale_coord(bb[0], PAGE_W),
                scale_coord(bb[1], PAGE_H),
                scale_coord(bb[2], PAGE_W),
                scale_coord(bb[3], PAGE_H),
            ],
        }
        if b.get("font"):
            entry["font"] = b["font"]
        if b["type"] == "image":
            entry["src"] = b.get("src", "")
            entry["alt"] = b.get("content", "").replace('"', "&quot;")
        elif b["type"] == "table":
            entry["html"] = b["content"]
            if b.get("table_images"):
                entry["table_images"] = b["table_images"]
        else:
            entry["text"] = b["content"]
        blocks_out.append(entry)
    out_pages.append({"width": PAGE_W, "height": PAGE_H, "blocks": blocks_out})

print(json.dumps({"pages": out_pages}, ensure_ascii=False))

import shutil

shutil.rmtree(tmp_dir, ignore_errors=True)
