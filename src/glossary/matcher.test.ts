import { describe, it, expect } from "bun:test";
import { formatForPrompt } from "./matcher.js";

describe("formatForPrompt", () => {
  it("formats entries as markdown prompt fragment", () => {
    const result = formatForPrompt([
      { source: "API", target: "应用程序接口", context: "技术文档" },
    ]);
    expect(result).toContain("API");
    expect(result).toContain("应用程序接口");
    expect(result).toContain("技术文档");
  });

  it("marks regex entries", () => {
    const result = formatForPrompt([
      { source: "\\d+", target: "$0", regex: true },
    ]);
    expect(result).toContain("[regex]");
  });

  it("returns empty string for empty entries", () => {
    expect(formatForPrompt([])).toBe("");
  });
});
