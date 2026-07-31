import { parseHTML } from "linkedom";

export interface ParsedTable {
  headerRows: string[][];
  rows: string[][];
}

/** Pad every row to the global column count so no cell is lost. */
function padToMax(rows: string[][]): string[][] {
  const max = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array(Math.max(0, max - r.length)).fill("")]);
}

/** Parse `<table>` HTML into IR cell grids (header rows contain th). */
export function parseTableHtml(html: string): ParsedTable {
  const wrapper = html.trim().startsWith("<table") ? html : `<table>${html}</table>`;
  const { document } = parseHTML(wrapper);
  const table = document.querySelector("table");
  if (!table) return { headerRows: [], rows: [] };

  const parsed: { cells: string[]; hasHeader: boolean }[] = [];
  for (const tr of table.querySelectorAll("tr")) {
    const cells = [...tr.querySelectorAll("th,td")]
      .map((c) => (c.textContent ?? "").trim());
    parsed.push({ cells, hasHeader: tr.querySelectorAll("th").length > 0 });
  }

  const headerRows = parsed.filter((r) => r.hasHeader).map((r) => r.cells);
  const rows = parsed.filter((r) => !r.hasHeader).map((r) => r.cells);
  const all = [...headerRows, ...rows];
  const maxCols = Math.max(0, ...all.map((r) => r.length));
  const pad = (rs: string[][]) => rs.map((r) => [...r, ...Array(Math.max(0, maxCols - r.length)).fill("")]);

  return {
    headerRows: pad(headerRows),
    rows: pad(rows),
  };
}

/** Parse a Markdown pipe table into IR cell grids. */
export function parseMarkdownTable(text: string): ParsedTable {
  const lines = text
    .trim()
    .split("\n")
    .filter((l) => l.trim().startsWith("|"));
  if (lines.length === 0) return { headerRows: [], rows: [] };

  const cells = (l: string): string[] =>
    l
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

  const isSeparator = (l: string): boolean =>
    /^\|?[\s:|-]+\|?$/.test(l) && l.includes("-");

  let rowsStart = 1;
  if (lines.length > 1 && isSeparator(lines[1])) rowsStart = 2;
  const headerRows = [cells(lines[0])];
  const rows = lines.slice(rowsStart).map(cells);
  const maxCols = Math.max(0, ...[...headerRows, ...rows].map((r) => r.length));
  const pad = (rs: string[][]) => rs.map((r) => [...r, ...Array(Math.max(0, maxCols - r.length)).fill("")]);
  return { headerRows: pad(headerRows), rows: pad(rows) };
}
