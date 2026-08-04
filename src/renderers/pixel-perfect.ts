import type {
  CellImageRef,
  DocumentIR,
  Page,
  SourceBlock,
  TableSourceBlock,
} from "../types/document-ir.js";
import { escapeHtml } from "../utils/html-escape.js";
import { maxLineTextWidth, estimateLineCount } from "../utils/text-metrics.js";

function fontStyleCss(b: SourceBlock): string {
  const f = b.font;
  let css = "";
  if (f?.family) css += `font-family:${f.family};`;
  const furniture = b.sourceType === "header" || b.sourceType === "footer" || b.sourceType === "page_number";
  const size = f?.size ?? (furniture ? 10.0 : 12.0);
  css += `font-size:${size.toFixed(1)}px;`;
  css += `font-weight:${f?.bold ? "bold" : "normal"};`;
  css += `font-style:${f?.italic ? "italic" : "normal"};`;
  if (f?.color) css += `color:${f.color};`;
  return css;
}

/**
 * Grid-driven table: the reconstructed HTML table box equals the PDF grid
 * box. OCR semantic texts are placed into grid cells via gridLayout, and
 * backfilled icons render INSIDE their owning <td> (so review/beautify style
 * changes can no longer separate icons from their table).
 */
function renderGridTable(t: TableSourceBlock): string {
  const gl = t.gridLayout!;
  const ox = gl.cols[0];
  const oy = gl.rows[0];
  const W = gl.cols[gl.cols.length - 1] - ox;
  const H = gl.rows[gl.rows.length - 1] - oy;
  const allRows = [...t.headerRows, ...t.rows];
  const colgroup = gl.cols
    .slice(0, -1)
    .map((x, i) => `<col style="width:${Math.round(gl.cols[i + 1] - x)}px">`)
    .join("");

  const imagesByCell = new Map<string, CellImageRef[]>();
  for (const im of t.cellImages ?? []) {
    if (im.row === undefined || im.col === undefined) continue;
    const key = `${im.row}:${im.col}`;
    const arr = imagesByCell.get(key) ?? [];
    arr.push(im);
    imagesByCell.set(key, arr);
  }

  const body = gl.cells
    .map((rowCells, r) => {
      const rowH = gl.rows[r + 1] - gl.rows[r];
      const rowTop = gl.rows[r] - oy;
      const imgsIn = (cc: number): CellImageRef[] =>
        imagesByCell.get(`${r}:${cc}`) ?? [];
      const imgHtml = (imgs: CellImageRef[], colLeft: number): string =>
        imgs
          .map(
            (im) =>
              // Absolute positioning is relative to the td padding box, which
              // starts 1px inside the collapsed border; subtract it so the
              // icon lands on the exact grid coordinates.
              `<img src="${escapeHtml(im.src)}" alt="" style="position:absolute;left:${Math.round(im.left - colLeft - 1)}px;top:${Math.round(im.top - rowTop - 1)}px;max-width:${Math.round(im.width)}px;height:auto;z-index:3;pointer-events:none;">`,
          )
          .join("");
      let tds = "";
      let c = 0;
      while (c < rowCells.length) {
        const cell = rowCells[c];
        const colLeft = gl.cols[c] - ox;
        if (!cell) {
          const imgs = imgsIn(c);
          tds += `<td style="box-sizing:border-box;position:relative;width:${Math.round(gl.cols[c + 1] - gl.cols[c])}px;height:${Math.round(rowH)}px;">${imgHtml(imgs, colLeft)}</td>`;
          c++;
          continue;
        }
        const colspan = Math.max(1, Math.min(cell.colspan, rowCells.length - c));
        const colW = gl.cols[Math.min(c + colspan, gl.cols.length - 1)] - gl.cols[c];
        // A cell with colspan covers several grid columns; collect every icon
        // whose column lies inside the covered range.
        const imgs: CellImageRef[] = [];
        for (let cc = c; cc < Math.min(c + colspan, rowCells.length); cc++) {
          imgs.push(...imgsIn(cc));
        }
        // The text wrapper is absolutely positioned so it never contributes to
        // the row height: rows stay exactly at their grid boundary height even
        // when a narrow cell forces the text to wrap many lines. The wrapper
        // uses a CSS class (not inline position:absolute) so review/beautify
        // structural repair — which flattens nested inline-absolute divs —
        // cannot move or unwrap it.
        const textHtml = cell.items.length
          ? `<div class="det-cell-text">${cell.items
              .map((it) => {
                const tx = allRows[it.srcRow]?.[it.srcCol] ?? "";
                if (!tx) return "";
                // Source PDF writes narrow-table cells vertically (rotated
                // 90°); restore that direction so long substance names fit
                // their 31px columns instead of wrapping into a mess.
                const v = it.vertical
                  ? "writing-mode:vertical-rl;font-size:12px;line-height:0.55;"
                  : "font-size:12px;line-height:1.35;overflow-wrap:break-word;";
                return `<div style="${v}">${escapeHtml(tx)}</div>`;
              })
              .join("")}</div>`
          : "";
        tds += `<td${colspan > 1 ? ` colspan="${colspan}"` : ""} style="box-sizing:border-box;position:relative;width:${Math.round(colW)}px;height:${Math.round(rowH)}px;padding:2px 4px;overflow:hidden;">${textHtml}${imgHtml(imgs, colLeft)}</td>`;
        c += colspan;
      }
      return `<tr style="height:${Math.round(rowH)}px;">${tds}</tr>`;
    })
    .join("");

  return `<table style="table-layout:fixed;width:${Math.round(W)}px;border-collapse:collapse;">${colgroup}<tbody>${body}</tbody></table>`;
}

function tableInnerHtml(t: TableSourceBlock, height: number): string {
  const maxCols = Math.max(
    0,
    ...[...t.headerRows, ...t.rows].map((r) => r.length),
  );
  const pad = (r: string[]) => [
    ...r,
    ...Array(Math.max(0, maxCols - r.length)).fill(""),
  ];
  const header = t.headerRows
    .map((r) => `<tr>${pad(r).map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`)
    .join("");
  const body = t.rows
    .map((r) => `<tr>${pad(r).map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("");
  // When the table geometry is the code-path grid but the OCR text lives in a
  // sub-region (contentOffset), keep the semantic table at the PDF position.
  const tablePos = t.contentOffset
    ? ` style="position:absolute;left:${Math.round(t.contentOffset.left)}px;top:${Math.round(t.contentOffset.top)}px;"`
    : "";
  let inner = `<table${tablePos}>${header}${body}</table>`;

  const images = t.cellImages ?? [];
  if (images.length > 0) {
    // Backfill cell images at their exact PDF-relative offsets instead of
    // guessing rows/columns: the overlay keeps icons in place even when the
    // OCR table bbox or row heights are imperfect.
    //
    // The wrapper must NOT be position:absolute: review/beautify structurally
    // repair nested absolute divs by moving them to the .page root, which
    // would silently change the containing block and shift every icon.
    // Absolute <img> children keep using .det-table as containing block.
    const overlay = images
      .map(
        (img) =>
          `<img src="${escapeHtml(img.src)}" style="position:absolute;left:${Math.round(img.left)}px;top:${Math.round(img.top)}px;max-width:${Math.round(img.width)}px;height:auto;display:block;z-index:3;pointer-events:none;">`,
      )
      .join("");
    inner = `${inner}<div class="det-table-imgs" style="pointer-events:none;">${overlay}</div>`;
  }
  return inner;
}

function multiLineStyle(text: string, width: number, size: number, bold?: boolean): string {
  // OCR block widths can be narrower than the real glyph advance (e.g. a
  // 327px header whose text actually needs ~333px), which would wrap an
  // extra line and push the block into the content below. Use a conservative
  // script-aware width so wrapping matches real font metrics.
  const effWidth = Math.max(width, Math.ceil(maxLineTextWidth(text, size, bold)));
  const nlines = estimateLineCount(text, effWidth, size, bold);
  const minH = Math.ceil(nlines * (size || 12) * 1.5);
  return `width:${effWidth}px;max-height:${minH}px;white-space:pre-line;overflow:hidden;`;
}

function renderBlock(b: SourceBlock): string {
  const g = b.geometry;
  if (!g) return "";

  if (b.type === "table") {
    if (b.gridLayout) {
      const W = b.gridLayout.cols[b.gridLayout.cols.length - 1] - b.gridLayout.cols[0];
      const H = b.gridLayout.rows[b.gridLayout.rows.length - 1] - b.gridLayout.rows[0];
      const sty = `position:absolute;left:${g.x}px;top:${g.y}px;width:${Math.round(W)}px;height:${Math.round(H)}px;z-index:1;`;
      return `<div class="det-table" style="${sty}">${renderGridTable(b)}</div>`;
    }
    const sty = `position:absolute;left:${g.x}px;top:${g.y}px;z-index:1;`;
    return `<div class="det-table" style="${sty}">${tableInnerHtml(b, g.height)}</div>`;
  }

  if (b.type === "image") {
    // Decorations are skipped entirely; icons outside tables stay as small
    // standalone elements at their exact positions (icons inside tables are
    // rendered through cellImages).
    if (b.kind === "decor") return "";
    const sty = `position:absolute;left:${g.x}px;top:${g.y}px;width:${g.width}px;height:${g.height}px;z-index:2;`;
    const alt = b.alt.replace(/"/g, "&quot;");
    const kindAttr = b.kind ? ` data-kind="${b.kind}"` : "";
    return `<div class="det-image"${kindAttr} style="${sty}"><img src="${escapeHtml(b.src)}" alt="${alt}" style="width:100%;height:100%;object-fit:contain;"></div>`;
  }

  const safe = escapeHtml(b.text);
  const size = b.font?.size ?? (b.sourceType === "header" || b.sourceType === "footer" || b.sourceType === "page_number" ? 10.0 : 12.0);
  let sty = `position:absolute;left:${g.x}px;top:${g.y}px;`;

  const hasNewlines = b.text.includes("\n");
  if (b.type === "heading" || b.type === "other" || hasNewlines) {
    if (hasNewlines) {
      sty += multiLineStyle(b.text, g.width, size, b.font?.bold);
    } else {
      sty += `width:${g.width}px;white-space:nowrap;overflow:visible;`;
    }
  }

  sty += "z-index:2;" + fontStyleCss(b) + "line-height:1.5;";
  if (b.sourceType === "page_number") sty += "text-align:right;";
  return `<div style="${sty}">${safe}</div>`;
}

function renderPage(page: Page): string {
  const parts = [
    `<div class="page" style="position:relative;width:${page.width}px;height:${page.height}px;margin:0 auto;overflow:hidden;background:#fff;">`,
  ];
  for (const b of page.blocks) {
    const html = renderBlock(b);
    if (html) parts.push(html);
  }
  parts.push("</div>");
  return parts.join("\n");
}

const BASE_CSS = `<style>
body{margin:0;padding:20px 0;background:#666;font-family:sans-serif;}
.page{box-shadow:0 2px 8px rgba(0,0,0,0.15);margin-bottom:24px;}
.det-table table{border-collapse:collapse;width:auto;table-layout:fixed;word-wrap:break-word;}
.det-table td,.det-table th{border:1px solid #888;padding:3px 6px;font-size:12px;overflow-wrap:break-word;}
.det-table th{background:#e8e8e8;font-weight:bold;}
.det-table td .det-cell-text{position:absolute;left:4px;top:2px;right:4px;pointer-events:none;}
.det-image img{max-width:100%;height:auto;object-fit:contain;}
</style>`;

export function renderPixelPerfectHtml(doc: DocumentIR): string {
  const pagesHtml = doc.pages.map(renderPage).join("\n");
  return `<!DOCTYPE html>\n<html><head><meta charset="utf-8">${BASE_CSS}</head><body>\n${pagesHtml}\n</body></html>`;
}
