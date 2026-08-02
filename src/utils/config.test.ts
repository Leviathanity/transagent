import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig, resetConfigCache } from "./config.js";

afterEach(() => {
  delete process.env.PTL_CONFIG;
  delete process.env.PTL_OCR_PYTHON;
  delete process.env.PTL_PAGE_WIDTH;
  delete process.env.PTL_TRANSLATE_MODEL;
  delete process.env.PTL_WORK_DIR;
  resetConfigCache();
});

describe("loadConfig", () => {
  it("returns built-in defaults when nothing overrides", () => {
    resetConfigCache();
    const cfg = loadConfig();
    expect(cfg.page.width).toBe(1024);
    expect(cfg.paths.workDir).toBe("workdir");
    expect(cfg.lint.minOverlapY).toBe(5);
    expect(DEFAULT_CONFIG.ocr.modelPath).toContain("Unlimited-OCR");
  });

  it("prefers explicit overrides over defaults", () => {
    const cfg = loadConfig({
      page: { width: 2048 },
      models: { translate: "custom/model" },
    });
    expect(cfg.page.width).toBe(2048);
    expect(cfg.models.translate).toBe("custom/model");
    expect(cfg.page.dpi).toBe(300); // untouched keys keep defaults
  });

  it("merges environment variables", () => {
    process.env.PTL_OCR_PYTHON = "/usr/bin/python3";
    process.env.PTL_PAGE_WIDTH = "2048";
    process.env.PTL_TRANSLATE_MODEL = "env/model";
    process.env.PTL_WORK_DIR = "tmp-work";
    resetConfigCache();
    const cfg = loadConfig();
    expect(cfg.ocr.python).toBe("/usr/bin/python3");
    expect(cfg.page.width).toBe(2048);
    expect(cfg.models.translate).toBe("env/model");
    expect(cfg.paths.workDir).toBe("tmp-work");
  });

  it("merges a ptl.config.json file pointed to by PTL_CONFIG", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ptl-cfg-"));
    const file = join(dir, "ptl.config.json");
    await writeFile(
      file,
      JSON.stringify({ ocr: { dedupThreshold: 30 }, page: { dpi: 72 } }),
      "utf-8",
    );
    process.env.PTL_CONFIG = file;
    resetConfigCache();
    const cfg = loadConfig();
    expect(cfg.ocr.dedupThreshold).toBe(30);
    expect(cfg.page.dpi).toBe(72);
    expect(cfg.page.width).toBe(1024);
  });
});
