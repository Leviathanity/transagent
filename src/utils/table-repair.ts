import { parseHTML } from "linkedom";

export interface TableRepairResult {
  repaired: string;
  stats: { tablesFound: number; tablesRepaired: number; cellsMerged: number; bleedingLinesFixed: number; headerRowsFixed: number };
}

export function repairHtmlTables(html: string): TableRepairResult {
  const { document } = parseHTML(html);
  const tables = document.querySelectorAll("table");
  const stats = { tablesFound: tables.length, tablesRepaired: 0, cellsMerged: 0, bleedingLinesFixed: 0, headerRowsFixed: 0 };

  for (const table of tables) {
    const rows = table.querySelectorAll("tr");

    let maxCols = 0;
    for (const row of rows) {
      let cols = 0;
      for (const cell of row.querySelectorAll("td, th")) {
        cols += parseInt(cell.getAttribute("colspan") || "1");
      }
      maxCols = Math.max(maxCols, cols);
    }

    if (maxCols === 0) continue;

    let repaired = false;
    for (const row of rows) {
      let cols = 0;
      const cells = [...row.querySelectorAll("td, th")];
      for (const cell of cells) {
        cols += parseInt(cell.getAttribute("colspan") || "1");
      }
      while (cols < maxCols) {
        const td = document.createElement("td");
        td.textContent = "";
        row.appendChild(td);
        cols++;
        repaired = true;
      }
    }
    if (repaired) stats.tablesRepaired++;
  }

  const root = document.body || document.documentElement;
  const repairedHTML = root.innerHTML;
  return { repaired: repairedHTML, stats };
}

export function repairTables(html: string): TableRepairResult {
  return repairHtmlTables(html);
}
