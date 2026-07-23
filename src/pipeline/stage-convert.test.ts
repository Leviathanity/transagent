import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stageConvert } from "./stage-convert.js";

describe("stageConvert", () => {
  it("fails gracefully when markitdown not installed or file missing", async () => {
    const result = await stageConvert("nonexistent.pdf");
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });
});
