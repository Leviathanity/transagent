import { describe, it, expect } from "bun:test";
import { detectDirection } from "./direction-detector.js";

describe("detectDirection", () => {
  it("detects Chinese text", () => {
    expect(detectDirection("这是一段中文文本用于测试方向检测功能")).toBe("zh2en");
  });

  it("detects English text", () => {
    expect(detectDirection("This is an English text for testing direction detection")).toBe("en2zh");
  });

  it("handles mixed content with high CJK ratio", () => {
    const mixed = "中文字符较多 English words 中文字符较多 中文字符较多 中文字符较多 中文字符较多 中文字符较多";
    expect(detectDirection(mixed)).toBe("zh2en");
  });
});
