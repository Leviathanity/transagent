#!/usr/bin/env bun
// Verify the new Document IR pipeline end-to-end:
//   bun run scripts/verify-ir.ts <input.pdf> <ir.json> <output.html>
// Runs the real Unlimited-OCR converter, renders the IR, and reports stats + lint.

import { readFile, writeFile } from "node:fs/promises";
import { stageConvertToIr } from "../src/pipeline/stage-convert.js";
import { parseDocument } from "../src/utils/ir-serialization.js";
import { renderPixelPerfectHtml } from "../src/renderers/pixel-perfect.js";
import { lintHtml } from "../src/utils/lint.js";

const [pdfPath, irPath, htmlPath] = process.argv.slice(2);
if (!pdfPath || !irPath || !htmlPath) {
  console.error("Usage: bun run scripts/verify-ir.ts <input.pdf> <ir.json> <output.html>");
  process.exit(1);
}

const r = await stageConvertToIr(pdfPath, irPath);
if (!r.success) {
  console.error(`Convert failed: ${r.error}`);
  process.exit(1);
}

const ir = parseDocument(await readFile(irPath, "utf-8"));
const byType = new Map<string, number>();
let tables = 0;
let images = 0;
for (const page of ir.pages) {
  for (const b of page.blocks) {
    byType.set(b.type, (byType.get(b.type) ?? 0) + 1);
    if (b.type === "table") tables++;
    if (b.type === "image") images++;
  }
}

const html = renderPixelPerfectHtml(ir);
await writeFile(htmlPath, html, "utf-8");
const lint = lintHtml(html);

console.log(
  JSON.stringify(
    {
      pages: ir.pages.length,
      blocks: [...byType.entries()].reduce((n, [, c]) => n + c, 0),
      byType: Object.fromEntries(byType),
      tables,
      images,
      htmlBytes: Buffer.byteLength(html),
      lintIssues: lint.length,
      lintTop: lint.slice(0, 5),
      irPath,
      htmlPath,
    },
    null,
    2,
  ),
);
