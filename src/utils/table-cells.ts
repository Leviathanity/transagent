import { parseHTML } from "linkedom";

export interface ParsedTable {
  headerRows: string[][];
  rows: string[][];
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
      .map((c) => (c.textContent ?? "").trim())
      .filter((c) => c.length > 0);
    parsed.push({ cells, hasHeader: tr.querySelectorAll("th").length > 0 });
  }

  return {
    headerRows: parsed.filter((r) => r.hasHeader).map((r) => r.cells),
    rows: parsed.filter((r) => !r.hasHeader).map((r) => r.cells),
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
  return {
    headerRows: [cells(lines[0])],
    rows: lines.slice(rowsStart).map(cells),
  };
}
