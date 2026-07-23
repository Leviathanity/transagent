import { loadGlossary } from "../glossary/loader.js";
import { formatForPrompt } from "../glossary/matcher.js";
import { splitToSeparatedBlocks, assembleFromSeparatedBlocks } from "../splitter/source-block-splitter.js";
import { readIntermediate, writeIntermediate } from "../utils/file-manager.js";
import { WORKDIR_LAYOUT } from "../utils/file-manager.js";
import type { StageResult } from "../types/pipeline.js";

export async function stageTranslate(
  glossaryPath: string | undefined,
  direction: "en2zh" | "zh2en",
  concurrency: number,
  workDir: string,
): Promise<StageResult> {
  const mdContent = await readIntermediate(workDir, WORKDIR_LAYOUT.reviewed);
  const blocks = splitToSeparatedBlocks(mdContent);
  console.log(`  Split into ${blocks.length} SourceBlocks`);

  const glossaryPrompt = glossaryPath
    ? formatForPrompt((await loadGlossary(glossaryPath)).entries)
    : "";

  const translationMap = new Map<string, string>();

  // Sequential translation for now — OMP Task batch pending
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].block;
    // TODO: Replace with OMP TaskTool batch call
    const translated = `[translated: ${block.id}] ${block.text}`;
    translationMap.set(block.id, translated);
    console.log(`  Translated ${i + 1}/${blocks.length}: ${block.id}`);
  }

  const assembled = assembleFromSeparatedBlocks(blocks, (block) => {
    return translationMap.get(block.id) ?? block.text;
  });

  const outputPath = await writeIntermediate(workDir, WORKDIR_LAYOUT.translated, assembled);
  return { stage: "translate", success: true, outputPath };
}
