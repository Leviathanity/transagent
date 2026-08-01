import { describe, it, expect } from "bun:test";
import {
  charWidthEm,
  lineTextWidth,
  maxLineTextWidth,
  estimateLineCount,
} from "./text-metrics.js";

describe("text metrics", () => {
  it("uses full width for CJK and ~0.65em for Latin characters", () => {
    expect(charWidthEm("中")).toBe(1);
    expect(charWidthEm("A")).toBe(0.65);
    expect(charWidthEm("A", true)).toBe(0.7);
  });

  it("estimates the real rendered width of the handbook header", () => {
    // Chrome measures "CEER SUPPLIER QUALITY" at 27.5px Times New Roman ≈ 333px
    const w = maxLineTextWidth("CEER SUPPLIER QUALITY\nHANDBOOK", 27.5);
    expect(w).toBeGreaterThan(333);
    expect(Math.ceil(w)).toBe(376);
  });

  it("counts wrapped lines per explicit line", () => {
    // 375px of text in a 327px box wraps to 2 lines; in a 376px box it fits
    const text = "CEER SUPPLIER QUALITY\nHANDBOOK";
    expect(estimateLineCount(text, 327, 27.5)).toBe(3);
    expect(estimateLineCount(text, 376, 27.5)).toBe(2);
  });

  it("counts CJK text at one em per character", () => {
    expect(lineTextWidth("供应商质量手册", 12)).toBe(84);
  });
});
