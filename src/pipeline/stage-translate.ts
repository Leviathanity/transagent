import { createAgentSession } from "@oh-my-pi/pi-coding-agent";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent";
import { readFile, writeFile } from "node:fs/promises";
import { parseHTML } from "linkedom";
import { loadGlossary } from "../glossary/loader.js";
import { formatForPrompt } from "../glossary/matcher.js";
import { splitHtmlToBlocks, assembleHtmlBlocks, splitPerfectHtmlToBlocks, assemblePerfectHtml } from "../splitter/html-block-splitter.js";
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
    // For tables: send only cell text (one-per-line) to avoid LLM stripping HTML tags
    const prompt = block.blockType === "table"
      ? translateTablePrompt(block.text)
      : `翻译以下 HTML 内容：\n\n${block.text}`;
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

/** Extract cell text from a table HTML string, one cell per line */
function translateTablePrompt(tableHtml: string): string {
  const { document } = parseHTML(`<table>${tableHtml}</table>`);
  const cells = [...document.querySelectorAll("td,th")] as any[];
  const lines = cells.map((c: any) => (c.textContent ?? "").trim()).filter((t: string) => t.length > 0);
  return `翻译以下表格的每个单元格内容。严格按顺序逐行输出翻译结果，每行一个单元格译文，不要使用任何 HTML 标签或格式化：\n\n${lines.join("\n")}`;
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
  console.log(`  Translating ${blocks.length} blocks (concurrency=${actualConcurrency})...`);

  const results = await asyncPool(actualConcurrency, blocks, async (sb, i) => {
    const translated = await translateBlock(systemPrompt, model, sb.block);
    console.log(`  [${i + 1}/${blocks.length}] ${sb.block.id} done`);
    return { id: sb.block.id, translated };
  });

  const translationMap = new Map(results.map((r) => [r.id, r.translated]));
  const assembled = isPerfect
    ? assemblePerfectHtml(blocks, translationMap, htmlContent)
    : assembleHtmlBlocks(blocks, (block) => translationMap.get(block.id) ?? block.text);
  await writeFile(outputPath, assembled, "utf-8");
  return { stage: "translate", success: true, outputPath };
}
