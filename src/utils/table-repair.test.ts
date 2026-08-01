import { describe, it, expect } from "bun:test";
import { repairTableStructure } from "./table-repair.js";

describe("repairTableStructure", () => {
  it("removes stray empty cells from over-wide rows", () => {
    const html =
      '<table><tr><td>a</td><td>b</td><td>c</td><td>d</td><td>e</td></tr>' +
      '<tr><td>a</td><td>b</td><td>c</td><td>d</td><td>e</td><td></td></tr>' +
      '<tr><td>a</td><td>b</td><td>c</td><td>d</td><td>e</td></tr></table>';
    const r = repairTableStructure(html);
    expect(r.cellsRemoved).toBe(1);
    expect(r.tablesRepaired).toBe(1);
    expect((r.repaired.match(/<td>/g) ?? []).length).toBe(15);
  });

  it("pads short rows with empty cells", () => {
    const html =
      "<table><tr><td>a</td><td>b</td><td>c</td><td>d</td><td>e</td></tr>" +
      "<tr><td>a</td><td>b</td><td>c</td><td>d</td></tr></table>";
    const r = repairTableStructure(html);
    expect(r.cellsAdded).toBe(1);
    expect((r.repaired.match(/<td>/g) ?? []).length).toBe(10);
  });

  it("widens the table instead of dropping non-empty surplus cells", () => {
    const html =
      "<table><tr><td>a</td><td>b</td><td>c</td></tr>" +
      "<tr><td>a</td><td>b</td><td>c</td><td>KEEP</td></tr></table>";
    const r = repairTableStructure(html);
    expect(r.cellsRemoved).toBe(0);
    expect(r.cellsAdded).toBe(1);
    expect(r.repaired).toContain("KEEP");
    expect((r.repaired.match(/<td>/g) ?? []).length).toBe(8);
  });

  it("preserves the document shell including <style>", () => {
    const html =
      '<!doctype html><html><head><style>.x{color:red}</style></head><body>' +
      "<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>a</td><td>b</td><td>c</td><td></td></tr></table>" +
      "</body></html>";
    const r = repairTableStructure(html);
    expect(r.repaired).toContain("<style>");
    expect(r.repaired).toContain(".x{color:red}");
    expect(r.repaired.toLowerCase()).toContain("<!doctype html>");
  });
});
