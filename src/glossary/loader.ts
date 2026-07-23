import { readFile } from "node:fs/promises";
import type { GlossaryFile } from "../types/glossary.js";

export async function loadGlossary(path: string): Promise<GlossaryFile> {
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw) as GlossaryFile;

  if (!parsed.version || !parsed.direction || !Array.isArray(parsed.entries)) {
    throw new Error(`Invalid glossary file: ${path}`);
  }

  for (const entry of parsed.entries) {
    if (!entry.source || !entry.target) {
      throw new Error(`Invalid glossary entry in ${path}: missing source or target`);
    }
  }

  return parsed;
}
