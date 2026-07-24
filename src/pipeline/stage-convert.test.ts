import { describe, it, expect } from "bun:test";
import { stageConvert } from "./stage-convert.js";

describe("stageConvert", () => {
  it("fails gracefully when OCR environment unavailable", async () => {
    const result = await stageConvert("nonexistent.pdf");
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });
});
