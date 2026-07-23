import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const WORKDIR_LAYOUT = {
  original: "01_original.md",
  reviewed: "02_reviewed.md",
  reviewReport: "02_review_report.md",
  translated: "03_translated.md",
  formatted: "04_formatted.md",
  formatReport: "04_format_report.md",
} as const;

export async function ensureWorkDir(workDir: string): Promise<void> {
  await mkdir(workDir, { recursive: true });
}

export async function writeIntermediate(
  workDir: string,
  filename: string,
  content: string,
): Promise<string> {
  const filePath = `${workDir}/${filename}`;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

export async function readIntermediate(
  workDir: string,
  filename: string,
): Promise<string> {
  return readFile(`${workDir}/${filename}`, "utf-8");
}

export async function fileExists(
  workDir: string,
  filename: string,
): Promise<boolean> {
  try {
    await readFile(`${workDir}/${filename}`, "utf-8");
    return true;
  } catch {
    return false;
  }
}

export async function writeFinalOutput(
  outputPath: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, "utf-8");
}
