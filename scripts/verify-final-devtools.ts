#!/usr/bin/env bun
// Full DevTools verification of a FINAL rendered HTML against the translated
// IR ground truth: icons, grid table boxes, row/column structure, mapped text
// placement, vertical (rotated) text direction, standalone images and lint.
//
// Usage:
//   bun run scripts/verify-final-devtools.ts <final.html> <translated.ir.json>

import puppeteer from "puppeteer-core";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDocument } from "../src/utils/ir-serialization.js";
import { lintHtml } from "../src/utils/lint.js";

const [htmlPath, irPath] = process.argv.slice(2);
if (!htmlPath || !irPath) {
  console.error("Usage: bun run scripts/verify-final-devtools.ts <final.html> <translated.ir.json>");
  process.exit(1);
}

const ir = parseDocument(await readFile(resolve(irPath), "utf-8"));
const html = await readFile(resolve(htmlPath), "utf-8");
const lint = lintHtml(html);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 7000, deviceScaleFactor: 1 });
await page.goto(`file://${resolve(htmlPath)}`, { waitUntil: "networkidle0" });

const dom = await page.evaluate(() => {
  const out: { tables: {
    x: number; y: number; w: number; h: number;
    trs: { tds: {
      col: number; colspan: number; x: number; y: number; w: number; h: number;
      text: string; vertical: boolean; imgs: { x: number; y: number }[];
    }[] }[];
  }[]; standalone: { x: number; y: number }[] }[] = [];
  for (const p of document.querySelectorAll(".page")) {
    const pr = p.getBoundingClientRect();
    const tables = [];
    for (const t of p.querySelectorAll(".det-table")) {
      const inner = t.querySelector("table");
      if (!inner) continue;
      const tr = t.getBoundingClientRect();
      const trs = [...inner.querySelectorAll("tr")].map((trEl) => {
        const tds = [];
        let col = 0;
        for (const td of trEl.querySelectorAll("td")) {
          const r = td.getBoundingClientRect();
          const colspan = parseInt(td.getAttribute("colspan") || "1", 10);
          const texts = [...td.querySelectorAll(".det-cell-text div")];
          tds.push({
            col,
            colspan,
            x: r.left - pr.left,
            y: r.top - pr.top,
            w: r.width,
            h: r.height,
            text: (td.textContent || "").trim(),
            vertical: texts.length > 0 && texts.every((d) => getComputedStyle(d).writingMode === "vertical-rl"),
            imgs: [...td.querySelectorAll("img")].map((img) => {
              const ir2 = img.getBoundingClientRect();
              return { x: ir2.left - pr.left, y: ir2.top - pr.top };
            }),
          });
          col += colspan;
        }
        return { tds };
      });
      tables.push({ x: tr.left - pr.left, y: tr.top - pr.top, w: tr.width, h: tr.height, trs });
    }
    const standalone = [...p.querySelectorAll(".det-image")].map((d) => {
      const r = d.getBoundingClientRect();
      return { x: r.left - pr.left, y: r.top - pr.top };
    });
    out.push({ tables, standalone });
  }
  return out;
});
await browser.close();

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const allRowsOf = (b: { headerRows: string[][]; rows: string[][] }) => [...b.headerRows, ...b.rows];

// Expected icons / tables / standalone from IR.
const expectedIcons: { pi: number; x: number; y: number }[] = [];
const expectedTables: { pi: number; x: number; y: number; w: number; h: number; rows: number; cols: number; textCells: number; verticalCells: number }[] = [];
const expectedStandalone: { pi: number; x: number; y: number }[] = [];
const expectedCellTexts: { pi: number; x: number; y: number; r: number; c: number; texts: string[]; vertical: boolean }[] = [];
for (const [pi, page] of ir.pages.entries()) {
  for (const b of page.blocks) {
    if (b.type === "table") {
      const g = b.geometry!;
      if (b.gridLayout) {
        const gl = b.gridLayout;
        const all = allRowsOf(b);
        expectedTables.push({
          pi, x: g.x, y: g.y, w: g.width, h: g.height,
          rows: gl.rows.length - 1,
          cols: gl.cols.length - 1,
          textCells: 0,
          verticalCells: 0,
        });
        const t = expectedTables[expectedTables.length - 1];
        for (const im of b.cellImages ?? []) {
          expectedIcons.push({ pi, x: g.x + im.left, y: g.y + im.top });
        }
        for (let r = 0; r < gl.cells.length; r++) {
          for (let c = 0; c < gl.cells[r].length; c++) {
            const cell = gl.cells[r][c];
            if (!cell) continue;
            const texts = cell.items
              .map((it) => all[it.srcRow]?.[it.srcCol] ?? "")
              .filter((tx) => tx.length > 0);
            const vertical = cell.items.some((it) => it.vertical);
            if (texts.length) {
              t.textCells++;
              if (vertical) t.verticalCells++;
              expectedCellTexts.push({ pi, x: g.x, y: g.y, r, c, texts, vertical });
            }
          }
        }
      }
    } else if (b.type === "image") {
      const g = b.geometry!;
      expectedStandalone.push({ pi, x: g.x, y: g.y });
    }
  }
}

function tableFor(pi: number, x: number, y: number) {
  return dom[pi]?.tables.find((t) => Math.abs(t.x - x) < 1.5 && Math.abs(t.y - y) < 1.5);
}

// Icons: nearest DOM icon within 2px + inside-td + inside-grid checks.
const iconPts = dom.flatMap((p, pi) =>
  p.tables.flatMap((t) => t.trs.flatMap((tr) => tr.tds.flatMap((td) => td.imgs.map((i) => ({ pi, x: i.x, y: i.y }))))),
);
let iconMatched = 0, iconInsideTd = 0, iconInsideGrid = 0, iconOver2 = 0;
const iconDevs: number[] = [];
for (const e of expectedIcons) {
  const pool = iconPts.filter((p) => p.pi === e.pi);
  const dev = pool.length ? Math.min(...pool.map((p) => Math.hypot(p.x - e.x, p.y - e.y))) : Infinity;
  iconDevs.push(dev);
  if (dev <= 2) iconMatched++;
  if (dev > 2) iconOver2++;
  // inside grid box
  const gt = expectedTables.find((t) => t.pi === e.pi && e.x >= t.x && e.x <= t.x + t.w && e.y >= t.y && e.y <= t.y + t.h);
  if (gt) iconInsideGrid++;
}
// inside td: match icon to its owning td via IR cellImages row/col is complex;
// use geometric containment: DOM td containing the expected point.
const iconTdOk: boolean[] = [];
for (const e of expectedIcons) {
  const t = tableFor(e.pi, expectedTables.find((x) => x.pi === e.pi && e.x >= x.x && e.x <= x.x + x.w && e.y >= x.y && e.y <= x.y + x.h)?.x ?? -1, expectedTables.find((x) => x.pi === e.pi && e.x >= x.x && e.x <= x.x + x.w && e.y >= x.y && e.y <= x.y + x.h)?.y ?? -1);
  const ok = t?.trs.some((tr) => tr.tds.some((td) => e.x >= td.x && e.x <= td.x + td.w && e.y >= td.y && e.y <= td.y + td.h)) ?? false;
  iconTdOk.push(ok);
  if (ok) iconInsideTd++;
}
iconDevs.sort((a, b) => a - b);

// Tables: origin, row/col structure, text cell placement, vertical direction.
const tableResults = expectedTables.map((t) => {
  const d = tableFor(t.pi, t.x, t.y);
  if (!d) return { ...t, originDev: Infinity, rowMatch: false, colMatch: false, textMatched: 0, textCells: t.textCells, verticalMatched: 0, verticalCells: t.verticalCells, found: false };
  const originDev = Math.max(Math.abs(d.x - t.x), Math.abs(d.y - t.y));
  const rowMatch = d.trs.length === t.rows;
  const colCounts = d.trs.map((tr) => tr.tds.reduce((n, td) => n + td.colspan, 0));
  const colMatch = colCounts.every((n) => n === t.cols);
  let textMatched = 0, verticalMatched = 0;
  const misses: { cell: string; expect: string[]; dom: string; verticalExpect: boolean; verticalDom: boolean[] }[] = [];
  for (const ec of expectedCellTexts.filter((x) => x.pi === t.pi && x.x === t.x && x.y === t.y)) {
    const td = d.trs[ec.r]?.tds.find((x) => x.col === ec.c);
    if (!td) continue;
    const ok = ec.texts.every((tx) => norm(td.text).includes(norm(tx)));
    if (ok) textMatched++;
    const vertOk = !ec.vertical || td.vertical;
    if (vertOk) verticalMatched++;
    if (!ok || !vertOk) {
      misses.push({ cell: `[${ec.r},${ec.c}]`, expect: ec.texts, dom: td.text, verticalExpect: ec.vertical, verticalDom: [td.vertical] });
    }
  }
  return { ...t, originDev, rowMatch, colMatch, textMatched, textCells: t.textCells, verticalMatched, verticalCells: t.verticalCells, found: true, misses };
});

const standaloneResults = expectedStandalone.map((s) => {
  const found = dom[s.pi]?.standalone.some((d) => Math.hypot(d.x - s.x, d.y - s.y) < 2) ?? false;
  return { ...s, found };
});

const report = {
  html: htmlPath,
  ir: irPath,
  lint: lint.length,
  icons: {
    expected: expectedIcons.length,
    dom: iconPts.length,
    matchedWithin2px: iconMatched,
    insideTd: iconInsideTd,
    insideGrid: iconInsideGrid,
    over2px: iconOver2,
    devP50: iconDevs.length ? iconDevs[Math.floor(iconDevs.length / 2)] : null,
    devMax: iconDevs.length ? iconDevs[iconDevs.length - 1] : null,
  },
  tables: tableResults,
  standalone: standaloneResults,
};
console.log(JSON.stringify(report, null, 2));

const ok =
  lint.length === 0 &&
  iconMatched === expectedIcons.length &&
  iconInsideTd === expectedIcons.length &&
  iconInsideGrid === expectedIcons.length &&
  tableResults.every((t) => t.found && t.originDev <= 1.5 && t.rowMatch && t.colMatch && t.textMatched === t.textCells && t.verticalMatched === t.verticalCells) &&
  standaloneResults.every((s) => s.found);
process.exit(ok ? 0 : 1);
