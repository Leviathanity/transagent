import { readFile, writeFile } from "node:fs/promises";
import { stageConvertToIr } from "./stage-convert.js";
import { stageReview } from "./stage-review.js";
import { stageTranslate } from "./stage-translate.js";
import { stageBeautify } from "./stage-beautify.js";
import { stageInteract } from "./stage-interact.js";
import { ensureWorkDir, readIntermediate, writeFinalOutput } from "../utils/file-manager.js";
import { WORKDIR_LAYOUT } from "../utils/file-manager.js";
import { parseDocument } from "../utils/ir-serialization.js";
import { renderPixelPerfectHtml } from "../renderers/pixel-perfect.js";
import { renderSemanticHtml } from "../renderers/semantic.js";
import { hasGeometry } from "../types/document-ir.js";
import type { PipelineConfig } from "../types/pipeline.js";

const SPEC_REVIEW = "specs/review-layout.md";

async function renderTranslatedHtml(irPath: string, htmlPath: string): Promise<void> {
  const ir = parseDocument(await readFile(irPath, "utf-8"));
  const html = hasGeometry(ir) ? renderPixelPerfectHtml(ir) : renderSemanticHtml(ir);
  await writeFile(htmlPath, html, "utf-8");
}

export async function runPipeline(config: PipelineConfig): Promise<void> {
  await ensureWorkDir(config.workDir);
  const wd = config.workDir;

  console.log("[1/4] Converting PDF → Document IR...");
  const originalIr = `${wd}/${WORKDIR_LAYOUT.originalIr}`;
  const r1 = await stageConvertToIr(config.inputPath, originalIr);
  if (!r1.success) { console.error(`Conversion failed: ${r1.error}`); process.exit(1); }

  console.log("[2/4] Translating...");
  const translatedIr = `${wd}/${WORKDIR_LAYOUT.translatedIr}`;
  const r2 = await stageTranslate(config.glossaryPath, config.direction, config.concurrency, config.translateModel, originalIr, translatedIr);
  if (!r2.success) { console.error(`Translation failed: ${r2.error}`); process.exit(1); }

  console.log("  Rendering translated IR → HTML...");
  const reviewInput = `${wd}/${WORKDIR_LAYOUT.reviewInput}`;
  await renderTranslatedHtml(translatedIr, reviewInput);

  console.log("[3/4] Reviewing formatting...");
  const reviewedPath = `${wd}/${WORKDIR_LAYOUT.reviewed}`;
  const formatReport = `${wd}/${WORKDIR_LAYOUT.formatReport}`;
  const r3 = await stageReview(SPEC_REVIEW, reviewInput, formatReport, reviewedPath, config.reviewModel);
  if (!r3.success) { console.error(`Format review failed: ${r3.error}`); process.exit(1); }

  console.log("[4/4] Beautifying layout...");
  const beautifiedPath = `${wd}/${WORKDIR_LAYOUT.beautified}`;
  const r4 = await stageBeautify(config.beautifySpec, reviewedPath, config.inputPath, beautifiedPath, config.beautifyModel);
  if (!r4.success) { console.error(`Beautify failed: ${r4.error}`); process.exit(1); }

  if (config.skipInteract) {
    console.log("Skipping interaction (CI mode)...");
    const content = await readIntermediate(wd, WORKDIR_LAYOUT.beautified);
    await writeFinalOutput(config.outputPath, content);
    console.log(`Output: ${config.outputPath}`);
  } else {
    console.log("Starting interactive review...");
    await stageInteract(beautifiedPath, config.outputPath);
  }
}
