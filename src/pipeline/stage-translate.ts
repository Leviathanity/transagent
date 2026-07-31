import { createAgentSession } from "@oh-my-pi/pi-coding-agent";
import { readFile, writeFile } from "node:fs/promises";
import { loadGlossary } from "../glossary/loader.js";
import { formatForPrompt } from "../glossary/matcher.js";
import { buildTranslatorSystemPrompt } from "../agents/translator.js";
import { asyncPool } from "../utils/async-pool.js";
import {
  buildBlockPrompt,
  buildTablePrompt,
  buildTocGroupPrompt,
  groupTocBlocks,
  isSkippable,
} from "../utils/translation-prompts.js";
import { parseDocument, serializeDocument } from "../utils/ir-serialization.js";
import type { SourceBlock, TableSourceBlock } from "../types/document-ir.js";
import type { StageResult } from "../types/pipeline.js";

export interface LlmTextPart {
  type: "text";
  text: string;
}

export interface LlmAssistantMessage {
  content: LlmTextPart[];
}

/** Minimal OMP session surface used by the translate stage. */
export interface TranslationSession {
  prompt(prompt: string, options?: { toolChoice?: "none" }): Promise<unknown>;
  getLastAssistantMessage(): LlmAssistantMessage | null;
  dispose(): Promise<void>;
}

export type SessionFactory = (
  systemPrompt: string,
  model: string,
) => Promise<TranslationSession>;

export const defaultSessionFactory: SessionFactory = async (systemPrompt, model) => {
  const { session } = await createAgentSession({ modelPattern: model, systemPrompt });
  return {
    prompt: (p, o) => session.prompt(p, o),
    getLastAssistantMessage: () =>
      session.getLastAssistantMessage() as unknown as LlmAssistantMessage | null,
    dispose: () => session.dispose(),
  };
};

function applyTableTranslation(table: TableSourceBlock, translated: string): void {
  const lines = translated
    .split("\n")
    .map((s) => s.replace(/<[^>]*>/g, "").trim())
    .filter((s) => s.length > 0);

  const cellOrder: { row: string[]; index: number }[] = [];
  for (const row of [...table.headerRows, ...table.rows]) {
    for (let i = 0; i < row.length; i++) {
      if (row[i].trim().length > 0) cellOrder.push({ row, index: i });
    }
  }
  lines.slice(0, cellOrder.length).forEach((line, k) => {
    cellOrder[k].row[cellOrder[k].index] = line;
  });
}

export async function stageTranslate(
  glossaryPath: string | undefined,
  direction: "en2zh" | "zh2en",
  concurrency: number,
  model: string,
  inputPath: string,
  outputPath: string,
  sessionFactory: SessionFactory = defaultSessionFactory,
  sessionRotation = 10,
): Promise<StageResult> {
  const sessions = new Map<number, TranslationSession>();
  try {
    const ir = parseDocument(await readFile(inputPath, "utf-8"));
    const glossaryPrompt = glossaryPath
      ? formatForPrompt((await loadGlossary(glossaryPath)).entries)
      : "";
    const systemPrompt = buildTranslatorSystemPrompt(glossaryPrompt, direction);

    const allBlocks: { page: number; index: number; block: SourceBlock }[] = [];
    ir.pages.forEach((page, pi) => {
      page.blocks.forEach((block, bi) => allBlocks.push({ page: pi, index: bi, block }));
    });

    const tocGroups = groupTocBlocks(allBlocks.map((b) => b.block));
    const tocGroupIds = new Set(tocGroups.flatMap((g) => g.ids));
    const toTranslate = allBlocks.filter(
      (b) => !tocGroupIds.has(b.block.id) && !isSkippable(b.block),
    );

    const dedupCache = new Map<string, string>();
    const promptCounts = new Map<number, number>();

    async function acquire(worker: number): Promise<TranslationSession> {
      if ((promptCounts.get(worker) ?? 0) >= sessionRotation) {
        await sessions.get(worker)?.dispose();
        sessions.delete(worker);
        promptCounts.set(worker, 0);
      }
      let session = sessions.get(worker);
      if (!session) {
        session = await sessionFactory(systemPrompt, model);
        sessions.set(worker, session);
      }
      return session;
    }

    async function release(worker: number): Promise<void> {
      promptCounts.set(worker, (promptCounts.get(worker) ?? 0) + 1);
    }

    async function translatePrompt(session: TranslationSession, prompt: string): Promise<string> {
      await session.prompt(prompt, { toolChoice: "none" });
      const msg = session.getLastAssistantMessage();
      const text = msg?.content.find((p) => p.type === "text")?.text ?? "";
      return text.trim();
    }

    const actualConcurrency = Math.max(1, Math.min(concurrency, toTranslate.length));
    console.log(
      `  Translating ${toTranslate.length} blocks + ${tocGroups.length} TOC groups (concurrency=${actualConcurrency}, session rotation=${sessionRotation})...`,
    );

    const results = await asyncPool(
      actualConcurrency,
      toTranslate,
      async ({ block }, i) => {
        const worker = i % actualConcurrency;
        const session = await acquire(worker);
        try {
          const textKey =
            block.type === "table"
              ? JSON.stringify([block.headerRows, block.rows]).slice(0, 200)
              : block.text.trim().slice(0, 200);
          const cached = dedupCache.get(textKey);
          if (cached !== undefined) {
            return { id: block.id, translated: cached };
          }
          const translated = await translatePrompt(session, buildBlockPrompt(block));
          dedupCache.set(textKey, translated);
          return { id: block.id, translated };
        } finally {
          await release(worker);
        }
      },
    );

    const translationMap = new Map(results.map((r) => [r.id, r.translated]));

    // TOC groups are translated sequentially on worker 0 after the parallel batch.
    for (const group of tocGroups) {
      const session = await acquire(0);
      try {
        const prompt = buildTocGroupPrompt(group.texts);
        const translated = await translatePrompt(session, prompt);
        const lines = translated
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        group.ids.forEach((id, k) => {
          if (lines[k]) translationMap.set(id, lines[k]);
        });
      } finally {
        await release(0);
      }
    }

    // Apply translations back onto the IR in place.
    for (const { block } of allBlocks) {
      const translated = translationMap.get(block.id);
      if (translated === undefined) continue;
      if (block.type === "table") {
        applyTableTranslation(block, translated);
      } else {
        block.text = translated;
      }
    }

    await writeFile(outputPath, serializeDocument(ir), "utf-8");
    return { stage: "translate", success: true, outputPath };
  } catch (err) {
    return {
      stage: "translate",
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    // Best-effort disposal of any sessions that were rotated out or still open.
    await Promise.allSettled(
      [...sessions.values()].map((s) => s.dispose()),
    );
  }
}
