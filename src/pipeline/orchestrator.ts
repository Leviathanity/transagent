// src/pipeline/orchestrator.ts

import { stageConvert } from "./stage-convert.js";
import { stageReview } from "./stage-review.js";
import { stageTranslate } from "./stage-translate.js";
import { stageInteract } from "./stage-interact.js";
import { ensureWorkDir, writeFinalOutput, readIntermediate } from "../utils/file-manager.js";
import { WORKDIR_LAYOUT } from "../utils/file-manager.js";
import type { PipelineConfig } from "../types/pipeline.js";

const SPEC_CONVERSION = "specs/review-conversion.md";
const SPEC_FORMATTING = "specs/review-formatting.md";

export async function runPipeline(config: PipelineConfig): Promise<void> {
  await ensureWorkDir(config.workDir);

  console.log("[1/5] Converting PDF...");
  const r1 = await stageConvert(config.inputPath, config.workDir);
  if (!r1.success) { console.error(`Conversion failed: ${r1.error}`); process.exit(1); }

  console.log("[2/5] Reviewing conversion quality...");
  const r2 = await stageReview(
    SPEC_CONVERSION, WORKDIR_LAYOUT.original, WORKDIR_LAYOUT.reviewReport,
    WORKDIR_LAYOUT.reviewed, config.reviewModel, config.workDir,
  );
  if (!r2.success) { console.error(`Review failed: ${r2.error}`); process.exit(1); }

  console.log("[3/5] Translating...");
  const r3 = await stageTranslate(config.glossaryPath, config.direction, config.concurrency, config.workDir);
  if (!r3.success) { console.error(`Translation failed: ${r3.error}`); process.exit(1); }

  console.log("[4/5] Reviewing formatting...");
  const r4 = await stageReview(
    SPEC_FORMATTING, WORKDIR_LAYOUT.translated, WORKDIR_LAYOUT.formatReport,
    WORKDIR_LAYOUT.formatted, config.reviewModel, config.workDir,
  );
  if (!r4.success) { console.error(`Format review failed: ${r4.error}`); process.exit(1); }

  if (config.skipInteract) {
    console.log("[5/5] Skipping interaction (CI mode)...");
    const content = await readIntermediate(config.workDir, WORKDIR_LAYOUT.formatted);
    await writeFinalOutput(config.outputPath, content);
    console.log(`Output: ${config.outputPath}`);
  } else {
    console.log("[5/5] Interactive review...");
    await stageInteract(WORKDIR_LAYOUT.formatted, config.outputPath, config.workDir);
  }
}
