import { describe, it, expect } from "bun:test";
import { parseTableHtml, parseMarkdownTable } from "./table-cells.js";

describe("parseTableHtml", () => {
  it("keeps empty cells instead of dropping them", () => {
    const r = parseTableHtml(
      "<table><tr><td>a</td><td></td><td>c</td></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>",
    );
    expect(r.rows).toEqual([
      ["a", "", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("pads short rows to the global column count", () => {
    const r = parseTableHtml(
      "<table><tr><th>h1</th><th>h2</th><th>h3</th></tr><tr><td>x</td><td>y</td></tr></table>",
    );
    expect(r.headerRows).toEqual([["h1", "h2", "h3"]]);
    expect(r.rows).toEqual([["x", "y", ""]]);
  });
});

describe("parseMarkdownTable", () => {
  it("pads short rows to the global column count", () => {
    const r = parseMarkdownTable("| a | b | c |\n|---|---|---|\n| 1 | 2 |");
    expect(r.headerRows).toEqual([["a", "b", "c"]]);
    expect(r.rows).toEqual([["1", "2", ""]]);
  });
});
