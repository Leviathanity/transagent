import { createAgentSession } from "@oh-my-pi/pi-coding-agent";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent";
import { loadGlossary } from "../glossary/loader.js";
import { formatForPrompt } from "../glossary/matcher.js";
import { splitToSeparatedBlocks, assembleFromSeparatedBlocks } from "../splitter/source-block-splitter.js";
import { readIntermediate, writeIntermediate } from "../utils/file-manager.js";
import { WORKDIR_LAYOUT } from "../utils/file-manager.js";
import { buildTranslatorSystemPrompt } from "../agents/translator.js";
import type { StageResult } from "../types/pipeline.js";

async function promptAndGetText(session: AgentSession, text: string): Promise<string> {
  await session.prompt(text, { toolChoice: "none" });
  const msg = session.getLastAssistantMessage();
  if (!msg) return "";
  for (const part of msg.content) {
    if (part.type === "text") {
      return part.text;
    }
  }
  return "";
}

export async function stageTranslate(
  glossaryPath: string | undefined,
  direction: "en2zh" | "zh2en",
  concurrency: number,
  model: string,
  workDir: string,
): Promise<StageResult> {
  const mdContent = await readIntermediate(workDir, WORKDIR_LAYOUT.reviewed);
  const blocks = splitToSeparatedBlocks(mdContent);
  console.log(`  Split into ${blocks.length} SourceBlocks`);

  const glossaryPrompt = glossaryPath
    ? formatForPrompt((await loadGlossary(glossaryPath)).entries)
    : "";

  const systemPrompt = buildTranslatorSystemPrompt(glossaryPrompt, direction);

  const { session } = await createAgentSession({ modelPattern: model, systemPrompt });

  const translationMap = new Map<string, string>();

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].block;
    const result = await promptAndGetText(
      session,
      `翻译以下 Markdown 内容：\n\n${block.text}`,
    );
    translationMap.set(block.id, result || block.text);
    console.log(`  [${i + 1}/${blocks.length}] ${block.id} done`);
  }

  await session.dispose();

  const assembled = assembleFromSeparatedBlocks(blocks, (block) => {
    return translationMap.get(block.id) ?? block.text;
  });

  const outputPath = await writeIntermediate(workDir, WORKDIR_LAYOUT.translated, assembled);
  return { stage: "translate", success: true, outputPath };
}
