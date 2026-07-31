import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const WORKDIR_LAYOUT = {
  originalIr: "01_original.ir.json",
  translatedIr: "02_translated.ir.json",
  reviewInput: "03_review_input.html",
  reviewed: "04_reviewed.html",
  formatReport: "04_format_report.md",
  beautified: "05_beautified.html",
} as const;

export async function ensureWorkDir(workDir: string): Promise<void> {
  await mkdir(workDir, { recursive: true });
}

export async function readIntermediate(
  workDir: string,
  filename: string,
): Promise<string> {
  return readFile(`${workDir}/${filename}`, "utf-8");
}

export async function writeFinalOutput(
  outputPath: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, "utf-8");
}
