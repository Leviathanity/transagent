import { describe, it, expect } from "bun:test";
import { renderSemanticHtml } from "./semantic.js";
import type { DocumentIR } from "../types/document-ir.js";

const ir: DocumentIR = {
  pages: [
    {
      width: 800,
      height: 1000,
      blocks: [
        {
          id: "sb_0_0",
          type: "heading",
          level: 2,
          text: "Section & One",
          separatorBefore: "",
        },
        {
          id: "sb_0_1",
          type: "paragraph",
          level: 0,
          text: "Intro text",
          separatorBefore: "",
        },
        {
          id: "sb_0_2",
          type: "table",
          level: 0,
          text: "",
          headerRows: [["Name", "Value"]],
          rows: [["A <B>", "1"]],
          separatorBefore: "\n",
        },
        {
          id: "sb_0_3",
          type: "image",
          level: 0,
          text: "",
          src: "logo.png",
          alt: "logo",
          separatorBefore: "\n",
        },
        {
          id: "sb_0_4",
          type: "list",
          level: 0,
          text: "first\nsecond",
          separatorBefore: "\n",
        },
        {
          id: "sb_0_5",
          type: "code",
          level: 0,
          text: "const x = 1;",
          separatorBefore: "\n",
        },
        {
          id: "sb_0_6",
          type: "toc",
          level: 0,
          text: "1. Intro ...... 1",
          separatorBefore: "\n",
        },
      ],
    },
  ],
};

describe("renderSemanticHtml", () => {
  const html = renderSemanticHtml(ir);

  it("renders headings by level", () => {
    expect(html).toContain("<h2>Section &amp; One</h2>");
  });

  it("renders paragraphs", () => {
    expect(html).toContain("<p>Intro text</p>");
  });

  it("renders tables with thead/tbody", () => {
    expect(html).toContain("<table><thead><tr><th>Name</th><th>Value</th></tr></thead>");
    expect(html).toContain("<tbody><tr><td>A &lt;B&gt;</td><td>1</td></tr></tbody>");
  });

  it("renders images", () => {
    expect(html).toContain('<img src="logo.png" alt="logo">');
  });

  it("renders lists as ul/li", () => {
    expect(html).toContain("<ul><li>first</li><li>second</li></ul>");
  });

  it("renders code blocks", () => {
    expect(html).toContain("<pre><code>const x = 1;</code></pre>");
  });

  it("escapes other/toc text", () => {
    expect(html).toContain("1. Intro ...... 1");
  });

  it("preserves separatorBefore between blocks", () => {
    expect(html).toContain("</p>\n<table>");
  });
});
