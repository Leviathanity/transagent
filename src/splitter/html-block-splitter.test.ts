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
    const tableBlocks = result.filter((b) => b.block.blockType === "table");
    expect(tableBlocks.length).toBe(1);
    expect(tableBlocks[0].block.text).toContain("<table>");
  });

  it("extracts <pre> as independent block", () => {
    const html = "<pre><code>code block</code></pre>";
    const result = splitHtmlToBlocks(html);
    expect(result.length).toBe(1);
    expect(result[0].block.blockType).toBe("code");
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
    expect(result[0].block.blockType).toBe("paragraph");
  });

  it("labels heading blocks correctly", () => {
    const html = "<h2>Section A</h2><p>text</p><h3>Subsection</h3><p>more</p>";
    const result = splitHtmlToBlocks(html);
    expect(result[0].block.blockType).toBe("heading");
    expect(result[0].block.level).toBe(2);
    expect(result[1].block.blockType).toBe("heading");
    expect(result[1].block.level).toBe(3);
  });
});
