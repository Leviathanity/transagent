# Pixel-Perfect HTML Reconstruction Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current plain-HTML output with a pixel-perfect layout that overlays translated text (with bbox positioning) on top of the original PDF page screenshots.

**Architecture:** Parse `<|det|>` tags from Unlimited-OCR output to extract bbox coordinates + element types, then generate a two-layer HTML page (background = PDF screenshot, foreground = absolutely-positioned translated text blocks). Table HTML structure is preserved with bbox-aligned container. Images are cropped from the full page PNG.

**Tech Stack:** Python (PIL/PyMuPDF), TypeScript, linkedom

---

## File Plan

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/det-parser-test.py` | **Create** | Standalone Python prototype for det-tag parsing + HTML generation |
| `src/utils/ocr-processor.ts` | Modify | Replace det-tag stripping with parsing + positioned layout generation |
| `src/utils/layout-renderer.ts` | **Create** | TypeScript module for converting parsed det blocks to positioned HTML (if any TS-side processing needed) |
| `workdir/` | Test | Output verification via Chrome DevTools |

---

### Task 1: Python Prototype — Det Tag Parser + Positioned HTML

**Files:**
- Create: `scripts/det-parser-test.py`

- [ ] **Step 1: Write the parser prototype**

```python
"""
Parse Unlimited-OCR output with <|det|> tags, generate pixel-perfect HTML.
Usage: python scripts/det-parser-test.py <ocr_output.txt> <page_png_dir> <output.html>
"""
import re, sys, os, json
from PIL import Image
from pathlib import Path

DET_RE = re.compile(
    r"<\|det\|>(\w+)\s+\[(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\]\s*<\|/det\|>"
)

def parse_ocr(raw: str) -> list[dict]:
    """Parse OCR output into blocks with type, bbox, and content."""
    blocks = []
    pos = 0
    while pos < len(raw):
        m = DET_RE.search(raw, pos)
        if not m:
            break
        type_name = m.group(1)
        x1, y1, x2, y2 = int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5))
        tag_end = m.end()
        # Content after det tag until next det tag or end
        next_m = DET_RE.search(raw, tag_end)
        content = raw[tag_end:next_m.start()].strip() if next_m else raw[tag_end:].strip()
        blocks.append({
            "type": type_name,
            "bbox": (x1, y1, x2, y2),
            "content": content,
        })
        pos = next_m.start() if next_m else len(raw)
    return blocks

def group_by_page(raw: str) -> list[list[dict]]:
    """Split blocks by <PAGE_BREAK> markers."""
    pages_raw = re.split(r"<PAGE_BREAK>\s*", raw)
    return [parse_ocr(p) for p in pages_raw if p.strip()]

def generate_page_html(blocks: list[dict], page_img_path: str | None, page_w: int, page_h: int) -> str:
    """Generate positioned HTML for one page with page screenshot as background."""
    parts = []
    # Page container with screenshot background
    img_style = ""
    if page_img_path and os.path.exists(page_img_path):
        img_style = f'<img src="{page_img_path}" style="position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none;">'

    for b in blocks:
        x1, y1, x2, y2 = b["bbox"]
        w, h = x2 - x1, y2 - y1
        content = b["content"]
        type_name = b["type"]

        # Build inner content
        if type_name == "table":
            # table HTML already has proper structure
            inner = content
        elif type_name == "image":
            inner = content  # <img> tag already present
        else:
            # escape HTML entities
            inner = content.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

        # Apply type-specific styling
        base_style = f"position:absolute;left:{x1}px;top:{y1}px;z-index:2;"
        if type_name == "header":
            style = base_style + f"width:{w}px;font-size:10px;color:#888;"
        elif type_name == "footer":
            style = base_style + f"width:{w}px;font-size:9px;color:#888;"
        elif type_name == "page_number":
            style = base_style + f"width:{w}px;font-size:9px;color:#888;text-align:right;"
        elif type_name == "table":
            style = base_style + f"width:{w}px;height:{h}px;overflow:auto;font-size:11px;"
        elif type_name == "image":
            style = base_style + f"width:{w}px;height:{h}px;"
        else:  # text / paragraph
            style = base_style + f"width:{w}px;font-size:11px;line-height:1.4;"

        parts.append(f'<div class="det-{type_name}" style="{style}">{inner}</div>')

    body = f"""
    <div class="page" style="position:relative;width:{page_w}px;height:{page_h}px;margin:0 auto;overflow:hidden;background:#fff;">
      {img_style}
      {''.join(parts)}
    </div>"""
    return body

def extract_images_from_page(page_img_path: str, blocks: list[dict], output_dir: str, page_num: int) -> None:
    """Crop image regions from full page PNG."""
    if not os.path.exists(page_img_path):
        return
    img = Image.open(page_img_path)
    for i, b in enumerate(blocks):
        if b["type"] != "image":
            # Also extract table regions for reference
            continue
        x1, y1, x2, y2 = b["bbox"]
        crop = img.crop((x1, y1, x2, y2))
        out_path = os.path.join(output_dir, f"page_{page_num:04d}_crop_{i}.png")
        crop.save(out_path)

def main():
    ocr_file, png_dir, out_html = sys.argv[1], sys.argv[2], sys.argv[3]
    raw = Path(ocr_file).read_text(encoding="utf-8")
    pages = group_by_page(raw)

    # Default page size (A4 at 300 DPI = 2480 x 3508)
    page_w, page_h = 2480, 3508

    html_parts = []
    for pi, page_blocks in enumerate(pages):
        png_path = os.path.join(png_dir, f"p{pi:04d}.png")
        page_html = generate_page_html(page_blocks, png_path, page_w, page_h)
        html_parts.append(page_html)
        extract_images_from_page(png_path, page_blocks, os.path.dirname(out_html), pi)

    full = f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
  body {{ margin:0; padding:20px 0; background:#666; }}
  .det-table table {{ border-collapse:collapse; width:100%; background:rgba(255,255,255,0.85); }}
  .det-table td, .det-table th {{ border:1px solid #aaa; padding:3px 5px; font-size:11px; }}
  .det-table th {{ background:#e8e8e8; font-weight:bold; }}
  .det-image img {{ max-width:100%; height:auto; }}
</style>
</head><body>
{''.join(html_parts)}
</body></html>"""
    Path(out_html).write_text(full, encoding="utf-8")
    print(f"Output: {out_html}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Capture raw OCR output for testing**

First modify ocr-processor.ts temporarily to save the raw (pre-cleaning) OCR output:
```python
# Before the cleaning step in ocr-processor.py:
with open("/tmp/ptl_ocr_raw.txt", "w") as f:
    f.write(raw)
```

Run: `bun run bin/ptl.ts convert test/test1.pdf --output workdir/01_original.html`

Expected: `/tmp/ptl_ocr_raw.txt` is created with raw det-tagged output

- [ ] **Step 3: Test the prototype**

```bash
# Copy raw OCR output from WSL to Windows
wsl cp /tmp/ptl_ocr_raw.txt /mnt/c/Users/daemo/workplace/pdf-translator/workdir/raw_ocr.txt

# Run prototype
python scripts/det-parser-test.py workdir/raw_ocr.txt workdir workdir/perfect.html
```

Expected: `workdir/perfect.html` is created, when opened in Chrome shows pages with screenshot background and positioned text overlays

- [ ] **Step 4: Verify in DevTools**

Navigate Chrome to `file:///C:/Users/daemo/workplace/pdf-translator/workdir/perfect.html`
Check:
- Page screenshots render as background (bottom layer)
- Text blocks float at correct positions (top layer)
- Tables have HTML structure with visible borders
- Elements are selectable/searchable

- [ ] **Step 5: Commit prototype**

```bash
git add scripts/det-parser-test.py workdir/raw_ocr.txt
git commit -m "feat: add det-tag parser prototype for positioned HTML"
```

---

### Task 2: Embed Parser into ocr-processor.ts

**Files:**
- Modify: `src/utils/ocr-processor.ts`

Replace the current det-tag stripping logic with the full parsing + positioned HTML generation, directly in the Python script embedded in ocr-processor.ts.

- [ ] **Step 1: Understand current structure**

Read `src/utils/ocr-processor.ts` lines 44-112 (the Python script inside the TS template literal).

Current flow:
```
raw = buf.getvalue()                         # raw OCR output with det tags
clean = re.sub(r"<\|det\|>[^<]+<\|/det\|>", "", raw)   # strip det tags
wrap_headings(clean)                          # detect headings
<html><body> clean </body></html>            # wrap in basic HTML
```

New flow:
```
raw = buf.getvalue()                         # raw OCR output
pages = group_by_page(raw)                   # split on <PAGE_BREAK>
for each page:
    blocks = parse_blocks(page_text)          # extract {type, bbox, content}
    extract_images(page_png, blocks)          # crop image regions
    page_html = layout_page(blocks, png_path) # positioned HTML with screenshot bg
final = assemble_document(page_htmls)         # wrap in <!DOCTYPE html>
```

- [ ] **Step 2: Rewrite the Python script**

Replace the post-processing section in `ocr-processor.ts`:

```python
# After capturing raw output from model.infer()
raw = buf.getvalue()

# ── Parse det-tagged output into positioned blocks ──
import re, os
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

# Group by page
pages_raw = re.split(r"<PAGE_BREAK>\\s*", raw)
pages = [parse_blocks(p) for p in pages_raw if p.strip()]

# Get page dimensions from first page image
tmp_page_0 = os.path.join(tmp_dir, "p0000.png")
if os.path.exists(tmp_page_0):
    with Image.open(tmp_page_0) as im:
        page_w, page_h = im.size
else:
    page_w, page_h = 2480, 3508

# Generate HTML pages
page_divs = []
for pi, blocks in enumerate(pages):
    png_path = os.path.join(tmp_dir, f"p{pi:04d}.png")
    parts = [f'<div class="page" style="position:relative;width:{page_w}px;height:{page_h}px;margin:0 auto;overflow:hidden;background:#fff;">']

    # Background: PDF screenshot
    if os.path.exists(png_path):
        parts.append(f'<img src="{png_path}" style="position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none;">')

    # Foreground: positioned blocks
    for b in blocks:
        x1,y1,x2,y2 = b["bbox"]
        w,h = x2-x1, y2-y1
        ct = b["content"]
        tp = b["type"]

        if tp == "table":
            style = f"position:absolute;left:{x1}px;top:{y1}px;width:{w}px;height:{h}px;overflow:auto;z-index:2;"
            parts.append(f'<div class="det-table" style="{style}">{ct}</div>')
        elif tp == "image":
            # Crop image from page PNG
            crop_path = None
            if os.path.exists(png_path):
                crop_dir = output_dir if output_dir else os.path.dirname(tmp_dir)
                crop_name = f"page_{pi:04d}_crop_{blocks.index(b)}.png"
                crop_path = os.path.join(crop_dir, crop_name)
                with Image.open(png_path) as page_img:
                    page_img.crop((x1,y1,x2,y2)).save(crop_path)
            src = crop_path if crop_path and os.path.exists(crop_path) else ""
            style = f"position:absolute;left:{x1}px;top:{y1}px;width:{w}px;height:{h}px;z-index:2;"
            parts.append(f'<div class="det-image" style="{style}"><img src="{src}" style="width:100%;height:100%;"></div>')
        else:
            style = f"position:absolute;left:{x1}px;top:{y1}px;width:{w}px;z-index:2;font-size:11px;line-height:1.4;"
            if tp == "header": style += "color:#888;font-size:10px;"
            if tp == "footer": style += "color:#888;font-size:9px;"
            if tp == "page_number": style += "color:#888;font-size:9px;text-align:right;"
            # Escape HTML entities
            safe = ct.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
            parts.append(f'<div style="{style}">{safe}</div>')

    parts.append("</div>")
    page_divs.append("\\n".join(parts))

css = """<style>
body{margin:0;padding:20px 0;background:#666;font-family:sans-serif;}
.det-table table{border-collapse:collapse;width:100%;background:rgba(255,255,255,0.85);}
.det-table td,.det-table th{border:1px solid #aaa;padding:2px 4px;font-size:11px;}
.det-table th{background:#e8e8e8;font-weight:bold;}
.det-image img{max-width:100%;height:auto;}
</style>"""

html = f"<!DOCTYPE html>\\n<html><head><meta charset=\\"utf-8\\">{css}</head><body>\\n" + "\\n".join(page_divs) + "\\n</body></html>"
print(html)
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 4: Test with 5-page conversion**

```bash
# Temporarily set max_pages=5 in Python script
# Run conversion
bun run bin/ptl.ts convert test/test1.pdf --output workdir/01_perfect.html
```

Expected: HTML with positioned text on page screenshots, tables selectable

- [ ] **Step 5: Verify in Chrome DevTools**

Navigate to output file, confirm:
- [ ] Page screenshots visible as background
- [ ] Text overlays at correct positions
- [ ] Table HTML selectable with borders
- [ ] Image crops appear in output directory

- [ ] **Step 6: Commit**

```bash
git add src/utils/ocr-processor.ts
git commit -m "feat: replace det-tag stripping with positioned HTML layout using page screenshots"
```

---

### Task 3: Update Pipeline for New HTML Output

**Files:**
- Modify: `src/pipeline/stage-translate.ts`
- Modify: `src/pipeline/stage-interact.ts`
- Modify: `src/splitter/html-block-splitter.ts`

The new HTML output has a fundamentally different structure:
- Each page is a `<div class="page">` with absolute-positioned children
- Text is entity-escaped (no raw HTML tags for non-table elements)
- Tables are inside `<div class="det-table">` containers

This affects the splitter (which splits by heading tags) since headings are now entity-escaped plain text. And affects interact (which needs to work with positioned divs).

- [ ] **Step 1: Audit impact**

The splitter currently looks for `<h2>`, `<h3>`, `<table>` tags. In the new format:
- Headings are entity-escaped plain text like `&lt;h2&gt;1. Purpose&lt;/h2&gt;` — **not detected**
- Tables are inside `<div class="det-table">` — **still detectable**

For the translation pipeline:
- Text blocks are non-translatable (they're the translated text) — the pipeline translates `01_original.html` to `02_reviewed.html` to `03_translated.html`, but in pixel-perfect mode the text is already positioned
- Translation should update the text CONTENT inside each positioned div

**Conclusion:** The HTML splitter needs a new mode: split by `<div class="page">` containers first, then within each page, split by `<div class="det-table">` into table blocks and text groups.

Modify `html-block-splitter.ts`:
```typescript
export function splitPerfectHtmlToBlocks(html: string): SeparatedBlock[] {
  const { document } = parseHTML(html);
  const pages = document.querySelectorAll(".page");
  const blocks: SeparatedBlock[] = [];

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const pageDivs = page.querySelectorAll<HTMLElement>("[class^='det-'], div:not([class])");
    
    for (const el of pageDivs) {
      const className = el.className || "";
      const isTable = className.includes("det-table");
      const isImage = className.includes("det-image");
      
      let blockType: BlockType = "paragraph";
      let level = 0;
      
      if (isTable) blockType = "table";
      else if (isImage) blockType = "other";
      
      blocks.push({
        block: {
          id: `sb_${pi}_${blocks.length}`,
          level,
          blockType,
          text: isTable ? el.innerHTML : el.textContent ?? "",
        },
        separatorBefore: "",
      });
    }
  }
  
  return blocks;
}
```

- [ ] **Step 2: Update stage-translate.ts to use splitPerfectHtmlToBlocks**

```typescript
// Add import
import { splitPerfectHtmlToBlocks, assembleHtmlBlocks } from "../splitter/html-block-splitter.js";

// Replace splitHtmlToBlocks with splitPerfectHtmlToBlocks
const blocks = splitPerfectHtmlToBlocks(htmlContent);
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/splitter/html-block-splitter.ts src/pipeline/stage-translate.ts
git commit -m "feat: update splitter for pixel-perfect HTML page structure"
```

---

### Task 4: Full Pipeline Smoke Test

**Files:**
- Test: `workdir/`

- [ ] **Step 1: Run full pipeline**

```bash
bun run bin/ptl.ts translate test/test1.pdf --direction en2zh --skip-interact --output workdir/output.html
```

Expected: all 5 stages complete, output contains positioned pages with translated text

- [ ] **Step 2: Verify in Chrome DevTools**

Open `workdir/output.html` in Chrome, verify:
- [ ] All page screenshots present as background images
- [ ] Text blocks in correct positions (Chinese translation overlays)
- [ ] Tables preserved with HTML structure
- [ ] Images cropped and displayed
- [ ] Text is selectable

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: pixel-perfect HTML output with bbox-positioned text overlays"
```
