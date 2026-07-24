import { createAgentSession } from "@oh-my-pi/pi-coding-agent";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent";
import { readFile, writeFile } from "node:fs/promises";
import { loadGlossary } from "../glossary/loader.js";
import { formatForPrompt } from "../glossary/matcher.js";
import { splitHtmlToBlocks, assembleHtmlBlocks } from "../splitter/html-block-splitter.js";
import { buildTranslatorSystemPrompt } from "../agents/translator.js";
import type { StageResult } from "../types/pipeline.js";

async function promptAndGetText(session: AgentSession, text: string): Promise<string> {
  await session.prompt(text, { toolChoice: "none" });
  const msg = session.getLastAssistantMessage();
  if (!msg) return "";
  for (const part of msg.content) {
    if (part.type === "text") return part.text;
  }
  return "";
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

  const { session } = await createAgentSession({ modelPattern: model, systemPrompt: buildTranslatorSystemPrompt(glossaryPrompt, direction) });

  const translationMap = new Map<string, string>();
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].block;
    const result = await promptAndGetText(session, `翻译以下 HTML 内容：\n\n${block.text}`);
    translationMap.set(block.id, result || block.text);
    console.log(`  [${i + 1}/${blocks.length}] ${block.id} done`);
  }
  await session.dispose();

  const assembled = assembleHtmlBlocks(blocks, (block) => translationMap.get(block.id) ?? block.text);
  await writeFile(outputPath, assembled, "utf-8");
  return { stage: "translate", success: true, outputPath };
}
