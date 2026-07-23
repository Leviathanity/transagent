import { execa, ExecaError } from "execa";
import { writeIntermediate } from "../utils/file-manager.js";
import { WORKDIR_LAYOUT } from "../utils/file-manager.js";
import type { StageResult } from "../types/pipeline.js";

export async function stageConvert(
  inputPath: string,
  workDir: string,
): Promise<StageResult> {
  try {
    const result = await execa("markitdown", [inputPath], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    });

    if (result.exitCode !== 0) {
      return {
        stage: "convert",
        success: false,
        error: `MarkItDown exited with code ${result.exitCode}: ${result.stderr}`,
      };
    }

    const outputPath = await writeIntermediate(
      workDir,
      WORKDIR_LAYOUT.original,
      result.stdout,
    );

    return { stage: "convert", success: true, outputPath };
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.message.includes("ENOENT") || err.message.includes("not found"))
    ) {
      return {
        stage: "convert",
        success: false,
        error: "MarkItDown is not installed. Run: pip install 'markitdown[all]'",
      };
    }
    if (err instanceof ExecaError && err.exitCode === 1 && !err.stdout) {
      return {
        stage: "convert",
        success: false,
        error: "MarkItDown is not installed. Run: pip install 'markitdown[all]'",
      };
    }
    return {
      stage: "convert",
      success: false,
      error: `Conversion failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
