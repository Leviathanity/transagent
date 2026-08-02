import { describe, it, expect } from "bun:test";
import { normalizeOcrPayload, type OcrPayload } from "./unlimited-ocr.js";

describe("normalizeOcrPayload", () => {
  const payload: OcrPayload = {
    pages: [
      {
        width: 1024,
        height: 1448,
        blocks: [
          {
            type: "title",
            bbox: [80, 60, 680, 100],
            text: "Quality Handbook",
            font: { family: "Arial", size: 24, bold: true, color: "#000000" },
          },
          {
            type: "paragraph",
            bbox: [80, 120, 900, 160],
            text: "General terms and conditions.",
            font: { family: "Times", size: 11 },
          },
          {
            type: "table",
            bbox: [80, 200, 600, 320],
            html: "<table><tr><th>Part</th><th>Qty</th></tr><tr><td>Bolt</td><td>12</td></tr></table>",
          },
          {
            type: "image",
            bbox: [700, 60, 800, 160],
            src: "emb_p0000_n0.png",
            alt: "logo",
          },
          { type: "header", bbox: [80, 20, 600, 40], text: "Company A" },
          { type: "page_number", bbox: [900, 1400, 980, 1420], text: "1" },
        ],
      },
    ],
  };

  const ir = normalizeOcrPayload(payload);

  it("maps OCR types to IR block types", () => {
    const types = ir.pages[0].blocks.map((b) => b.type);
    expect(types).toEqual(["heading", "paragraph", "table", "image", "other", "other"]);
  });

  it("converts bbox to geometry in display space", () => {
    const title = ir.pages[0].blocks[0];
    expect(title.geometry).toEqual({ x: 80, y: 60, width: 600, height: 40 });
  });

  it("parses table HTML into headerRows and rows", () => {
    const table = ir.pages[0].blocks[2];
    expect(table.type).toBe("table");
    if (table.type === "table") {
      expect(table.headerRows).toEqual([["Part", "Qty"]]);
      expect(table.rows).toEqual([["Bolt", "12"]]);
    }
  });

  it("carries image src and alt", () => {
    const img = ir.pages[0].blocks[3];
    expect(img.type).toBe("image");
    if (img.type === "image") {
      expect(img.src).toBe("emb_p0000_n0.png");
      expect(img.alt).toBe("logo");
    }
  });

  it("keeps font styling on text blocks", () => {
    const title = ir.pages[0].blocks[0];
    expect(title.font?.family).toBe("Arial");
    expect(title.font?.bold).toBe(true);
  });

  it("assigns stable block ids per page", () => {
    expect(ir.pages[0].blocks.map((b) => b.id)).toEqual([
      "sb_0_0",
      "sb_0_1",
      "sb_0_2",
      "sb_0_3",
      "sb_0_4",
      "sb_0_5",
    ]);
  });

  it("carries image identity/kind/placements into the IR", () => {
    const ir = normalizeOcrPayload({
      pages: [
        {
          width: 1024,
          height: 1448,
          blocks: [
            {
              type: "image",
              bbox: [100, 100, 200, 200],
              src: "img_x42.png",
              alt: "logo",
              identity: { xref: 42, hash: "abc123", sourceName: "img_x42.png" },
              kind: "content",
              placements: [
                { page: 0, x: 100, y: 100, width: 100, height: 100 },
              ],
            },
          ],
        },
      ],
    });
    const block = ir.pages[0].blocks[0];
    if (block.type === "image") {
      expect(block.identity?.xref).toBe(42);
      expect(block.kind).toBe("content");
      expect(block.placements?.length).toBe(1);
    } else {
      throw new Error("expected image block");
    }
  });
});
