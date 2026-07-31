import { describe, it, expect } from "bun:test";
import { serializeDocument, parseDocument } from "./ir-serialization.js";
import type { DocumentIR } from "../types/document-ir.js";

describe("Document IR serialization", () => {
  const ir: DocumentIR = {
    pages: [
      {
        width: 1024,
        height: 1448,
        blocks: [
          {
            id: "sb_0_0",
            type: "heading",
            level: 1,
            text: "Quality Handbook",
            geometry: { x: 80, y: 60, width: 600, height: 40 },
            font: { family: "Arial", size: 24, bold: true },
          },
          {
            id: "sb_0_1",
            type: "table",
            level: 0,
            text: "",
            headerRows: [["Part", "Qty"]],
            rows: [["Bolt", "12"], ["Nut", "6"]],
            geometry: { x: 80, y: 120, width: 400, height: 120 },
          },
          {
            id: "sb_0_2",
            type: "image",
            level: 0,
            text: "",
            src: "emb_p0000_n0.png",
            alt: "logo",
            geometry: { x: 700, y: 60, width: 100, height: 100 },
          },
        ],
      },
    ],
  };

  it("round-trips a document through JSON", () => {
    const parsed = parseDocument(serializeDocument(ir));
    expect(parsed).toEqual(ir);
  });

  it("rejects documents without pages", () => {
    expect(() => parseDocument('{"foo": 1}')).toThrow();
  });

  it("preserves nested table payloads", () => {
    const parsed = parseDocument(serializeDocument(ir));
    const table = parsed.pages[0].blocks[1];
    expect(table.type).toBe("table");
    if (table.type === "table") {
      expect(table.headerRows).toEqual([["Part", "Qty"]]);
      expect(table.rows).toEqual([["Bolt", "12"], ["Nut", "6"]]);
    }
  });
});
