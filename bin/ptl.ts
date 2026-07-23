#!/usr/bin/env bun
// bin/ptl.ts

import { runPipeline } from "../src/pipeline/orchestrator.js";
import { readFile, mkdir, writeFile, unlink } from "node:fs/promises";
import type { PipelineConfig } from "../src/types/pipeline.js";
import { detectDirection } from "../src/utils/direction-detector.js";

const args = process.argv.slice(2);

if (args[0] === "check") {
  console.log("pdf-translator environment check\n");

  console.log(`Bun:       v${Bun.version}`);
  console.log(`Node:      ${process.version}`);

  try {
    const { execa } = await import("execa");
    const r = await execa("markitdown", ["--version"], { timeout: 10000, reject: false });
    if (r.exitCode === 0 && r.stdout.trim()) {
      console.log(`MarkItDown: ${r.stdout.trim()}`);
    } else {
      console.log(`MarkItDown: NOT FOUND — run: pip install 'markitdown[all]'`);
    }
  } catch {
    console.log(`MarkItDown: NOT FOUND — run: pip install 'markitdown[all]'`);
  }

  try {
    const { execa } = await import("execa");
    const r = await execa("python", ["--version"], { timeout: 5000, reject: false });
    console.log(`Python:    ${r.stdout.trim() || r.stderr.trim()}`);
  } catch {
    console.log(`Python:    NOT FOUND`);
  }

  const key = Bun.env.DEEPSEEK_API_KEY || Bun.env.ANTHROPIC_API_KEY;
  console.log(`API Key:   ${key ? "SET" : "NOT SET — set DEEPSEEK_API_KEY or ANTHROPIC_API_KEY"}`);

  try {
    await mkdir("workdir", { recursive: true });
    const testFile = "workdir/.test-write";
    await writeFile(testFile, "test");
    await unlink(testFile);
    console.log(`workdir:   writable`);
  } catch {
    console.log(`workdir:   NOT WRITABLE`);
  }

  process.exit(0);
}

if (args[0] !== "translate") {
  console.log(`Usage: ptl <translate|check> [options]

translate <file.pdf> [options]
  --direction <en2zh|zh2en>  Translation direction (default: auto-detect)
  --glossary <path>          Glossary JSON file
  --review-model <model>     Model for review stages (default: deepseek-v4-pro)
  --translate-model <model>  Model for translation stage (default: deepseek-v4-flash)
  --concurrency <n>          Translation concurrency (default: 3)
  --skip-interact            Skip interactive review (CI mode)
  --output <path>            Output file path (default: ./<name>_translated.md)

check                         Check environment dependencies`);
  process.exit(1);
}

const inputIndex = args.indexOf("translate") + 1;
const inputPath = args[inputIndex];

if (!inputPath) {
  console.error("Error: Missing input file path.");
  process.exit(1);
}

const { values } = (await import("node:util")).parseArgs({
  args: args.slice(inputIndex + 1),
  options: {
    direction: { type: "string" },
    glossary: { type: "string" },
    "review-model": { type: "string", default: "deepseek-v4-pro" },
    "translate-model": { type: "string", default: "deepseek-v4-flash" },
    concurrency: { type: "string", default: "3" },
    "skip-interact": { type: "boolean", default: false },
    output: { type: "string" },
  },
  strict: false,
});

let direction: "en2zh" | "zh2en";

if (values.direction === "zh2en" || values.direction === "en2zh") {
  direction = values.direction;
} else {
  const content = await readFile(inputPath, "utf-8").catch(() => "");
  direction = detectDirection(content.slice(0, 500));
  console.log(`Auto-detected direction: ${direction}`);
}

const config: PipelineConfig = {
  inputPath,
  outputPath: (values.output as string | undefined) ?? `${inputPath.replace(/\.pdf$/i, "")}_translated.md`,
  direction,
  glossaryPath: values.glossary as string | undefined,
  reviewModel: values["review-model"] as string,
  translateModel: values["translate-model"] as string,
  concurrency: parseInt(values.concurrency as string),
  skipInteract: values["skip-interact"] as boolean,
  workDir: "workdir",
};

await runPipeline(config);
