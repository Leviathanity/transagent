import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeOcrPayload,
  type OcrPayload,
} from "../../src/converters/unlimited-ocr.js";
import { renderPixelPerfectHtml } from "../../src/renderers/pixel-perfect.js";
import { renderSemanticHtml } from "../../src/renderers/semantic.js";
import { lintHtml } from "../../src/utils/lint.js";
import { serializeDocument, parseDocument } from "../../src/utils/ir-serialization.js";
import { stageTranslate, type SessionFactory } from "../../src/pipeline/stage-translate.js";
import type { DocumentIR } from "../../src/types/document-ir.js";

const OCR_PAYLOAD: OcrPayload = {
  pages: [
    {
      width: 1024,
      height: 1448,
      blocks: [
        {
          type: "title",
          bbox: [80, 60, 680, 100],
          text: "Supplier Quality Handbook",
          font: { family: "Arial", size: 24, bold: true },
        },
        {
          type: "paragraph",
          bbox: [80, 130, 650, 170],
          text: "General terms and conditions apply.",
        },
        {
          type: "table",
          bbox: [80, 200, 600, 320],
          html: "<table><tr><th>Part</th><th>Qty</th></tr><tr><td>Bolt</td><td>12</td></tr></table>",
        },
        { type: "image", bbox: [700, 30, 800, 130], src: "emb_p0000_n0.png", alt: "logo" },
        { type: "page_number", bbox: [900, 1400, 980, 1420], text: "1" },
      ],
    },
  ],
};

describe("IR pipeline integration (no GPU / no LLM)", () => {
  it("converts OCR payload → IR → pixel-perfect HTML without det tags", () => {
    const ir = normalizeOcrPayload(OCR_PAYLOAD);
    const html = renderPixelPerfectHtml(ir);

    expect(html).toContain('class="page"');
    expect(html).toContain("Supplier Quality Handbook");
    expect(html).toContain("<th>Part</th>");
    expect(html).not.toContain("<|det|>");
    expect(html).not.toContain("<PAGE_BREAK>");
  });

  it("renders semantic HTML from IR without geometry", () => {
    const ir: DocumentIR = {
      pages: [
        {
          width: 800,
          height: 1000,
          blocks: [
            { id: "b1", type: "heading", level: 2, text: "Section" },
            { id: "b2", type: "paragraph", level: 0, text: "Body" },
            {
              id: "b3",
              type: "table",
              level: 0,
              text: "",
              headerRows: [["A"]],
              rows: [["1"]],
            },
          ],
        },
      ],
    };
    const html = renderSemanticHtml(ir);
    expect(html).toContain("<h2>Section</h2>");
    expect(html).toContain("<tbody><tr><td>1</td></tr></tbody>");
  });

  it("lint finds overlapping geometry and passes clean layout", () => {
    const ir = normalizeOcrPayload(OCR_PAYLOAD);
    const html = renderPixelPerfectHtml(ir);
    const issues = lintHtml(html);
    console.log("lint issues:", JSON.stringify(issues, null, 2));
    expect(issues.length).toBe(0);

    // Force an overlap by moving the table onto the paragraph.
    const overlapped = normalizeOcrPayload({
      pages: [
        {
          width: 1024,
          height: 1448,
          blocks: [
            { type: "image", bbox: [80, 100, 200, 300], src: "x.png", alt: "img" },
            { type: "paragraph", bbox: [80, 120, 500, 160], text: "overlaps image" },
          ],
        },
      ],
    });
    expect(lintHtml(renderPixelPerfectHtml(overlapped)).length).toBeGreaterThan(0);
  });

  it("runs translate → render end-to-end with a fake session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ptl-ir-e2e-"));
    try {
      const input = join(dir, "in.ir.json");
      const output = join(dir, "out.ir.json");
      const ir = normalizeOcrPayload(OCR_PAYLOAD);
      await writeFile(input, serializeDocument(ir), "utf-8");

      const factory: SessionFactory = async () => ({
        async prompt(p: string) {
          // Echo prompt content back with a marker.
          const body = p.split("\n\n").slice(1).join("\n\n").trim();
          this.lastText = body
            .split("\n")
            .map((l) => (l.trim() ? `译:${l.trim()}` : l))
            .join("\n");
        },
        lastText: "",
        getLastAssistantMessage() {
          return this.lastText
            ? { content: [{ type: "text", text: this.lastText }] }
            : null;
        },
        async dispose() {},
      });

      const r = await stageTranslate(
        undefined,
        "en2zh",
        2,
        "fake",
        input,
        output,
        factory,
      );
      expect(r.success).toBe(true);

      const translated = parseDocument(await readFile(output, "utf-8"));
      const html = renderPixelPerfectHtml(translated);
      expect(html).toContain("译:Supplier Quality Handbook");
      expect(html).toContain("译:General terms and conditions apply.");
      expect(html).toContain("<th>译:Part</th>");
      expect(html).toContain('src="emb_p0000_n0.png"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("round-trips IR JSON through files without losing geometry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ptl-ir-roundtrip-"));
    try {
      const file = join(dir, "doc.ir.json");
      const ir = normalizeOcrPayload(OCR_PAYLOAD);
      await writeFile(file, serializeDocument(ir), "utf-8");
      const parsed = parseDocument(await readFile(file, "utf-8"));
      expect(parsed.pages[0].blocks[0].geometry).toEqual({ x: 80, y: 60, width: 600, height: 40 });
      expect(renderPixelPerfectHtml(parsed)).toContain("Supplier Quality Handbook");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("external OCR script is present and compiles", () => {
    const result = spawnSync("python3", ["-m", "py_compile", "scripts/ocr/pdf_to_ir.py"], {
      encoding: "utf-8",
    });
    expect(result.status).toBe(0);
  });
});
