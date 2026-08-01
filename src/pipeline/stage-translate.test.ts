import { describe, it, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageTranslate, type SessionFactory, type TranslationSession } from "./stage-translate.js";
import { serializeDocument, parseDocument } from "../utils/ir-serialization.js";
import type { DocumentIR } from "../types/document-ir.js";

function fixture(): DocumentIR {
  return {
    pages: [
      {
        width: 1024,
        height: 1448,
        blocks: [
          { id: "sb_0_0", type: "paragraph", level: 0, text: "Hello world" },
          { id: "sb_0_1", type: "heading", level: 1, text: "Chapter 1" },
          {
            id: "sb_0_2",
            type: "table",
            level: 0,
            text: "",
            headerRows: [["Name", "Qty"]],
            rows: [["Bolt", "12"]],
          },
          { id: "sb_0_3", type: "image", level: 0, text: "", src: "logo.png", alt: "logo" },
          { id: "sb_0_4", type: "code", level: 0, text: "const x = 1;" },
          { id: "sb_0_5", type: "other", level: 0, text: "page 1" },
          { id: "sb_0_6", type: "other", level: 0, text: "page 1" },
        ],
      },
    ],
  };
}

/** Fake session: echoes each prompt line prefixed with "T:". */
function fakeSessionFactory(counter: { calls: number; prompts?: number }): SessionFactory {
  return async (): Promise<TranslationSession> => {
    counter.calls++;
    let lastText = "";
    return {
      async prompt(promptText: string) {
        counter.prompts = (counter.prompts ?? 0) + 1;
        const content = promptText.split("\n\n").slice(1).join("\n\n").trim();
        lastText = content
          .split("\n")
          .map((l) => (l.trim() ? `T:${l.trim()}` : l))
          .join("\n");
      },
      getLastAssistantMessage() {
        return lastText ? { content: [{ type: "text", text: lastText }] } : null;
      },
      async dispose() {},
    };
  };
}

async function withTempIr(fn: (input: string, output: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "ptl-test-"));
  try {
    const input = join(dir, "input.ir.json");
    const output = join(dir, "output.ir.json");
    await writeFile(input, serializeDocument(fixture()), "utf-8");
    await fn(input, output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("stageTranslate", () => {
  it("translates text/table/other blocks, skips image/code, dedups identical other blocks", async () => {
    await withTempIr(async (input, output) => {
      const counter = { calls: 0, prompts: 0 };
      const r = await stageTranslate(
        undefined,
        "en2zh",
        2,
        "fake-model",
        input,
        output,
        fakeSessionFactory(counter),
      );
      expect(r.success).toBe(true);

      const ir = parseDocument(await readFile(output, "utf-8"));
      const blocks = ir.pages[0].blocks;
      expect(blocks[0].text).toBe("T:Hello world");
      expect(blocks[1].text).toBe("T:Chapter 1");
      expect(blocks[2].type).toBe("table");
      if (blocks[2].type === "table") {
        expect(blocks[2].headerRows).toEqual([["T:Name", "T:Qty"]]);
        expect(blocks[2].rows).toEqual([["T:Bolt", "T:12"]]);
      }
      expect(blocks[3].text).toBe("");
      expect(blocks[4].text).toBe("const x = 1;");
      expect(blocks[5].text).toBe("T:page 1");
      expect(blocks[6].text).toBe("T:page 1");
      // 4 prompts: paragraph, heading, table, one shared "page 1" prompt
      expect(counter.prompts).toBe(4);
    });
  });

  it("reuses sessions per worker and rotates after the rotation limit", async () => {
    await withTempIr(async (input, output) => {
      const counter = { calls: 0 };
      const r = await stageTranslate(
        undefined,
        "en2zh",
        1,
        "fake-model",
        input,
        output,
        fakeSessionFactory(counter),
        2,
      );
      expect(r.success).toBe(true);
      // 7 blocks, 5 translatable (4 prompts due to dedup), rotation=2
      // with a single worker → 3 sessions
      expect(counter.calls).toBe(3);
    });
  });

  it("never creates more sessions than workers", async () => {
    await withTempIr(async (input, output) => {
      const counter = { calls: 0 };
      const r = await stageTranslate(
        undefined,
        "en2zh",
        2,
        "fake-model",
        input,
        output,
        fakeSessionFactory(counter),
        100,
      );
      expect(r.success).toBe(true);
      expect(counter.calls).toBeLessThanOrEqual(2);
    });
  });
});
