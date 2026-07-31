import type { DocumentIR, SourceBlock } from "../types/document-ir.js";
import { escapeHtml } from "../utils/html-escape.js";

function renderTable(b: Extract<SourceBlock, { type: "table" }>): string {
  const maxCols = Math.max(
    0,
    ...[...b.headerRows, ...b.rows].map((r) => r.length),
  );
  const pad = (r: string[]) => [
    ...r,
    ...Array(Math.max(0, maxCols - r.length)).fill(""),
  ];
  const header = b.headerRows
    .map((r) => `<tr>${pad(r).map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`)
    .join("");
  const body = b.rows
    .map((r) => `<tr>${pad(r).map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("");
  if (!header && !body) return "";
  return `<table><thead>${header}</thead><tbody>${body}</tbody></table>`;
}

function renderBlock(b: SourceBlock): string {
  const sep = b.separatorBefore ?? "";
  switch (b.type) {
    case "heading": {
      const level = Math.min(6, Math.max(1, b.level || 2));
      return `${sep}<h${level}>${escapeHtml(b.text)}</h${level}>`;
    }
    case "paragraph":
      return `${sep}<p>${escapeHtml(b.text)}</p>`;
    case "list":
      return `${sep}<ul>${b.text
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => `<li>${escapeHtml(l)}</li>`)
        .join("")}</ul>`;
    case "code":
      return `${sep}<pre><code>${escapeHtml(b.text)}</code></pre>`;
    case "table":
      return `${sep}${renderTable(b)}`;
    case "image":
      return `${sep}<img src="${escapeHtml(b.src)}" alt="${escapeHtml(b.alt)}">`;
    default:
      return `${sep}${escapeHtml(b.text)}`;
  }
}

export function renderSemanticHtml(doc: DocumentIR): string {
  const parts: string[] = [];
  for (const page of doc.pages) {
    for (const b of page.blocks) {
      parts.push(renderBlock(b));
    }
  }
  return parts.join("");
}
