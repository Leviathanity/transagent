"""Extract text with positions, fonts, and colors directly from PDF via PyMuPDF.
Compare with OCR output to see where corrections are needed.
"""
import fitz  # PyMuPDF
import json

pdf_path = "/mnt/c/Users/daemo/workplace/pdf-translator/test/test1.pdf"

doc = fitz.open(pdf_path)

for page_idx in range(min(3, len(doc))):
    page = doc[page_idx]
    # Get page at 300 DPI dimensions
    rect = page.rect
    print(f"\n{'='*70}")
    print(f"PAGE {page_idx + 1}  ({rect.width:.0f} x {rect.height:.0f} points)")
    print(f"{'='*70}")

    # Get text blocks with detailed info
    blocks = page.get_text("dict")["blocks"]
    
    text_blocks = []
    for b in blocks:
        if b["type"] == 0:  # text block
            for line in b["lines"]:
                for span in line["spans"]:
                    text_blocks.append({
                        "text": span["text"].strip(),
                        "bbox": [round(x, 1) for x in span["bbox"]],
                        "font": span["font"],
                        "size": round(span["size"], 1),
                        "color": span["color"],
                        "flags": span["flags"],  # bit 0=superscript, bit 1=italic, bit 5=bold
                    })

    print(f"Total text spans: {len(text_blocks)}")
    
    # Show text with font info
    for tb in text_blocks[:30]:
        bold = "BOLD" if tb["flags"] & 32 else ""
        italic = "ITALIC" if tb["flags"] & 2 else ""
        style = " ".join(filter(None, [bold, italic]))
        color_hex = f"#{tb['color']:06x}" if tb['color'] else "black"
        print(f"  [{tb['font']} {tb['size']}px {style} {color_hex}] "
              f"({tb['bbox'][0]:.0f},{tb['bbox'][1]:.0f},{tb['bbox'][2]:.0f},{tb['bbox'][3]:.0f}) "
              f"「{tb['text'][:80]}」")

    if len(text_blocks) > 30:
        print(f"  ... and {len(text_blocks) - 30} more spans")

doc.close()
