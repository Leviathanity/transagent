import { stageConvertWithOcr } from "../utils/ocr-processor.js";
import type { StageResult } from "../types/pipeline.js";

export async function stageConvert(
  inputPath: string,
  outputPath?: string,
): Promise<StageResult> {
  const r = await stageConvertWithOcr(inputPath, outputPath);
  if (!r.success) {
    return {
      stage: "convert",
      success: false,
      error: r.error ?? "Unknown OCR error",
    };
  }
  if (outputPath) {
    return { stage: "convert", success: true, outputPath };
  }
  return { stage: "convert", success: true, output: r.output };
}
