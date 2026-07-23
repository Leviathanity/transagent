import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stageConvert } from "./stage-convert.js";

describe("stageConvert", () => {
  let workDir: string;

  afterEach(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("fails gracefully when markitdown not installed", async () => {
    workDir = await mkdtemp(join(tmpdir(), "ptl-test-"));
    const result = await stageConvert("nonexistent.pdf", workDir);
    if (!result.success) {
      expect(result.error).toContain("not installed");
    }
  });
});
