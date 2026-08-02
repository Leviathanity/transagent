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
import hashlib
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
max_pages = args.get("max_pages", len(doc))

# Compute page dimensions: PDF pt → DPI px → model/display space
PDF_PT_W = doc[0].rect.width
PDF_PT_H = doc[0].rect.height
dpi = args.get("dpi", 300)
PDF_TO_PAGE = dpi / 72
MODEL_SIZE = args.get("model_size", 1024)
PAGE_W = args.get("page_width", 1024)
page_w = int(PDF_PT_W * PDF_TO_PAGE)
page_h = int(PDF_PT_H * PDF_TO_PAGE)
PAGE_H = int(PAGE_W * (page_h / page_w))
mat = fitz.Matrix(PDF_TO_PAGE, PDF_TO_PAGE)

images = []
image_resources = {}  # identity key -> resource (file_name/xref/hash/placements/kind)
for i in range(max_pages):
    out = os.path.join(tmp_dir, f"p{i:04d}.png")
    doc[i].get_pixmap(matrix=mat).save(out)
    images.append(out)
    if output_dir:
        for img_info in doc[i].get_image_info(xrefs=True, hashes=True):
            bbox_pdf = img_info["bbox"]
            mx1 = bbox_pdf[0] * PDF_TO_PAGE / (page_w / MODEL_SIZE)
            my1 = bbox_pdf[1] * PDF_TO_PAGE / (page_h / MODEL_SIZE)
            mx2 = bbox_pdf[2] * PDF_TO_PAGE / (page_w / MODEL_SIZE)
            my2 = bbox_pdf[3] * PDF_TO_PAGE / (page_h / MODEL_SIZE)
            xref = img_info.get("xref")
            ihash = img_info.get("hash")
            if xref is None and ihash is None:
                key = f"p{i:04d}_n{img_info['number']}"
            elif xref is not None:
                key = f"x{xref}"
            else:
                key = ihash.hex()[:16]
            res = image_resources.get(key)
            if res is None:
                data = None
                if xref is not None:
                    try:
                        data = doc.extract_image(xref)["image"]
                    except Exception:
                        data = None
                if data is None:
                    try:
                        crop_x1 = int(bbox_pdf[0] * PDF_TO_PAGE)
                        crop_y1 = int(bbox_pdf[1] * PDF_TO_PAGE)
                        crop_x2 = int(bbox_pdf[2] * PDF_TO_PAGE)
                        crop_y2 = int(bbox_pdf[3] * PDF_TO_PAGE)
                        bio = io.BytesIO()
                        Image.open(out).crop((crop_x1, crop_y1, crop_x2, crop_y2)).save(
                            bio, format="PNG"
                        )
                        data = bio.getvalue()
                    except Exception:
                        continue
                if ihash is None:
                    ihash = hashlib.md5(data).digest()
                fname = f"img_{key}.png"
                with open(os.path.join(output_dir, fname), "wb") as fh:
                    fh.write(data)
                res = {
                    "file_name": fname,
                    "xref": xref,
                    "hash": ihash.hex()[:16],
                    "placements": [],
                }
                image_resources[key] = res
            res["placements"].append({"page": i, "bbox": (mx1, my1, mx2, my2)})

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
ocr_out = args.get("ocr_output_dir") or os.path.join(tmp_dir, "model_out")
os.makedirs(ocr_out, exist_ok=True)
old_stdout = sys.stdout
sys.stdout = buf = io.StringIO()
for img in images:
    model.infer(
        tok,
        prompt="<image>document parsing.",
        image_file=img,
        output_path=ocr_out,
        base_size=args.get("base_size", 1024),
        image_size=args.get("image_size", 1024),
        crop_mode=args.get("crop_mode", False),
        max_length=args.get("max_length", 32768),
        no_repeat_ngram_size=args.get("no_repeat_ngram_size", 35),
        ngram_window=args.get("ngram_window", 128),
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


def dedup_blocks(blocks, threshold=None):
    if threshold is None:
        threshold = args.get("dedup_threshold", 15)
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
            if oa > 0 and oa / span_area(s["bbox"]) > args.get("font_overlap_ratio", 0.25):
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

# ── Dual-path image pipeline ──
# Code path (PyMuPDF) = geometry + resource identity authority.
# OCR path = semantics only (text/table structure + alt text).
icon_size_px = args.get("icon_size_px", 30)
icon_repeat_min = args.get("icon_repeat_min", 3)
decor_aspect_ratio = args.get("decor_aspect_ratio", 5)
decor_min_dim = args.get("decor_min_dim", 24)
decor_right_edge_ratio = args.get("decor_right_edge_ratio", 0.75)
decor_min_len = args.get("decor_min_len", 128)
decor_max_min_dim = args.get("decor_max_min_dim", 64)
vector_min_area = args.get("vector_min_area", 5000)
vector_non_white_value = args.get("vector_non_white_value", 235)
vector_non_white_ratio = args.get("vector_non_white_ratio", 0.03)
table_image_overlap_ratio = args.get("table_image_overlap_ratio", 0.5)


def scale_len(v):
    return v / MODEL_SIZE * PAGE_W


def placement_kind(pl_bbox, count):
    """Classify one image placement (decor/icon rules use per-placement
    geometry; icon repeat count uses the resource-level placement count)."""
    w_px = scale_len(pl_bbox[2] - pl_bbox[0])
    h_px = scale_len(pl_bbox[3] - pl_bbox[1])
    x_center_ratio = scale_len((pl_bbox[0] + pl_bbox[2]) / 2) / PAGE_W
    aspect = max(w_px, h_px) / max(min(w_px, h_px), 1)
    if aspect >= decor_aspect_ratio and (
        min(w_px, h_px) < decor_min_dim
        or (
            x_center_ratio > decor_right_edge_ratio
            and max(w_px, h_px) >= decor_min_len
            and min(w_px, h_px) <= decor_max_min_dim
        )
    ):
        return "decor"
    if max(w_px, h_px) < icon_size_px and count >= icon_repeat_min:
        return "icon"
    return "content"


def placement_alt(pl_bbox, page_blocks):
    best_alt = ""
    best_ov = 0.0
    for b in page_blocks:
        if b["type"] == "table" or not b.get("content"):
            continue
        ov = bbox_overlap(b["bbox"], pl_bbox)
        if ov > best_ov:
            best_ov = ov
            best_alt = b["content"].strip()
    return best_alt.replace('"', "&quot;")[:120]


def display_placement(pl):
    b = pl["bbox"]
    return {
        "page": pl["page"],
        "x": round(scale_len(b[0]), 1),
        "y": round(scale_len(b[1]), 1),
        "width": round(scale_len(b[2] - b[0]), 1),
        "height": round(scale_len(b[3] - b[1]), 1),
    }


# Build blocks: content -> standalone image blocks (code geometry);
# icons -> table cellImages (or dropped outside tables); decor -> dropped.
for pi, page_blocks in enumerate(pages):
    tables = [b for b in page_blocks if b.get("type") == "table"]
    table_imgs = [[] for _ in tables]
    added = []
    for key, res in image_resources.items():
        for pl in res["placements"]:
            if pl["page"] != pi:
                continue
            ibb = pl["bbox"]
            ia = (ibb[2] - ibb[0]) * (ibb[3] - ibb[1])
            if ia <= 0:
                continue
            kind = placement_kind(ibb, len(res["placements"]))
            if kind == "decor":
                continue
            if kind == "icon":
                for ti, tb in enumerate(tables):
                    tbb = tb["bbox"]
                    ov = bbox_overlap(tbb, ibb)
                    if ov / ia > table_image_overlap_ratio:
                        table_imgs[ti].append({
                            "src": res["file_name"],
                            "left": round((ibb[0] - tbb[0]) / MODEL_SIZE * PAGE_W, 1),
                            "top": round((ibb[1] - tbb[1]) / MODEL_SIZE * PAGE_H, 1),
                            "width": round((ibb[2] - ibb[0]) / MODEL_SIZE * PAGE_W, 1),
                            "height": round((ibb[3] - ibb[1]) / MODEL_SIZE * PAGE_H, 1),
                        })
                continue
            # content: inside a table -> cellImage, otherwise standalone block
            in_table = False
            for ti, tb in enumerate(tables):
                tbb = tb["bbox"]
                ov = bbox_overlap(tbb, ibb)
                if ov / ia > table_image_overlap_ratio:
                    table_imgs[ti].append({
                        "src": res["file_name"],
                        "left": round((ibb[0] - tbb[0]) / MODEL_SIZE * PAGE_W, 1),
                        "top": round((ibb[1] - tbb[1]) / MODEL_SIZE * PAGE_H, 1),
                        "width": round((ibb[2] - ibb[0]) / MODEL_SIZE * PAGE_W, 1),
                        "height": round((ibb[3] - ibb[1]) / MODEL_SIZE * PAGE_H, 1),
                    })
                    in_table = True
                    break
            if in_table:
                continue
            added.append({
                "type": "image",
                "bbox": ibb,
                "content": "",
                "src": res["file_name"],
                "img_bbox": ibb,
                "identity": {
                    "xref": res["xref"],
                    "hash": res["hash"],
                    "sourceName": res["file_name"],
                },
                "kind": kind,
                "placements": [display_placement(p) for p in res["placements"]],
                "alt": placement_alt(ibb, page_blocks),
            })
    for ti, tb in enumerate(tables):
        tb["table_images"] = table_imgs[ti]
    pages[pi] = page_blocks + added


# Vector graphics: filled PDF drawing paths instead of gap raster heuristics
for pi, page_blocks in enumerate(pages):
    png_path = os.path.join(tmp_dir, f"p{pi:04d}.png")
    if not os.path.exists(png_path):
        continue
    try:
        drawings = doc[pi].get_drawings()
    except Exception:
        continue
    rects = []
    for d in drawings:
        r = d.get("rect")
        if not r or d.get("type") not in ("f", "fs"):
            continue
        aw = scale_len((r[2] - r[0]) * PDF_TO_PAGE / (page_w / MODEL_SIZE))
        ah = scale_len((r[3] - r[1]) * PDF_TO_PAGE / (page_h / MODEL_SIZE))
        if aw * ah >= vector_min_area:
            rects.append((r[0], r[1], r[2], r[3]))
    if not rects:
        continue
    regions = []
    for r in sorted(rects, key=lambda x: (x[1], x[0])):
        target = None
        for idx, reg in enumerate(regions):
            if bbox_overlap(reg, r) > 0:
                target = idx
                break
        if target is None:
            regions.append(list(r))
        else:
            reg = regions[target]
            regions[target] = (
                min(reg[0], r[0]),
                min(reg[1], r[1]),
                max(reg[2], r[2]),
                max(reg[3], r[3]),
            )
    for reg in regions:
        mx1 = reg[0] * PDF_TO_PAGE / (page_w / MODEL_SIZE)
        my1 = reg[1] * PDF_TO_PAGE / (page_h / MODEL_SIZE)
        mx2 = reg[2] * PDF_TO_PAGE / (page_w / MODEL_SIZE)
        my2 = reg[3] * PDF_TO_PAGE / (page_h / MODEL_SIZE)
        vbbox = (mx1, my1, mx2, my2)
        varea = (mx2 - mx1) * (my2 - my1)
        if varea <= 0:
            continue
        blocked = False
        for b in page_blocks:
            ov = bbox_overlap(b["bbox"], vbbox)
            if ov / max(varea, 1) > 0.3:
                blocked = True
                break
        if blocked:
            continue
        try:
            rx1 = int(reg[0] * PDF_TO_PAGE)
            ry1 = int(reg[1] * PDF_TO_PAGE)
            rx2 = int(reg[2] * PDF_TO_PAGE)
            ry2 = int(reg[3] * PDF_TO_PAGE)
            if rx2 - rx1 < 4 or ry2 - ry1 < 4:
                continue
            full = Image.open(png_path)
            crop = full.crop((rx1, ry1, rx2, ry2))
            gray = crop.convert("L")
            pixels = list(gray.getdata())
            non_white = sum(1 for p in pixels if p < vector_non_white_value)
            if non_white <= len(pixels) * vector_non_white_ratio:
                continue
            bio = io.BytesIO()
            crop.save(bio, format="PNG")
            data = bio.getvalue()
            crop_name = f"vect_p{pi:04d}_g{len(page_blocks)}.png"
            if output_dir:
                with open(os.path.join(output_dir, crop_name), "wb") as fh:
                    fh.write(data)
            page_blocks.append({
                "type": "image",
                "bbox": vbbox,
                "content": "",
                "src": crop_name,
                "img_bbox": vbbox,
                "identity": {
                    "xref": None,
                    "hash": hashlib.md5(data).hexdigest()[:16],
                    "sourceName": crop_name,
                },
                "kind": "vector",
                "placements": [display_placement({"page": pi, "bbox": vbbox})],
                "alt": "",
            })
        except Exception:
            continue


# Remove text blocks that are mostly covered by content/vector images
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
            entry["alt"] = (b.get("alt") or b.get("content", "")).replace('"', "&quot;")
            if b.get("identity"):
                entry["identity"] = b["identity"]
            if b.get("kind"):
                entry["kind"] = b["kind"]
            if b.get("placements"):
                entry["placements"] = b["placements"]
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
