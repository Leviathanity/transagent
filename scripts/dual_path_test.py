"""
Dual-path validation: compare OCR text + PDF direct extraction.
Both converted to 300 DPI page pixel space (2481 x 3508) for comparison.
"""
import fitz, torch, os, sys, io, re, json
from transformers import AutoModel, AutoTokenizer

pdf_path = "/mnt/c/Users/daemo/workplace/pdf-translator/test/test1.pdf"

# Scale constants
PDF_TO_PAGE = 300 / 72   # PDF point → 300 DPI pixel = 4.1667
PAGE_W, PAGE_H = 2481, 3508
OCR_TO_PAGE = (PAGE_W / 1024, PAGE_H / 1024)  # (2.423, 3.426)

# ── Phase 1: OCR ──
print("=== OCR running ... ===", flush=True)
model_path = "/root/models/Unlimited-OCR/models/PaddlePaddle--Unlimited-OCR/snapshots/master"
tok = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
model = AutoModel.from_pretrained(model_path, trust_remote_code=True,
    use_safetensors=True, dtype=torch.bfloat16).eval().cuda()

doc = fitz.open(pdf_path)
tmp_dir = "/tmp/dual_path"
os.makedirs(tmp_dir, exist_ok=True)
mat = fitz.Matrix(300/72, 300/72)
for i in range(min(3, len(doc))):
    doc[i].get_pixmap(matrix=mat).save(os.path.join(tmp_dir, f"p{i}.png"))
doc.close()

old_stdout = sys.stdout; sys.stdout = buf = io.StringIO()
for i in range(3):
    model.infer(tok, prompt="<image>document parsing.",
        image_file=os.path.join(tmp_dir, f"p{i}.png"),
        output_path="/tmp/ptl_ocr_out",
        base_size=1024, image_size=1024, crop_mode=False,
        max_length=32768, no_repeat_ngram_size=35, ngram_window=128)
    print("<PAGE_BREAK>", flush=True)
sys.stdout = old_stdout; raw = buf.getvalue()

DET_RE = re.compile(r"<\|det\|>(\w+)\s+\[(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\]\s*<\|/det\|>")
def parse_ocr(text):
    blocks = []; pos = 0
    while pos < len(text):
        m = DET_RE.search(text, pos)
        if not m: break
        t = m.group(1)
        x1,y1,x2,y2 = int(m.group(2)),int(m.group(3)),int(m.group(4)),int(m.group(5))
        tag_end = m.end()
        next_m = DET_RE.search(text, tag_end)
        content = text[tag_end:next_m.start()].strip() if next_m else text[tag_end:].strip()
        # Convert to 300 DPI page pixel space
        px1, py1 = x1 * OCR_TO_PAGE[0], y1 * OCR_TO_PAGE[1]
        px2, py2 = x2 * OCR_TO_PAGE[0], y2 * OCR_TO_PAGE[1]
        blocks.append({"type": t, "bbox": (px1, py1, px2, py2), "text": content})
        pos = next_m.start() if next_m else len(text)
    return blocks

pages_ocr = re.split(r"<PAGE_BREAK>\s*", raw)
pages_ocr = [parse_ocr(p) for p in pages_ocr if p.strip()]

# ── Phase 2: Direct PDF text extraction ──
doc = fitz.open(pdf_path)
for pi in range(3):
    page = doc[pi]
    blocks = page.get_text("dict")["blocks"]
    pdf_spans = []
    for b in blocks:
        if b["type"] != 0: continue
        for line in b["lines"]:
            for span in line["spans"]:
                t = span["text"].strip()
                if not t: continue
                bx, by, bx2, by2 = [c * PDF_TO_PAGE for c in span["bbox"]]
                pdf_spans.append({
                    "text": t, "bbox": (bx, by, bx2, by2),
                    "font": span["font"], "size": round(span["size"], 1),
                    "color": span["color"], "bold": bool(span["flags"] & 32),
                })

    print(f"\n{'='*80}")
    print(f"PAGE {pi+1} — OCR blocks: {len(pages_ocr[pi])}  PDF text spans: {len(pdf_spans)}")
    print(f"{'='*80}")

    # Filter to content blocks (skip headers/footers/page_numbers for OCR)
    content_blocks = [b for b in pages_ocr[pi] if b["type"] not in ("header","footer","page_number")]

    mismatches = []
    for ob in content_blocks:
        ocx, ocy = (ob["bbox"][0]+ob["bbox"][2])/2, (ob["bbox"][1]+ob["bbox"][3])/2
        # Find best matching PDF span by center distance
        best = min(pdf_spans, key=lambda ps:
            ((ocx - (ps["bbox"][0]+ps["bbox"][2])/2)**2 +
             (ocy - (ps["bbox"][1]+ps["bbox"][3])/2)**2)**0.5)
        dist = ((ocx - (best["bbox"][0]+best["bbox"][2])/2)**2 +
                (ocy - (best["bbox"][1]+best["bbox"][3])/2)**2)**0.5

        if dist > 300: continue  # too far, no reliable match

        ocr_text = ob["text"].strip()
        pdf_text = best["text"].strip()
        ocr_words = set(ocr_text.lower().split())
        pdf_words = set(pdf_text.lower().split())

        if ocr_words != pdf_words:
            mismatches.append((dist, ob, best, ocr_text, pdf_text, ocr_words, pdf_words))

    # Show mismatches
    if mismatches:
        print(f"\n  TEXT MISMATCHES ({len(mismatches)}):")
        for dist, ob, best, ocr_t, pdf_t, _, _ in sorted(mismatches):
            st = f"{best['font']} {best['size']}px {'BOLD ' if best['bold'] else ''}#{best['color']:06x}"
            print(f"  [{ob['type'][:8]}] OCR: 「{ocr_t[:80]}」")
            print(f"            PDF: 「{pdf_t[:80]}」  {st}")
            print(f"            dist: {dist:.0f}px  ", end="")
            # Find differing words
            ocr_words_list = ocr_t.lower().split()
            pdf_words_list = pdf_t.lower().split()
            diffs = []
            for w in ocr_words_list:
                if w not in pdf_words_list:
                    diffs.append(f"-{w}")
            for w in pdf_words_list:
                if w not in ocr_words_list:
                    diffs.append(f"+{w}")
            print(f"diffs: {', '.join(diffs[:10])}")
            print()
    else:
        print("\n  ✅ All OCR text matches PDF text!")

    # Show font info summary from PDF for styling
    print(f"\n  FONT INFO (unique fonts on page):")
    fonts_seen = set()
    for ps in pdf_spans:
        key = (ps["font"], ps["size"], ps["bold"], ps["color"])
        if key not in fonts_seen:
            fonts_seen.add(key)
            col = f"#{ps['color']:06x}" if ps['color'] else "black"
            print(f"    {ps['font']:30s} {ps['size']:4.1f}px {'BOLD' if ps['bold'] else '    '} {col}  "
                  f"e.g. 「{ps['text'][:40]}」")

doc.close()
