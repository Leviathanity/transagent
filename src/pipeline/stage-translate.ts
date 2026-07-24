import { createAgentSession } from "@oh-my-pi/pi-coding-agent";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent";
import { readFile, writeFile } from "node:fs/promises";
import { loadGlossary } from "../glossary/loader.js";
import { formatForPrompt } from "../glossary/matcher.js";
import { splitHtmlToBlocks, assembleHtmlBlocks } from "../splitter/html-block-splitter.js";
import { buildTranslatorSystemPrompt } from "../agents/translator.js";
import { asyncPool } from "../utils/async-pool.js";
import type { StageResult } from "../types/pipeline.js";
import type { SourceBlock } from "../types/source-block.js";

async function translateBlock(
  systemPrompt: string,
  model: string,
  block: SourceBlock,
): Promise<string> {
  const { session } = await createAgentSession({
    modelPattern: model,
    systemPrompt,
  });
  try {
    await session.prompt(`翻译以下 HTML 内容：\n\n${block.text}`, { toolChoice: "none" });
    const msg = session.getLastAssistantMessage();
    if (!msg) return block.text;
    for (const part of msg.content) {
      if (part.type === "text") return part.text;
    }
    return block.text;
  } finally {
    await session.dispose();
  }
}

export async function stageTranslate(
  glossaryPath: string | undefined,
  direction: "en2zh" | "zh2en",
  concurrency: number,
  model: string,
  inputPath: string,
  outputPath: string,
): Promise<StageResult> {
  const htmlContent = await readFile(inputPath, "utf-8");
  const blocks = splitHtmlToBlocks(htmlContent);
  console.log(`  Split into ${blocks.length} SourceBlocks`);

  const glossaryPrompt = glossaryPath
    ? formatForPrompt((await loadGlossary(glossaryPath)).entries)
    : "";

  const systemPrompt = buildTranslatorSystemPrompt(glossaryPrompt, direction);

  const actualConcurrency = Math.min(concurrency, blocks.length);
  console.log(`  Translating ${blocks.length} blocks (concurrency=${actualConcurrency})...`);

  const results = await asyncPool(actualConcurrency, blocks, async (sb, i) => {
    const translated = await translateBlock(systemPrompt, model, sb.block);
    console.log(`  [${i + 1}/${blocks.length}] ${sb.block.id} done`);
    return { id: sb.block.id, translated };
  });

  const translationMap = new Map(results.map((r) => [r.id, r.translated]));
  const assembled = assembleHtmlBlocks(blocks, (block) => translationMap.get(block.id) ?? block.text);
  await writeFile(outputPath, assembled, "utf-8");
  return { stage: "translate", success: true, outputPath };
}
