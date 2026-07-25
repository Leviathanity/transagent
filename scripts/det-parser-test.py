"""
Parse Unlimited-OCR output with <|det|> tags, generate pixel-perfect HTML.
Usage: python scripts/det-parser-test.py <ocr_input.txt> <png_dir> <output.html>
"""
import re, sys, os, glob
from PIL import Image
from pathlib import Path

DET_RE = re.compile(
    r"<\|det\|>(\w+)\s+\[(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\]\s*<\|/det\|>"
)

def parse_blocks(text: str) -> list[dict]:
    blocks = []
    pos = 0
    while pos < len(text):
        m = DET_RE.search(text, pos)
        if not m:
            break
        t = m.group(1)
        x1, y1, x2, y2 = int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5))
        tag_end = m.end()
        next_m = DET_RE.search(text, tag_end)
        content = text[tag_end:next_m.start()].strip() if next_m else text[tag_end:].strip()
        blocks.append({"type": t, "bbox": (x1, y1, x2, y2), "content": content})
        pos = next_m.start() if next_m else len(text)
    return blocks

def get_page_images(png_dir: str) -> list[str]:
    files = sorted(glob.glob(os.path.join(png_dir, "page_*.png")))
    if not files:
        files = sorted(glob.glob(os.path.join(png_dir, "p*.png")))
    return files

def generate_page_html(blocks, page_img, page_w, page_h, out_dir):
    parts = [f'<div class="page" style="position:relative;width:{page_w}px;height:{page_h}px;margin:0 auto;overflow:hidden;background:#fff;">']
    if page_img and os.path.exists(page_img):
        parts.append(f'<img src="{os.path.basename(page_img)}" style="position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none;">')
    for idx, b in enumerate(blocks):
        x1, y1, x2, y2 = b["bbox"]
        w, h = x2 - x1, y2 - y1
        ct = b["content"]
        tp = b["type"]
        if tp == "table":
            style = f"position:absolute;left:{x1}px;top:{y1}px;width:{w}px;height:{h}px;overflow:auto;z-index:2;"
            parts.append(f'<div class="det-table" style="{style}">{ct}</div>')
        elif tp in ("header", "footer", "page_number"):
            sty = f"position:absolute;left:{x1}px;top:{y1}px;width:{w}px;z-index:2;"
            if tp == "header": sty += "color:#888;font-size:10px;"
            if tp == "footer": sty += "color:#888;font-size:9px;"
            if tp == "page_number": sty += "color:#888;font-size:9px;text-align:right;"
            safe = ct.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            parts.append(f'<div style="{sty}">{safe}</div>')
        elif tp == "image":
            style = f"position:absolute;left:{x1}px;top:{y1}px;width:{w}px;height:{h}px;z-index:2;"
            crop_name = f"crop_{Path(page_img).stem}_{idx}.png" if page_img else ""
            crop_path = os.path.join(out_dir, crop_name) if crop_name else ""
            if page_img and os.path.exists(page_img):
                try:
                    Image.open(page_img).crop((x1, y1, x2, y2)).save(crop_path)
                except Exception:
                    crop_path = ""
            src = os.path.basename(crop_path) if crop_path and os.path.exists(crop_path) else ""
            parts.append(f'<div class="det-image" style="{style}"><img src="{src}" style="width:100%;height:100%;"></div>')
        else:
            style = f"position:absolute;left:{x1}px;top:{y1}px;width:{w}px;z-index:2;font-size:11px;line-height:1.4;"
            safe = ct.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            parts.append(f'<div style="{style}">{safe}</div>')
    parts.append("</div>")
    return "\n".join(parts)

def main():
    ocr_file, png_dir, out_html = sys.argv[1], sys.argv[2], sys.argv[3]
    out_dir = os.path.dirname(out_html)
    raw = Path(ocr_file).read_text(encoding="utf-8")
    pages_raw = re.split(r"<PAGE_BREAK>\s*", raw)
    page_imgs = get_page_images(png_dir)
    page_w, page_h = 2480, 3508
    if page_imgs:
        try:
            with Image.open(page_imgs[0]) as im:
                page_w, page_h = im.size
        except Exception:
            pass
    html_parts = []
    for pi, page_text in enumerate(pages_raw):
        if not page_text.strip():
            continue
        blocks = parse_blocks(page_text)
        img_path = page_imgs[pi] if pi < len(page_imgs) else None
        html_parts.append(generate_page_html(blocks, img_path, page_w, page_h, out_dir))
    
    css = """<style>
body{margin:0;padding:20px 0;background:#666;font-family:sans-serif;}
.det-table table{border-collapse:collapse;width:100%;background:rgba(255,255,255,0.85);}
.det-table td,.det-table th{border:1px solid #aaa;padding:2px 4px;font-size:11px;}
.det-table th{background:#e8e8e8;font-weight:bold;}
.det-image img{max-width:100%;height:auto;}
</style>"""
    full = f"<!DOCTYPE html>\n<html><head><meta charset=\"utf-8\">{css}</head><body>\n" + "\n".join(html_parts) + "\n</body></html>"
    Path(out_html).write_text(full, encoding="utf-8")
    print(f"Output: {out_html} ({len(html_parts)} pages)")

if __name__ == "__main__":
    main()
