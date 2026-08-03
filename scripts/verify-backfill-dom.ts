#!/usr/bin/env bun
// Verify backfilled icon positions in a FINAL rendered HTML against the IR
// ground truth, using headless Chrome DevTools (CDP) computed layout.
//
// Usage:
//   bun run scripts/verify-backfill-dom.ts <final.html> <ir.json>
//
// Checks:
//   1. every cellImages entry has a DOM <img> at the exact table-relative spot
//   2. every overlay icon is inside its table container
//   3. contentOffset tables render at div origin + offset
//   4. standalone IR images have matching DOM positions
//   5. final lint stays 0

import puppeteer from "puppeteer-core";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseDocument } from "../src/utils/ir-serialization.js";
import { lintHtml } from "../src/utils/lint.js";

const [htmlPath, irPath] = process.argv.slice(2);
if (!htmlPath || !irPath) {
  console.error("Usage: bun run scripts/verify-backfill-dom.ts <final.html> <ir.json>");
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
  const pages: {
    tables: { left: number; top: number; width: number; height: number; offsetLeft: number | null; offsetTop: number | null; icons: { x: number; y: number; w: number; h: number }[] }[];
    standalone: { x: number; y: number; w: number; h: number; src: string }[];
  }[] = [];
  for (const el of document.querySelectorAll(".page")) {
    const pr = el.getBoundingClientRect();
    const tables = [];
    for (const table of el.querySelectorAll(":scope > .det-table")) {
      const tr = table.getBoundingClientRect();
      const inner = table.querySelector("table");
      let offsetLeft: number | null = null;
      let offsetTop: number | null = null;
      if (inner) {
        const ir2 = inner.getBoundingClientRect();
        offsetLeft = ir2.left - tr.left;
        offsetTop = ir2.top - tr.top;
      }
      const icons = [...table.querySelectorAll(".det-table-imgs img")].map((img) => {
        const r = img.getBoundingClientRect();
        return { x: r.left - pr.left, y: r.top - pr.top, w: r.width, h: r.height };
      });
      if (icons.length) tables.push({ left: tr.left - pr.left, top: tr.top - pr.top, width: tr.width, height: tr.height, offsetLeft, offsetTop, icons });
    }
    const standalone = [...el.querySelectorAll(".det-image")].map((d) => {
      const r = d.getBoundingClientRect();
      const img = d.querySelector("img");
      return { x: r.left - pr.left, y: r.top - pr.top, w: r.width, h: r.height, src: img?.getAttribute("src")?.slice(0, 40) ?? "" };
    });
    pages.push({ tables, standalone });
  }
  return pages;
});
await browser.close();

// Expected positions from the IR (table geometry + cellImages offsets).
const expectedIcons: { page: number; x: number; y: number }[] = [];
const expectedTables: { page: number; x: number; y: number; w: number; h: number; offX: number | null; offY: number | null; count: number }[] = [];
const expectedStandalone: { page: number; x: number; y: number }[] = [];
for (const [pi, page] of ir.pages.entries()) {
  for (const b of page.blocks) {
    if (b.type === "table") {
      const g = b.geometry!;
      const cellImages = b.cellImages ?? [];
      if (!cellImages.length) continue;
      expectedTables.push({
        page: pi,
        x: g.x,
        y: g.y,
        w: g.width,
        h: g.height,
        offX: b.contentOffset?.left ?? null,
        offY: b.contentOffset?.top ?? null,
        count: cellImages.length,
      });
      for (const im of cellImages) {
        expectedIcons.push({ page: pi, x: g.x + im.left, y: g.y + im.top });
      }
    } else if (b.type === "image") {
      const g = b.geometry!;
      expectedStandalone.push({ page: pi, x: g.x, y: g.y });
    }
  }
}

function nearest(pts: { x: number; y: number }[], x: number, y: number): number {
  return Math.min(...pts.map((p) => Math.hypot(p.x - x, p.y - y)));
}

const iconResults: { page: number; expected: { x: number; y: number }; dom: { x: number; y: number } | null; dev: number; inside: boolean }[] = [];
let iconsMatched = 0;
let iconsInside = 0;
for (const e of expectedIcons) {
  const pool = dom[e.page]?.tables.flatMap((t) => t.icons) ?? [];
  const dev = pool.length ? nearest(pool, e.x, e.y) : Infinity;
  const match = pool.find((p) => Math.hypot(p.x - e.x, p.y - e.y) < 2);
  const table = expectedTables.find((t) => t.page === e.page);
  const inside = !!table && e.x >= table.x - 1 && e.x <= table.x + table.w + 1 && e.y >= table.y - 1 && e.y <= table.y + table.h + 1;
  if (match) iconsMatched++;
  if (inside) iconsInside++;
  iconResults.push({
    page: e.page,
    expected: { x: e.x, y: e.y },
    dom: match ? { x: match.x, y: match.y } : null,
    dev: +dev.toFixed(2),
    inside,
  });
}

const tableResults = expectedTables.map((t) => {
  const d = dom[t.page]?.tables.find((x) => Math.abs(x.left - t.x) < 1 && Math.abs(x.top - t.y) < 1);
  return {
    expected: t,
    domBox: d ? { x: d.left, y: d.top, w: d.width, h: d.height } : null,
    originDev: d ? +Math.max(Math.abs(d.left - t.x), Math.abs(d.top - t.y)).toFixed(2) : Infinity,
    offsetDev: d && t.offX !== null && d.offsetLeft !== null
      ? +Math.max(Math.abs(d.offsetLeft - t.offX), Math.abs(d.offsetTop! - t.offY!)).toFixed(2)
      : null,
  };
});

const standaloneResults = expectedStandalone.map((s) => {
  const d = dom[s.page]?.standalone.find((x) => Math.abs(x.x - s.x) < 2 && Math.abs(x.y - s.y) < 2);
  return { page: s.page, expected: s, found: !!d, dev: d ? +Math.hypot(d.x - s.x, d.y - s.y).toFixed(2) : Infinity };
});

const devs = iconResults.map((r) => r.dev).filter((d) => Number.isFinite(d)).sort((a, b) => a - b);
const report = {
  html: htmlPath,
  ir: irPath,
  lint: lint.length,
  icons: {
    expected: expectedIcons.length,
    dom: dom.reduce((n, p) => n + p.tables.reduce((m, t) => m + t.icons.length, 0), 0),
    matchedWithin2px: iconsMatched,
    insideTable: iconsInside,
    devP50: devs.length ? devs[Math.floor(devs.length / 2)] : null,
    devMax: devs.length ? devs[devs.length - 1] : null,
    over2px: devs.filter((d) => d > 2).length,
  },
  tables: tableResults,
  standalone: standaloneResults,
};
console.log(JSON.stringify(report, null, 2));

const ok =
  lint.length === 0 &&
  report.icons.matchedWithin2px === expectedIcons.length &&
  report.icons.insideTable === expectedIcons.length &&
  standaloneResults.every((s) => s.found) &&
  tableResults.every((t) => (t.domBox ? t.originDev <= 1.5 : false) && (t.offsetDev === null || t.offsetDev <= 1.5));
process.exit(ok ? 0 : 1);
