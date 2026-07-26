import { createAgentSession } from "@oh-my-pi/pi-coding-agent";
import { readFile, writeFile } from "node:fs/promises";
import { loadGlossary } from "../glossary/loader.js";
import { formatForPrompt } from "../glossary/matcher.js";
import { splitHtmlToBlocks, assembleHtmlBlocks, splitPerfectHtmlToBlocks, assemblePerfectHtml } from "../splitter/html-block-splitter.js";
import { buildTranslatorSystemPrompt } from "../agents/translator.js";
import { asyncPool } from "../utils/async-pool.js";
import { buildBlockPrompt, buildTocGroupPrompt, groupTocBlocks, isSkippable } from "../utils/translation-prompts.js";
import type { StageResult } from "../types/pipeline.js";
import type { SourceBlock } from "../types/source-block.js";

async function translateBlock(
  systemPrompt: string,
  model: string,
  block: SourceBlock,
): Promise<string> {
  const prompt = buildBlockPrompt(block);
  if (!prompt) return block.text;

  const { session } = await createAgentSession({
    modelPattern: model,
    systemPrompt,
  });
  try {
    await session.prompt(prompt, { toolChoice: "none" });
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

async function translateTocGroup(
  systemPrompt: string,
  model: string,
  entries: string[],
): Promise<string[]> {
  const prompt = buildTocGroupPrompt(entries);
  if (!prompt) return entries.map(() => "");

  const { session } = await createAgentSession({
    modelPattern: model,
    systemPrompt,
  });
  try {
    await session.prompt(prompt, { toolChoice: "none" });
    const msg = session.getLastAssistantMessage();
    if (!msg) return entries.map(() => "");
    for (const part of msg.content) {
      if (part.type === "text") {
        const lines = part.text.split("\n").map(s => s.trim()).filter(s => s.length > 0);
        while (lines.length < entries.length) lines.push(entries[lines.length]);
        return lines.slice(0, entries.length);
      }
    }
    return entries.map(() => "");
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
  const isPerfect = htmlContent.includes('class="page"');

  const blocks = isPerfect
    ? splitPerfectHtmlToBlocks(htmlContent)
    : splitHtmlToBlocks(htmlContent);
  console.log(`  Split into ${blocks.length} SourceBlocks (format: ${isPerfect ? "pixel-perfect" : "plain-html"})`);

  const glossaryPrompt = glossaryPath
    ? formatForPrompt((await loadGlossary(glossaryPath)).entries)
    : "";

  const systemPrompt = buildTranslatorSystemPrompt(glossaryPrompt, direction);

  const actualConcurrency = Math.min(concurrency, blocks.length);
  // Dedup cache: skip translating blocks with identical text
  const dedupCache = new Map<string, string>();

  // Detect TOC groups for batched translation
  const tocGroups = groupTocBlocks(blocks.map(b => ({ id: b.block.id, blockType: b.block.blockType, text: b.block.text })));
  const tocGroupIds = new Set(tocGroups.flatMap(g => g.ids));

  const toTranslate = blocks.filter(b => !tocGroupIds.has(b.block.id) && !isSkippable(b.block));

  console.log(`  Translating ${toTranslate.length} blocks + ${tocGroups.length} TOC groups (concurrency=${actualConcurrency})...`);

  const results = await asyncPool(actualConcurrency, toTranslate, async (sb, i) => {
    // Check dedup cache
    const textKey = sb.block.text.trim().slice(0, 200);
    const cached = dedupCache.get(textKey);
    if (cached !== undefined) {
      console.log(`  [${i + 1}/${toTranslate.length}] ${sb.block.id} (cached)`);
      return { id: sb.block.id, translated: cached };
    }

    const translated = await translateBlock(systemPrompt, model, sb.block);
    dedupCache.set(textKey, translated);
    console.log(`  [${i + 1}/${toTranslate.length}] ${sb.block.id} done`);
    return { id: sb.block.id, translated };
  });

  // Translate TOC groups
  for (const group of tocGroups) {
    const translated = await translateTocGroup(systemPrompt, model, group.texts);
    for (let i = 0; i < group.ids.length; i++) {
      results.push({ id: group.ids[i], translated: translated[i] ?? group.texts[i] });
    }
  }

  const translationMap = new Map(results.map((r) => [r.id, r.translated]));
  const assembled = isPerfect
    ? assemblePerfectHtml(blocks, translationMap, htmlContent)
    : assembleHtmlBlocks(blocks, (block) => translationMap.get(block.id) ?? block.text);
  await writeFile(outputPath, assembled, "utf-8");
  return { stage: "translate", success: true, outputPath };
}
