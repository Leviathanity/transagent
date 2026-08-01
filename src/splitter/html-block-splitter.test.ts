import { describe, it, expect } from "bun:test";
import { splitHtmlToBlocks, assembleHtmlBlocks } from "./html-block-splitter.js";

describe("splitHtmlToBlocks", () => {
  it("splits on <h2> boundaries", () => {
    const html = "<h2>One</h2><p>text one</p><h2>Two</h2><p>text two</p>";
    const result = splitHtmlToBlocks(html);
    expect(result.length).toBe(2);
    expect(result[0].block.text).toContain("<h2>One</h2>");
    expect(result[1].block.text).toContain("<h2>Two</h2>");
  });

  it("extracts <table> as independent block", () => {
    const html = "<h2>Table</h2><table><tr><td>a</td><td>b</td></tr></table><p>text after</p>";
    const result = splitHtmlToBlocks(html);
    const tableBlocks = result.filter((b) => b.block.type === "table");
    expect(tableBlocks.length).toBe(1);
    expect(tableBlocks[0].block.text).toContain("<table>");
    if (tableBlocks[0].block.type === "table") {
      expect(tableBlocks[0].block.rows).toEqual([["a", "b"]]);
    }
  });

  it("extracts <pre> as independent block", () => {
    const html = "<pre><code>code block</code></pre>";
    const result = splitHtmlToBlocks(html);
    expect(result.length).toBe(1);
    expect(result[0].block.type).toBe("code");
  });

  it("preserves separatorBefore for reassembly", () => {
    const html = "<h2>A</h2><p>content a</p>\n<h2>B</h2><p>content b</p>";
    const blocks = splitHtmlToBlocks(html);
    const assembled = assembleHtmlBlocks(blocks, (b) => b.text);
    expect(assembled).toBe(html);
  });

  it("handles text before first heading", () => {
    const html = "<p>intro</p><h2>Section</h2><p>body</p>";
    const result = splitHtmlToBlocks(html);
    expect(result.length).toBe(2);
    expect(result[0].block.level).toBe(0);
    expect(result[0].block.type).toBe("paragraph");
  });

  it("labels heading blocks correctly", () => {
    const html = "<h2>Section A</h2><p>text</p><h3>Subsection</h3><p>more</p>";
    const result = splitHtmlToBlocks(html);
    expect(result[0].block.type).toBe("heading");
    expect(result[0].block.level).toBe(2);
    expect(result[1].block.type).toBe("heading");
    expect(result[1].block.level).toBe(3);
  });

  it("splits pixel-perfect top-level elements when there are no h2/h3", () => {
    const html =
      '<div class="page"><div style="left:1px">One</div></div>\n' +
      '<div class="det-table"><table><tr><td>a</td><td>b</td></tr></table></div>\n' +
      '<div class="det-image"><img src="x.png"></div>';
    const result = splitHtmlToBlocks(html);
    expect(result.length).toBe(3);
    expect(result[0].block.text).toContain("<div class=\"page\">");
    expect(result[0].block.text).toContain("One");
    expect(result[1].block.type).toBe("table");
    expect(result[1].block.text).toContain("<table>");
    expect(result[2].block.text).toContain("<img");
    const assembled = assembleHtmlBlocks(result, (b) => b.text);
    // linkedom normalizes <img> into <img></img>; both forms render identically
    expect(assembled.replaceAll("</img>", "")).toBe(html.replaceAll("</img>", ""));
  });
});
