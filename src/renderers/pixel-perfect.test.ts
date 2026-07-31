import { describe, it, expect } from "bun:test";
import { renderPixelPerfectHtml } from "./pixel-perfect.js";
import type { DocumentIR } from "../types/document-ir.js";

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
          text: "Quality & Safety",
          sourceType: "title",
          geometry: { x: 80, y: 60, width: 600, height: 40 },
          font: { family: "Arial", size: 24, bold: true, color: "#000000" },
        },
        {
          id: "sb_0_1",
          type: "paragraph",
          level: 0,
          text: "Line one\nLine two",
          sourceType: "paragraph",
          geometry: { x: 80, y: 120, width: 500, height: 60 },
          font: { family: "Times", size: 12 },
        },
        {
          id: "sb_0_2",
          type: "table",
          level: 0,
          text: "",
          sourceType: "table",
          headerRows: [["Part <A>", "Qty"]],
          rows: [["Bolt", "12"]],
          geometry: { x: 80, y: 200, width: 400, height: 120 },
        },
        {
          id: "sb_0_3",
          type: "image",
          level: 0,
          text: "",
          sourceType: "image",
          src: "emb_p0000_n0.png",
          alt: "logo",
          geometry: { x: 700, y: 60, width: 100, height: 100 },
        },
        {
          id: "sb_0_4",
          type: "other",
          level: 0,
          text: "1",
          sourceType: "page_number",
          geometry: { x: 900, y: 1400, width: 80, height: 30 },
        },
      ],
    },
  ],
};

describe("renderPixelPerfectHtml", () => {
  const html = renderPixelPerfectHtml(ir);

  it("renders a positioned page container", () => {
    expect(html).toContain(
      '<div class="page" style="position:relative;width:1024px;height:1448px;margin:0 auto;overflow:hidden;background:#fff;">',
    );
  });

  it("applies geometry and font styling to text blocks", () => {
    expect(html).toContain('left:80px;top:60px;');
    expect(html).toContain("font-family:Arial;");
    expect(html).toContain("font-size:24.0px;font-weight:bold;");
    expect(html).toContain("color:#000000;");
  });

  it("escapes text content", () => {
    expect(html).toContain("Quality &amp; Safety");
  });

  it("uses pre-line wrapping for multi-line text", () => {
    expect(html).toContain("white-space:pre-line");
    expect(html).toContain("Line one\nLine two");
  });

  it("renders table cells with th/td and escapes them", () => {
    expect(html).toContain('class="det-table"');
    expect(html).toContain("<th>Part &lt;A&gt;</th>");
    expect(html).toContain("<td>Bolt</td>");
  });

  it("pads short table rows so no cell border is missing", () => {
    const ir2: DocumentIR = {
      pages: [
        {
          width: 1024,
          height: 1448,
          blocks: [
            {
              id: "t1",
              type: "table",
              level: 0,
              text: "",
              headerRows: [["a", "b", "c"]],
              rows: [["x", "y"]],
              geometry: { x: 80, y: 100, width: 400, height: 80 },
            },
          ],
        },
      ],
    };
    const out = renderPixelPerfectHtml(ir2);
    expect(out).toContain("<td>x</td><td>y</td><td></td>");
  });

  it("renders images with src and alt", () => {
    expect(html).toContain('class="det-image"');
    expect(html).toContain('src="emb_p0000_n0.png"');
    expect(html).toContain('alt="logo"');
  });

  it("right-aligns page numbers", () => {
    expect(html).toContain("text-align:right;");
  });

  it("includes base CSS for pages and tables", () => {
    expect(html).toContain("<style>");
    expect(html).toContain(".det-table td");
  });
});
