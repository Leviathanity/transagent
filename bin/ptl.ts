#!/usr/bin/env bun
// bin/ptl.ts

import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { basename, dirname } from "node:path";
import { stageConvert } from "../src/pipeline/stage-convert.js";
import { stageReview } from "../src/pipeline/stage-review.js";
import { stageTranslate } from "../src/pipeline/stage-translate.js";
import { stageInteract } from "../src/pipeline/stage-interact.js";
import { stageBeautify } from "../src/pipeline/stage-beautify.js";
import { runPipeline } from "../src/pipeline/orchestrator.js";
import { detectDirection } from "../src/utils/direction-detector.js";

const cmd = process.argv[2];
const subArgs = process.argv.slice(3);

async function ensureDir(path: string) {
  await mkdir(dirname(path), { recursive: true });
}

// ─── ptl convert <file.pdf> [--output <path>] [--pages <n>] ───
if (cmd === "convert") {
  const { values, positionals } = (await import("node:util")).parseArgs({
    args: subArgs,
    allowPositionals: true,
    options: { output: { type: "string" }, pages: { type: "string" } },
    strict: false,
  });
  const pdfPath = positionals[0];
  if (!pdfPath) { console.error("Usage: ptl convert <file.pdf> [--output <path>] [--pages <n>]"); process.exit(1); }

  const outPath = values.output as string | undefined;
  const maxPages = values.pages ? parseInt(values.pages as string) : undefined;
  const r = await stageConvert(pdfPath, outPath, maxPages);
  if (!r.success) { console.error(r.error); process.exit(1); }

  if (!outPath) {
    console.log(r.output);
  }
  process.exit(0);
}

// ─── ptl review <file.html> --spec <path> [--output <path>] [--report <path>] [--model <model>] ───
if (cmd === "review") {
  if (Bun.env.DEEPSEEK_API_KEY) process.env.DEEPSEEK_API_KEY = Bun.env.DEEPSEEK_API_KEY;
  const { values, positionals } = (await import("node:util")).parseArgs({
    args: subArgs,
    allowPositionals: true,
    options: {
      spec: { type: "string" },
      output: { type: "string" },
      report: { type: "string" },
      model: { type: "string", default: "deepseek/deepseek-v4-flash" },
    },
    strict: false,
  });
  const htmlPath = positionals[0];
  if (!htmlPath || !values.spec) {
    console.error("Usage: ptl review <file.html> --spec <path> [--output <path>] [--report <path>] [--model <model>]");
    process.exit(1);
  }

  const outputPath = (values.output as string) ?? htmlPath.replace(/\.html$/, "_reviewed.html");
  const reportPath = (values.report as string) ?? htmlPath.replace(/\.html$/, "_report.md");

  const r = await stageReview(
    values.spec as string,
    htmlPath,
    reportPath,
    outputPath,
    values.model as string,
  );
  if (!r.success) { console.error(r.error); process.exit(1); }
  console.log(`Output: ${outputPath}`);
  if (r.error) console.log(`Report: ${reportPath}`);
  process.exit(0);
}

// ─── ptl translate-blocks <file.ir.json> [--glossary <path>] [--direction <d>] [--model <m>] [--concurrency <n>] [--output <path>] ───
if (cmd === "translate-blocks") {
  const { values, positionals } = (await import("node:util")).parseArgs({
    args: subArgs,
    allowPositionals: true,
    options: {
      glossary: { type: "string" },
      direction: { type: "string", default: "en2zh" },
      model: { type: "string", default: "deepseek/deepseek-v4-flash" },
      concurrency: { type: "string", default: "3" },
      output: { type: "string" },
    },
    strict: false,
  });
  const irPath = positionals[0];
  if (!irPath) {
    console.error("Usage: ptl translate-blocks <file.ir.json> [options]");
    process.exit(1);
  }

  const outputPath =
    (values.output as string) ?? irPath.replace(/\.ir\.json$/, "_translated.ir.json");
  const direction = (values.direction === "zh2en" || values.direction === "en2zh")
    ? values.direction : "en2zh";

  const r = await stageTranslate(
    values.glossary as string | undefined,
    direction,
    parseInt(values.concurrency as string),
    values.model as string,
    irPath,
    outputPath,
  );
  if (!r.success) { console.error(r.error); process.exit(1); }
  console.log(`Output: ${outputPath}`);
  process.exit(0);
}

// ─── ptl interact <file.html> [--output <path>] ───
if (cmd === "interact") {
  const { values, positionals } = (await import("node:util")).parseArgs({
    args: subArgs,
    allowPositionals: true,
    options: { output: { type: "string" } },
    strict: false,
  });
  const htmlPath = positionals[0];
  if (!htmlPath) {
    console.error("Usage: ptl interact <file.html> [--output <path>]");
    process.exit(1);
  }

  const outputPath = (values.output as string) ?? htmlPath.replace(/\.html$/, "_final.html");
  const r = await stageInteract(htmlPath, outputPath);
  process.exit(r.success ? 0 : 1);
}

// ─── ptl beautify <file.html> <file.pdf> [--prompt <text>] [--output <path>] [--spec <path>] [--model <model>] ───
if (cmd === "beautify") {
  if (Bun.env.DEEPSEEK_API_KEY) process.env.DEEPSEEK_API_KEY = Bun.env.DEEPSEEK_API_KEY;
  const { values, positionals } = (await import("node:util")).parseArgs({
    args: subArgs,
    allowPositionals: true,
    options: {
      prompt: { type: "string" },
      output: { type: "string" },
      spec: { type: "string", default: "specs/beautify-layout.md" },
      model: { type: "string", default: "deepseek/deepseek-v4-flash" },
      report: { type: "string" },
    },
    strict: false,
  });
  const htmlPath = positionals[0];
  const pdfPath = positionals[1];
  if (!htmlPath || !pdfPath) {
    console.error("Usage: ptl beautify <file.html> <file.pdf> [--prompt <text>] [--output <path>] [--model <model>]");
    process.exit(1);
  }

  const outputPath = (values.output as string) ?? htmlPath.replace(/\.html$/, "_beautified.html");
  const r = await stageBeautify(
    values.spec as string,
    htmlPath,
    pdfPath,
    outputPath,
    values.model as string,
    values.prompt as string | undefined,
    values.report as string | undefined,
  );
  if (!r.success) { console.error(r.error); process.exit(1); }
  console.log(`Output: ${outputPath}`);
  process.exit(0);
}

// ─── ptl check ───
if (cmd === "check") {
  console.log("pdf-translator environment check\n");
  console.log(`Bun:       v${Bun.version}`);
  console.log(`Node:      ${process.version}`);

  try {
    const { execa } = await import("execa");
    const r = await execa("markitdown", ["--version"], { timeout: 10000, reject: false });
    console.log(`MarkItDown: ${r.exitCode === 0 ? r.stdout.trim() : "NOT FOUND — run: pip install 'markitdown[all]'"}`);
  } catch { console.log(`MarkItDown: NOT FOUND — run: pip install 'markitdown[all]'`); }

  try {
    const { execa } = await import("execa");
    const r = await execa("python", ["--version"], { timeout: 5000, reject: false });
    console.log(`Python:    ${r.stdout.trim() || r.stderr.trim()}`);
  } catch { console.log(`Python:    NOT FOUND`); }

  const key = Bun.env.DEEPSEEK_API_KEY || Bun.env.ANTHROPIC_API_KEY;
  console.log(`API Key:   ${key ? "SET" : "NOT SET — set DEEPSEEK_API_KEY or ANTHROPIC_API_KEY"}`);

  try {
    await mkdir("workdir", { recursive: true });
    await writeFile("workdir/.test-write", "test");
    await unlink("workdir/.test-write");
    console.log(`workdir:   writable`);
  } catch {
    console.log(`workdir:   NOT WRITABLE`);
  }

  process.exit(0);
}

// ─── ptl translate <file.pdf> [options] (full pipeline) ───
if (cmd === "translate") {
  const { values, positionals } = (await import("node:util")).parseArgs({
    args: subArgs,
    allowPositionals: true,
    options: {
      direction: { type: "string" },
      glossary: { type: "string" },
      "review-model": { type: "string", default: "deepseek/deepseek-v4-flash" },
      "translate-model": { type: "string", default: "deepseek/deepseek-v4-flash" },
      "beautify-model": { type: "string", default: "deepseek/deepseek-v4-flash" },
      "beautify-spec": { type: "string", default: "specs/beautify-layout.md" },
      concurrency: { type: "string", default: "3" },
      "skip-interact": { type: "boolean", default: false },
      output: { type: "string" },
    },
    strict: false,
  });
  const inputPath = positionals[0];
  if (!inputPath) { console.error("Error: Missing input file."); process.exit(1); }

  let direction: "en2zh" | "zh2en";
  if (values.direction === "zh2en" || values.direction === "en2zh") {
    direction = values.direction;
  } else {
    const content = await readFile(inputPath, "utf-8").catch(() => "");
    direction = detectDirection(content.slice(0, 500));
    console.log(`Auto-detected direction: ${direction === "zh2en" ? "中文→英文" : "英文→中文"}`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const confirm = await new Promise<string>(res => rl.question("确认？[Y/n]: ", res));
    rl.close();
    if (confirm.toLowerCase() === "n") { console.error("Aborted."); process.exit(1); }
  }

  await runPipeline({
    inputPath,
    outputPath: (values.output as string) ?? inputPath.replace(/\.pdf$/i, "") + "_translated.html",
    direction,
    glossaryPath: values.glossary as string | undefined,
    reviewModel: values["review-model"] as string,
    translateModel: values["translate-model"] as string,
    beautifyModel: values["beautify-model"] as string,
    beautifySpec: values["beautify-spec"] as string,
    concurrency: parseInt(values.concurrency as string),
    skipInteract: values["skip-interact"] as boolean,
    workDir: "workdir",
  });
  process.exit(0);
}

// ─── help ───
console.log(`Usage: ptl <command> [args]

Commands:
  convert <file.pdf> [--output <path>]            Stage 1: PDF → HTML
  translate-blocks <file.ir.json> [options]       Stage 2: IR block translation
  review <file.html> --spec <path> [options]      Stage 3: Grill + Goal fix
  beautify <file.html> <file.pdf> [options]       Stage 4: Reference PDF to polish HTML
  interact <file.html> [--output <path>]          Interactive terminal Q&A
  translate <file.pdf> [options]                  Full pipeline (1→4)
  check                                           Environment check

Options for translate:
  --direction <en2zh|zh2en>   Direction (default: auto-detect)
  --glossary <path>           Glossary JSON file
  --review-model <model>      Model for review (default: deepseek/deepseek-v4-flash)
  --translate-model <model>   Model for translation (default: deepseek/deepseek-v4-flash)
  --beautify-model <model>    Model for beautify (default: deepseek/deepseek-v4-flash)
  --beautify-spec <path>      Beautify spec (default: specs/beautify-layout.md)
  --concurrency <n>           Translation concurrency (default: 3)
  --skip-interact             Skip interactive review (CI mode)
  --output <path>             Output path`);
