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

export interface TableStructureRepairResult {
  repaired: string;
  tablesFound: number;
  tablesRepaired: number;
  cellsRemoved: number;
  cellsAdded: number;
}

/**
 * Restore consistent column counts inside <table> elements without touching
 * anything else. Long rows have trailing EMPTY cells removed, short rows are
 * padded with empty cells; if a long row has non-empty surplus cells the
 * target column count is raised to the widest row so no content is lost.
 */
export function repairTableStructure(html: string): TableStructureRepairResult {
  const { document } = parseHTML(html);
  const tables = document.querySelectorAll("table");
  let tablesRepaired = 0;
  let cellsRemoved = 0;
  let cellsAdded = 0;

  for (const table of tables) {
    const rows = [...table.querySelectorAll("tr")];
    if (rows.length === 0) continue;
    let localRemoved = 0;
    let localAdded = 0;
    const counts = rows.map((row) =>
      [...row.querySelectorAll("td, th")].reduce(
        (n, cell) => n + parseInt(cell.getAttribute("colspan") || "1", 10),
        0,
      ),
    );
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    let target = 0;
    let best = 0;
    for (const [c, n] of freq) {
      if (n > best) {
        best = n;
        target = c;
      }
    }

    // Remove trailing empty cells from rows wider than the target
    rows.forEach((row, ri) => {
      const cells = [...row.querySelectorAll("td, th")];
      let surplus = counts[ri] - target;
      while (surplus > 0 && cells.length > 0) {
        const last = cells[cells.length - 1];
        const empty =
          (last.textContent ?? "").trim() === "" && !last.querySelector("img");
        if (!empty) break;
        last.remove();
        cells.pop();
        surplus--;
        cellsRemoved++;
        localRemoved++;
      }
    });

    // If any row still has non-empty surplus cells, widen the table instead
    let actualTarget = target;
    for (let ri = 0; ri < rows.length; ri++) {
      actualTarget = Math.max(
        actualTarget,
        [...rows[ri].querySelectorAll("td, th")].reduce(
          (n, cell) => n + parseInt(cell.getAttribute("colspan") || "1", 10),
          0,
        ),
      );
    }

    for (const row of rows) {
      let cols = [...row.querySelectorAll("td, th")].reduce(
        (n, cell) => n + parseInt(cell.getAttribute("colspan") || "1", 10),
        0,
      );
      while (cols < actualTarget) {
        const td = document.createElement("td");
        td.textContent = "";
        row.appendChild(td);
        cols++;
        cellsAdded++;
        localAdded++;
      }
    }

    if (localRemoved > 0 || localAdded > 0) tablesRepaired++;
  }

  return {
    repaired: document.toString(),
    tablesFound: tables.length,
    tablesRepaired,
    cellsRemoved,
    cellsAdded,
  };
}
