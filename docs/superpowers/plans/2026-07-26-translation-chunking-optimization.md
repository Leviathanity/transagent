# Translation Text Chunking Optimization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw-HTML translation prompts with extracted plain-text prompts per block type, add deduplication cache, and group short TOC entries to eliminate LLM preamble errors.

**Architecture:** A new `src/utils/translation-prompts.ts` module builds block-type-aware prompts (extracted text for paragraphs/headings, cell-lines for tables, grouped entries for TOC). A dedup cache in `stage-translate.ts` skips duplicate blocks. The `other` block type is skipped entirely.

**Tech Stack:** TypeScript, linkedom, Bun runtime

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/utils/translation-prompts.ts` | **Create** | Block-type-aware prompt builders |
| `src/pipeline/stage-translate.ts` | **Modify** | Integrate prompt builders, add dedup cache, skip `other` type |
| `src/agents/translator.ts` | **Modify** | Update system prompt for new prompt formats |

---

### Task 1: Create translation prompt builders module

**Files:**
- Create: `src/utils/translation-prompts.ts`

- [ ] **Step 1: Write the module**

```typescript
import type { SourceBlock } from "../types/source-block.js";
import { parseHTML } from "linkedom";

/** Maximum characters before a TOC-like entry is considered "short" */
const SHORT_LINE_MAX = 60;

/** Detect if a block text looks like a table-of-contents entry (short lines with dots) */
function isTocLike(text: string): boolean {
  const lines = text.split("\n").filter(l => l.trim().length > 0);
  if (lines.length < 2) return false;
  return lines.every(l => l.trim().length < SHORT_LINE_MAX);
}

/** Extract plain text from HTML, preserving meaningful line breaks */
function stripHtml(html: string): string {
  // Replace block-level tags with newlines, then remove all tags
  return html
    .replace(/<\/(?:div|p|tr|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .split("\n")
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .join("\n");
}

/** Build translation prompt for a single paragraph/heading block */
export function buildParagraphPrompt(text: string): string {
  const plain = stripHtml(text).trim();
  if (!plain) return "";
  return `将以下内容翻译为目标语言（只输出译文，不要附加任何解释或前言）：\n\n${plain}`;
}

/** Build translation prompt for a table block — one cell per line */
export function buildTablePrompt(tableHtml: string): string {
  const { document } = parseHTML(`<table>${tableHtml}</table>`);
  const cells = [...document.querySelectorAll("td,th")] as any[];
  const lines = cells
    .map((c: any) => (c.textContent ?? "").trim())
    .filter((t: string) => t.length > 0);
  if (lines.length === 0) return "";
  return `将以下表格单元格内容逐行翻译为目标语言（严格按顺序，每行一个译文，不要使用任何 HTML 标签或格式化，不要附加解释）：\n\n${lines.join("\n")}`;
}

/** Build a grouped translation prompt for multiple TOC entries */
export function buildTocGroupPrompt(entries: string[]): string {
  const lines = entries.map(e => stripHtml(e).trim()).filter(e => e.length > 0);
  if (lines.length === 0) return "";
  return `将以下目录条目逐行翻译为目标语言（严格按顺序，每行一个译文，保留原文的序号、缩进和点线格式，不要附加任何解释）：\n\n${lines.join("\n")}`;
}

/** Build a generic prompt for list items */
export function buildListPrompt(text: string): string {
  const plain = stripHtml(text).trim();
  if (!plain) return "";
  return `将以下列表项翻译为目标语言（保留列表标记符号如 - 或序号，只输出译文）：\n\n${plain}`;
}

/** Get the appropriate prompt for a source block. Returns "" if block should be skipped. */
export function buildBlockPrompt(block: SourceBlock): string {
  switch (block.blockType) {
    case "table":
      return buildTablePrompt(block.text);
    case "code":
      return ""; // code blocks are never translated
    case "other":
      return ""; // images, page numbers skipped
    case "heading":
      return buildParagraphPrompt(block.text);
    case "list":
      return buildListPrompt(block.text);
    case "paragraph":
      return buildParagraphPrompt(block.text);
    default:
      return buildParagraphPrompt(block.text);
  }
}

/** Check if a block's prompt would be empty (skippable) */
export function isSkippable(block: SourceBlock): boolean {
  return buildBlockPrompt(block) === "";
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/utils/translation-prompts.ts
git commit -m "feat: add block-type-aware translation prompt builders"
```

---

### Task 2: Add TOC grouping logic to translation stage

**Files:**
- Modify: `src/pipeline/stage-translate.ts`
- Modify: `src/utils/translation-prompts.ts` (add group detection helper)

- [ ] **Step 1: Add TOC group detector to translation-prompts.ts**

Insert after the `isTocLike` function:

```typescript
/** Group consecutive TOC-like blocks into batches for grouped translation */
export interface TocGroup {
  ids: string[];
  texts: string[];
}

export function groupTocBlocks(blocks: { id: string; blockType: string; text: string }[]): TocGroup[] {
  const groups: TocGroup[] = [];
  let current: TocGroup | null = null;

  for (const b of blocks) {
    if (b.blockType === "paragraph" && isTocLike(b.text)) {
      if (!current) current = { ids: [], texts: [] };
      current.ids.push(b.id);
      current.texts.push(b.text);
    } else {
      if (current && current.ids.length >= 2) {
        groups.push(current);
      }
      current = null;
    }
  }
  if (current && current.ids.length >= 2) {
    groups.push(current);
  }
  return groups;
}
```

- [ ] **Step 2: Update stage-translate.ts to use new prompt builders and TOC grouping**

Replace the `translateBlock` function and `translateTablePrompt` function:

```typescript
import { buildBlockPrompt, buildTocGroupPrompt, groupTocBlocks, isSkippable } from "../utils/translation-prompts.js";

async function translateBlock(
  systemPrompt: string,
  model: string,
  block: SourceBlock,
): Promise<string> {
  const prompt = buildBlockPrompt(block);
  if (!prompt) return block.text; // skip untranslatable blocks

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
        // Pad with originals if LLM returned fewer lines
        while (lines.length < entries.length) lines.push(entries[lines.length]);
        return lines.slice(0, entries.length);
      }
    }
    return entries.map(() => "");
  } finally {
    await session.dispose();
  }
}
```

- [ ] **Step 3: Update stageTranslate to use dedup cache and TOC grouping**

Replace the translation loop (lines 69-78) with:

```typescript
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
```

- [ ] **Step 4: Update system prompt for new format**

In `src/agents/translator.ts`, replace the system prompt rules:

```typescript
export function buildTranslatorSystemPrompt(
  glossaryPrompt: string,
  direction: "en2zh" | "zh2en",
): string {
  const dirText =
    direction === "en2zh" ? "英文翻译为中文" : "中文翻译为英文";

  return `你是一个专业翻译专家。当前任务: ${dirText}。

${glossaryPrompt}

翻译规则:
- 只输出译文文本，不要添加"翻译结果：""以下是翻译："等前言或解释
- 输入可能是纯文本、表格单元格列表、或目录条目列表
- 表格单元格：严格按输入顺序逐行输出译文，不使用 HTML 标签
- 目录条目：保留原文的序号、缩进和点线格式（如 "1. Purpose........4" → "1. 目的........4"）
- 术语表中的词必须使用指定翻译
- 代码块和代码片段不翻译
- 遇到不确定的术语，优先使用术语表翻译，没有则保持原文`;
}
```

- [ ] **Step 5: Typecheck and lint**

```bash
bun run typecheck
```
Expected: PASS

- [ ] **Step 6: Test with existing pipeline**

```bash
rm -f workdir/chunk_test_*.html
# Convert
bun run bin/ptl.ts convert "test/test1.pdf" --output "workdir/chunk_test_01.html"
# Translate
DEEPSEEK_API_KEY=sk-... bun run bin/ptl.ts translate-blocks "workdir/chunk_test_01.html" --direction en2zh --concurrency 3 --output "workdir/chunk_test_02.html"
# Verify structure
grep -c "<table>" workdir/chunk_test_02.html
grep -c "<style>" workdir/chunk_test_02.html
```
Expected: 3 tables, 1 style preserved. No "前言" / "翻译结果：" in output.

- [ ] **Step 7: Commit**

```bash
git add src/pipeline/stage-translate.ts src/utils/translation-prompts.ts src/agents/translator.ts
git commit -m "feat: optimized translation chunking — text extraction, dedup, TOC grouping"
```

---

### Task 3: Remove obsolete raw HTML prompt format

**Files:**
- Modify: `src/agents/translator.ts`

- [ ] **Step 1: Remove outdated rules from system prompt**

The old prompt references `<table>`, `<a>`, `<img>`, `<code>` HTML tags. Since non-table blocks now receive extracted plain text (not HTML), these rules are misleading. Keep only essential rules:

Already done in Task 2 Step 4 above.

- [ ] **Step 2: Remove `buildTranslatorTaskPrompt` if unused**

Check if `buildTranslatorTaskPrompt` is imported anywhere:

```bash
grep -r "buildTranslatorTaskPrompt" src/
```

If unused, delete it.

- [ ] **Step 3: Commit**

```bash
git add src/agents/translator.ts
git commit -m "refactor: simplify translator prompt for plain-text input format"
```

---

## Self-Review Checklist

1. **Spec coverage:**
   - [x] Text extraction (strip HTML for non-table blocks) — Task 1 `stripHtml()` + `buildParagraphPrompt()`
   - [x] Table cell-line extraction — Task 1 `buildTablePrompt()` (existing, moved)
   - [x] TOC grouping — Task 2 `groupTocBlocks()` + `buildTocGroupPrompt()`
   - [x] Dedup cache — Task 2 `dedupCache` Map
   - [x] Skip untranslatable blocks — Task 1 `isSkippable()`, Task 2 filtering
   - [x] Prompt optimization (no preamble) — Task 2 system prompt update

2. **Placeholder scan:** No TODOs, TBDs, or vague references. All code is concrete.

3. **Type consistency:**
   - `SourceBlock.id` (string) matches `TocGroup.ids` (string[])
   - `buildBlockPrompt()` takes `SourceBlock` matching existing type
   - `groupTocBlocks()` input matches `{id: string; blockType: string; text: string}` matching `SourceBlock` subset
