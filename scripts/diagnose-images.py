"""Compare extracted image data (Document IR + files) against PDF ground truth.

Usage: python diagnose-images.py <pdf> <ir.json> <image_dir>

Emits a JSON report on stdout with:
- PDF placements / unique resources (xref/hash)
- extracted files (count, duplicates by md5)
- IR image blocks (kind distribution, empty src, cellImages)
- geometry deviation of IR image blocks vs nearest PDF placement
"""

import hashlib
import json
import os
import sys

import fitz


def main():
    pdf_path, ir_path, image_dir = sys.argv[1:4]
    doc = fitz.open(pdf_path)
    pdf_w = doc[0].rect.width
    scale = 1024 / pdf_w

    placements = 0
    unique = {}
    placements_by_key = {}
    per_page = []
    for i in range(len(doc)):
        infos = doc[i].get_image_info(xrefs=True, hashes=True)
        per_page.append(len(infos))
        placements += len(infos)
        for info in infos:
            xref = info.get("xref")
            h = info.get("hash")
            key = f"x{xref}" if xref is not None else (h.hex()[:16] if h else f"p{i}_n{info['number']}")
            unique.setdefault(key, 0)
            unique[key] += 1
            placements_by_key.setdefault(key, []).append((i, info["bbox"]))

    # icon placements (same rule as extraction: max dim < 40px, repeat >= 3)
    icon_placements = 0
    scale_y = 1024 / doc[0].rect.height
    for key, pls in placements_by_key.items():
        if len(pls) < 3:
            continue
        for _, bb in pls:
            w = (bb[2] - bb[0]) * scale
            hh = (bb[3] - bb[1]) * scale_y
            if max(w, hh) < 40:
                icon_placements += 1

    files = []
    if os.path.isdir(image_dir):
        for name in sorted(os.listdir(image_dir)):
            if name.lower().endswith(".png"):
                p = os.path.join(image_dir, name)
                if os.path.isfile(p):
                    files.append((name, hashlib.md5(open(p, "rb").read()).hexdigest()))
    md5_counts = {}
    for _, h in files:
        md5_counts[h] = md5_counts.get(h, 0) + 1

    ir = json.load(open(ir_path, encoding="utf-8"))
    blocks = []
    cell_images = 0
    icon_blocks = 0
    for page in ir.get("pages", []):
        for b in page.get("blocks", []):
            if b.get("type") == "image":
                blocks.append(b)
                if b.get("kind") == "icon":
                    icon_blocks += 1
            elif b.get("type") == "table":
                cell_images += len(b.get("cellImages", []))

    empty_src = sum(1 for b in blocks if not b.get("src"))
    kinds = {}
    for b in blocks:
        k = b.get("kind") or "unknown"
        kinds[k] = kinds.get(k, 0) + 1

    # geometry deviation: IR block center vs nearest PDF placement center
    deviations = []
    for b in blocks:
        g = b.get("geometry") or {}
        cx = g.get("x", 0) + g.get("width", 0) / 2
        cy = g.get("y", 0) + g.get("height", 0) / 2
        best = None
        for i in range(len(doc)):
            for info in doc[i].get_image_info():
                bb = info["bbox"]
                pcx = (bb[0] + bb[2]) / 2 * scale
                pcy = (bb[1] + bb[3]) / 2 * scale
                d = ((pcx - cx) ** 2 + (pcy - cy) ** 2) ** 0.5
                if best is None or d < best:
                    best = d
        if best is not None:
            deviations.append(round(best, 2))

    deviations.sort()
    report = {
        "pdf": {
            "pages": len(doc),
            "placements": placements,
            "perPage": per_page,
            "uniqueResources": len(unique),
        },
        "extractedFiles": {
            "count": len(files),
            "uniqueByMd5": len(md5_counts),
            "duplicateFiles": len(files) - len(md5_counts),
        },
        "ir": {
            "imageBlocks": len(blocks),
            "emptySrc": empty_src,
            "kinds": kinds,
            "cellImages": cell_images,
        },
        "backfill": {
            "iconPlacements": icon_placements,
            "backfilled": icon_blocks + cell_images,
            "coverage": round((icon_blocks + cell_images) / max(icon_placements, 1), 3),
        },
        "geometryDeviationPx": {
            "n": len(deviations),
            "p50": deviations[len(deviations) // 2] if deviations else None,
            "max": deviations[-1] if deviations else None,
            "over5px": sum(1 for d in deviations if d > 5),
        },
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
