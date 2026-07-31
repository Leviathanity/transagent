import type {
  DocumentIR,
  Page,
  SourceBlock,
  TableSourceBlock,
} from "../types/document-ir.js";
import { escapeHtml } from "../utils/html-escape.js";

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

function tableInnerHtml(t: TableSourceBlock, height: number): string {
  const header = t.headerRows
    .map((r) => `<tr>${r.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`)
    .join("");
  const body = t.rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("");
  let inner = `<table>${header}${body}</table>`;

  const images = t.cellImages ?? [];
  if (images.length > 0) {
    const rowCount = t.headerRows.length + t.rows.length;
    const estRowH = rowCount > 0 ? height / rowCount : 50;
    for (const img of [...images].sort((a, b) => a.top - b.top)) {
      const rowIdx = Math.max(0, Math.min(Math.floor(img.top / estRowH), rowCount - 1));
      const trs = inner.split("<tr>");
      if (rowIdx + 1 < trs.length) {
        const rowHtml = trs[rowIdx + 1];
        const lastTdOpen = rowHtml.lastIndexOf("<td>");
        const lastTdClose = rowHtml.lastIndexOf("</td>");
        if (lastTdOpen >= 0 && lastTdClose > lastTdOpen) {
          const imgTag = `<img src="${escapeHtml(img.src)}" style="max-width:${Math.round(img.width)}px;height:auto;display:block;">`;
          trs[rowIdx + 1] = rowHtml.slice(0, lastTdOpen + 4) + imgTag + rowHtml.slice(lastTdClose);
          inner = trs.join("<tr>");
        }
      }
    }
  }
  return inner;
}

function multiLineStyle(text: string, width: number, size: number): string {
  const cpl = Math.max(1, Math.floor(width / ((size || 12) * 0.6)));
  let nlines = 0;
  for (const part of text.split("\n")) {
    nlines += Math.max(1, Math.ceil(part.length / cpl));
  }
  const minH = Math.floor(nlines * (size || 12) * 1.5);
  return `width:${width}px;max-height:${minH}px;white-space:pre-line;overflow:hidden;`;
}

function renderBlock(b: SourceBlock): string {
  const g = b.geometry;
  if (!g) return "";

  if (b.type === "table") {
    const sty = `position:absolute;left:${g.x}px;top:${g.y}px;z-index:1;`;
    return `<div class="det-table" style="${sty}">${tableInnerHtml(b, g.height)}</div>`;
  }

  if (b.type === "image") {
    const sty = `position:absolute;left:${g.x}px;top:${g.y}px;width:${g.width}px;height:${g.height}px;z-index:2;`;
    const alt = b.alt.replace(/"/g, "&quot;");
    return `<div class="det-image" style="${sty}"><img src="${escapeHtml(b.src)}" alt="${alt}" style="width:100%;height:100%;object-fit:contain;"></div>`;
  }

  const safe = escapeHtml(b.text);
  const size = b.font?.size ?? (b.sourceType === "header" || b.sourceType === "footer" || b.sourceType === "page_number" ? 10.0 : 12.0);
  let sty = `position:absolute;left:${g.x}px;top:${g.y}px;`;

  const hasNewlines = b.text.includes("\n");
  if (b.type === "heading" || b.type === "other" || hasNewlines) {
    sty += `width:${g.width}px;`;
    if (hasNewlines) {
      sty += multiLineStyle(b.text, g.width, size);
    } else {
      sty += "white-space:nowrap;overflow:visible;";
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
.det-image img{max-width:100%;height:auto;object-fit:contain;}
</style>`;

export function renderPixelPerfectHtml(doc: DocumentIR): string {
  const pagesHtml = doc.pages.map(renderPage).join("\n");
  return `<!DOCTYPE html>\n<html><head><meta charset="utf-8">${BASE_CSS}</head><body>\n${pagesHtml}\n</body></html>`;
}
