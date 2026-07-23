import { describe, it, expect } from "bun:test";
import { splitToSeparatedBlocks, assembleFromSeparatedBlocks } from "./source-block-splitter.js";

describe("splitToSeparatedBlocks", () => {
  it("splits on H2 boundaries", () => {
    const md = "## One\ntext one\n\n## Two\ntext two\n";
    const result = splitToSeparatedBlocks(md);
    expect(result.length).toBe(2);
    expect(result[0].block.text).toContain("## One");
    expect(result[1].block.text).toContain("## Two");
  });

  it("extracts table as independent block", () => {
    const md = "## Table\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ntext after\n";
    const result = splitToSeparatedBlocks(md);
    const tableBlocks = result.filter((b) => b.block.text.includes("|"));
    expect(tableBlocks.length).toBe(1);
  });

  it("preserves separatorBefore for reassembly", () => {
    const md = "## A\ncontent a\n\n## B\ncontent b\n";
    const blocks = splitToSeparatedBlocks(md);
    const assembled = assembleFromSeparatedBlocks(blocks, (b) => b.text);
    expect(assembled).toBe(md);
  });

  it("handles text before first heading", () => {
    const md = "intro text\n\n## Section\nbody\n";
    const result = splitToSeparatedBlocks(md);
    expect(result.length).toBe(2);
    expect(result[0].block.text).toContain("intro text");
  });
});
