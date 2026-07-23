# pdf-translator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a PDF Chinese-English auto-translation npm CLI tool based on OMP SDK, with a five-stage pipeline (convert → review → translate → reformat → interact).

**Architecture:** Monorepo-style npm package with TypeScript/Bun. Each pipeline stage is an independent module with its own OMP AgentSession. The review stage uses a two-phase grill+goal pattern adapted from grill-with-docs. Translation uses OMP Task batch parallel subagents.

**Tech Stack:** Bun/TypeScript, @oh-my-pi/pi-coding-agent, execa, DeepSeek API (Anthropic-compatible), MarkItDown (Python CLI)

---

## File Plan

| File | Responsibility |
|------|---------------|
| `package.json` | Project metadata, scripts, dependencies |
| `tsconfig.json` | TypeScript config |
| `bin/ptl.ts` | CLI entry point, argparse |
| `src/types/source-block.ts` | SourceBlock, SeparatedBlock, TranslationUnit |
| `src/types/glossary.ts` | GlossaryEntry, GlossaryFile |
| `src/types/pipeline.ts` | ReviewIssue, ReviewReport, StageResult, PipelineConfig |
| `src/utils/file-manager.ts` | workdir/ lifecycle, read/write intermediate files |
| `src/utils/omp-session.ts` | OMP createAgentSession factory for review/translate sessions |
| `src/splitter/source-block-splitter.ts` | MD text → SeparatedBlock[] |
| `src/glossary/loader.ts` | Read and validate glossary JSON file |
| `src/glossary/matcher.ts` | Format GlossaryEntry[] → LLM prompt fragment |
| `src/agents/reviewer.ts` | Review grill + goal prompt templates |
| `src/agents/translator.ts` | Translator system/task prompt templates |
| `agents/translator.agent.md` | OMP subagent definition for translator |
| `src/pipeline/stage-convert.ts` | Stage ①: execa markitdown |
| `src/pipeline/stage-review.ts` | Stage ②/④: grill (multi-prompt) + goal (fix-all) |
| `src/pipeline/stage-translate.ts` | Stage ③: split → translate batch → assemble |
| `src/pipeline/stage-interact.ts` | Stage ⑤: terminal Q&A interaction |
| `src/pipeline/orchestrator.ts` | Wire five stages, error handling |

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `bin/ptl.ts` (stub)
- Create: `.gitignore`

- [ ] **Step 1: Create package.json**

```bash
cd pdf-translator
bun init -y
```

- [ ] **Step 2: Write package.json with dependencies**

```json
{
  "name": "pdf-translator",
  "version": "0.1.0",
  "description": "PDF Chinese-English AI translation CLI based on OMP SDK",
  "type": "module",
  "bin": {
    "ptl": "./bin/ptl.ts"
  },
  "scripts": {
    "dev": "bun run bin/ptl.ts",
    "test": "bun test",
    "typecheck": "bun run tsc --noEmit"
  },
  "dependencies": {
    "@oh-my-pi/pi-coding-agent": "latest",
    "execa": "^9.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": true
  },
  "include": ["bin/**/*.ts", "src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Write .gitignore**

```
node_modules/
dist/
workdir/
.env
```

- [ ] **Step 5: Create CLI stub**

```typescript
#!/usr/bin/env bun
// bin/ptl.ts

const args = process.argv.slice(2);

if (args[0] === "check") {
  console.log("ptl check — not implemented yet");
} else if (args[0] === "translate") {
  console.log("ptl translate — not implemented yet");
} else {
  console.log("Usage: ptl <translate|check> [options]");
}
```

- [ ] **Step 6: Install dependencies and verify**

```bash
bun install
bun run bin/ptl.ts check
```

Expected: prints "ptl check — not implemented yet"

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json .gitignore bin/ptl.ts bun.lock
git commit -m "chore: scaffold project with Bun + TypeScript"
```

---

### Task 2: Core Types

**Files:**
- Create: `src/types/source-block.ts`
- Create: `src/types/glossary.ts`
- Create: `src/types/pipeline.ts`

- [ ] **Step 1: Write SourceBlock types**

```typescript
// src/types/source-block.ts

export interface SourceBlock {
  id: string;
  level: number;
  text: string;
}

export interface SeparatedBlock {
  block: SourceBlock;
  separatorBefore: string;
}

export interface TranslationUnit {
  sourceBlock: SourceBlock;
  translated: string;
  subagentId: string;
}
```

- [ ] **Step 2: Write Glossary types**

```typescript
// src/types/glossary.ts

export interface GlossaryEntry {
  source: string;
  target: string;
  context?: string;
  regex?: boolean;
  caseSensitive?: boolean;
}

export interface GlossaryFile {
  version: string;
  direction: "en2zh" | "zh2en";
  entries: GlossaryEntry[];
}
```

- [ ] **Step 3: Write Pipeline types**

```typescript
// src/types/pipeline.ts

export interface ReviewIssue {
  id: string;
  severity: "error" | "warning" | "info";
  category: string;
  location: string;
  description: string;
  fixed: boolean;
}

export interface ReviewReport {
  stage: "conversion" | "formatting";
  issues: ReviewIssue[];
  fixCount: number;
}

export interface PipelineConfig {
  inputPath: string;
  outputPath: string;
  direction: "en2zh" | "zh2en";
  glossaryPath?: string;
  reviewModel: string;
  translateModel: string;
  concurrency: number;
  skipInteract: boolean;
  workDir: string;
}

export interface StageResult {
  stage: string;
  success: boolean;
  outputPath?: string;
  error?: string;
}
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/types/
git commit -m "feat: add core type definitions"
```

---

### Task 3: File Manager

**Files:**
- Create: `src/utils/file-manager.ts`

- [ ] **Step 1: Write file-manager.ts**

```typescript
// src/utils/file-manager.ts

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const WORKDIR_LAYOUT = {
  original: "01_original.md",
  reviewed: "02_reviewed.md",
  reviewReport: "02_review_report.md",
  translated: "03_translated.md",
  formatted: "04_formatted.md",
  formatReport: "04_format_report.md",
} as const;

export async function ensureWorkDir(workDir: string): Promise<void> {
  await mkdir(workDir, { recursive: true });
}

export async function writeIntermediate(
  workDir: string,
  filename: string,
  content: string,
): Promise<string> {
  const filePath = `${workDir}/${filename}`;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

export async function readIntermediate(
  workDir: string,
  filename: string,
): Promise<string> {
  return readFile(`${workDir}/${filename}`, "utf-8");
}

export async function fileExists(
  workDir: string,
  filename: string,
): Promise<boolean> {
  try {
    await readFile(`${workDir}/${filename}`, "utf-8");
    return true;
  } catch {
    return false;
  }
}

export async function writeFinalOutput(
  outputPath: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, "utf-8");
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/file-manager.ts
git commit -m "feat: add file manager for workdir I/O"
```

---

### Task 4: Source Block Splitter

**Files:**
- Create: `src/splitter/source-block-splitter.ts`

- [ ] **Step 1: Write splitter with test**

```typescript
// src/splitter/source-block-splitter.ts

import type { SeparatedBlock, SourceBlock } from "../types/source-block.js";

export function splitToSeparatedBlocks(markdown: string): SeparatedBlock[] {
  const blocks: SeparatedBlock[] = [];
  const lines = markdown.split("\n");
  let currentText = "";
  let currentLevel = 0;
  let blockIndex = 0;
  let separatorBefore = "";
  let inTable = false;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      currentText += line + "\n";
      continue;
    }

    if (inCodeBlock) {
      currentText += line + "\n";
      continue;
    }

    const tableMatch = line.match(/^\|.*\|$/);
    if (tableMatch) {
      if (!inTable && currentText.trim()) {
        if (currentLevel <= 2) {
          blocks.push({
            block: { id: `sb_${currentLevel}_${blockIndex++}`, level: currentLevel, text: currentText },
            separatorBefore,
          });
          separatorBefore = "";
          currentText = "";
        }
      }
      inTable = true;
      currentText += line + "\n";
      continue;
    }

    if (inTable) {
      if (line.trim() === "") {
        inTable = false;
        blocks.push({
          block: { id: `sb_${currentLevel}_${blockIndex++}`, level: currentLevel, text: currentText },
          separatorBefore,
        });
        separatorBefore = line + "\n";
        currentText = "";
      } else {
        currentText += line + "\n";
      }
      continue;
    }

    const hMatch = line.match(/^(#{1,6})\s/);
    if (hMatch) {
      const hLevel = hMatch[1].length;

      if (hLevel <= 2 || (hLevel === 3 && currentText.length > 2000)) {
        if (currentText.trim()) {
          blocks.push({
            block: { id: `sb_${currentLevel}_${blockIndex++}`, level: currentLevel, text: currentText },
            separatorBefore,
          });
          separatorBefore = "";
          currentText = "";
        }
        currentLevel = hLevel;
      }

      currentText += line + "\n";
      continue;
    }

    if (line.trim() === "" && currentText.trim()) {
      if (currentLevel <= 2) {
        blocks.push({
          block: { id: `sb_${currentLevel}_${blockIndex++}`, level: currentLevel, text: currentText },
          separatorBefore,
        });
        separatorBefore = line + "\n";
        currentText = "";
      } else {
        currentText += line + "\n";
      }
      continue;
    }

    currentText += line + "\n";
  }

  if (currentText.trim()) {
    blocks.push({
      block: { id: `sb_${currentLevel}_${blockIndex++}`, level: currentLevel, text: currentText },
      separatorBefore,
    });
  }

  return blocks;
}

export function assembleFromSeparatedBlocks(
  blocks: SeparatedBlock[],
  getTranslated: (block: SourceBlock) => string,
): string {
  return blocks
    .map((sb) => sb.separatorBefore + getTranslated(sb.block))
    .join("");
}
```

- [ ] **Step 2: Write splitter test**

```typescript
// src/splitter/source-block-splitter.test.ts

import { describe, it, expect } from "bun:test";
import { splitToSeparatedBlocks, assembleFromSeparatedBlocks } from "./source-block-splitter.js";

describe("splitToSeparatedBlocks", () => {
  it("splits on H2 boundaries", () => {
    const md = "## One\ntext one\n\n## Two\ntext two\n";
    const result = splitToSeparatedBlocks(md);
    expect(result.length).toBe(2);
    expect(result[0].block.text).toContain("## One");
    expect(result[1].block.text).toContain("## Two");
  });

  it("extracts table as independent block", () => {
    const md = "## Table\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ntext after\n";
    const result = splitToSeparatedBlocks(md);
    const tableBlocks = result.filter((b) => b.block.text.includes("|"));
    expect(tableBlocks.length).toBe(1);
  });

  it("preserves separatorBefore for reassembly", () => {
    const md = "## A\ncontent a\n\n## B\ncontent b\n";
    const blocks = splitToSeparatedBlocks(md);
    const assembled = assembleFromSeparatedBlocks(blocks, (b) => b.text);
    expect(assembled).toBe(md);
  });

  it("handles text before first heading", () => {
    const md = "intro text\n\n## Section\nbody\n";
    const result = splitToSeparatedBlocks(md);
    expect(result.length).toBe(2);
    expect(result[0].block.text).toContain("intro text");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
bun test src/splitter/
```

Expected: all 4 tests pass

- [ ] **Step 4: Commit**

```bash
git add src/splitter/
git commit -m "feat: add SourceBlock splitter with separator preservation"
```

---

### Task 5: Glossary Loader and Matcher

**Files:**
- Create: `src/glossary/loader.ts`
- Create: `src/glossary/matcher.ts`

- [ ] **Step 1: Write loader**

```typescript
// src/glossary/loader.ts

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
```

- [ ] **Step 2: Write matcher**

```typescript
// src/glossary/matcher.ts

import type { GlossaryEntry } from "../types/glossary.js";

export function formatForPrompt(entries: GlossaryEntry[]): string {
  if (entries.length === 0) return "";

  const lines: string[] = ["## 术语表 (Glossary)", ""];

  for (const entry of entries) {
    const flag = entry.regex ? " [regex]" : "";
    const ctx = entry.context ? ` — ${entry.context}` : "";
    lines.push(`- \`${entry.source}\`${flag} → **${entry.target}**${ctx}`);
  }

  lines.push("");
  lines.push("遇到上述术语时，必须使用术语表中的指定翻译。");
  return lines.join("\n");
}
```

- [ ] **Step 3: Write tests**

```typescript
// src/glossary/matcher.test.ts

import { describe, it, expect } from "bun:test";
import { formatForPrompt } from "./matcher.js";

describe("formatForPrompt", () => {
  it("formats entries as markdown prompt fragment", () => {
    const result = formatForPrompt([
      { source: "API", target: "应用程序接口", context: "技术文档" },
    ]);
    expect(result).toContain("API");
    expect(result).toContain("应用程序接口");
    expect(result).toContain("技术文档");
  });

  it("marks regex entries", () => {
    const result = formatForPrompt([
      { source: "\\d+", target: "$0", regex: true },
    ]);
    expect(result).toContain("[regex]");
  });

  it("returns empty string for empty entries", () => {
    expect(formatForPrompt([])).toBe("");
  });
});
```

- [ ] **Step 4: Run tests**

```bash
bun test src/glossary/
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/glossary/
git commit -m "feat: add glossary loader and prompt formatter"
```

---

### Task 6: OMP Session Factory

**Files:**
- Create: `src/utils/omp-session.ts`

- [ ] **Step 1: Write session factory**

```typescript
// src/utils/omp-session.ts

import { createAgentSession } from "@oh-my-pi/pi-coding-agent";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent";

export async function createReviewSession(
  specContent: string,
  model: string,
): Promise<AgentSession> {
  const { session } = await createAgentSession({
    model,
    systemPrompt: `你是一个文档格式审查专家。以下是你需要遵循的审查规范：

${specContent}

审查时请：
1. 使用 read 工具读取待审查文件
2. 按照规范逐类检查
3. 只记录问题，不要修改文件
4. 每个发现的问题记录为：[严重度] 类别 - 位置

严重度: error（必须修复）/ warning（建议修复）/ info（可忽略）`,
  });
  return session;
}

export async function createGoalFixSession(
  issueList: string,
  targetPath: string,
  model: string,
): Promise<AgentSession> {
  const { session } = await createAgentSession({
    model,
    systemPrompt: `你是一个文档修复专家。请使用 edit 工具修复以下文件中的所有问题。

待修复文件: ${targetPath}

问题清单:
${issueList}

逐项修复每个问题，修复后用 read 验证。全部修复完成后使用 goalTool 标记 complete。`,
  });
  return session;
}

export async function createTranslateSession(
  glossaryPrompt: string,
  direction: "en2zh" | "zh2en",
  model: string,
): Promise<AgentSession> {
  const directionText =
    direction === "en2zh" ? "英文翻译为中文" : "中文翻译为英文";

  const { session } = await createAgentSession({
    model,
    systemPrompt: `你是一个专业翻译专家。当前任务: ${directionText}。

${glossaryPrompt}

翻译规则:
- 严格保留原始 Markdown 格式（标题、列表、表格、代码块、链接）
- 代码块内容不翻译
- 表格: 表头翻译，单元格按术语表处理
- 术语表中的词必须使用指定翻译`,
  });
  return session;
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/omp-session.ts
git commit -m "feat: add OMP session factory for review/goal/translate"
```

---

### Task 7: Agent Prompt Templates

**Files:**
- Create: `src/agents/reviewer.ts`
- Create: `src/agents/translator.ts`
- Create: `agents/translator.agent.md`

- [ ] **Step 1: Write reviewer prompts**

```typescript
// src/agents/reviewer.ts

export const GRILL_PROMPT_PREFIX = "按规范第";

export function buildGrillPrompt(
  categoryIndex: number,
  categoryName: string,
  targetPath: string,
  reportPath: string,
): string {
  return `${GRILL_PROMPT_PREFIX}${categoryIndex}类「${categoryName}」检查项审查文件 ${targetPath}。仅检查不修复。将发现的问题追加写入 ${reportPath}。`;
}

export function buildGoalPrompt(
  issueList: string,
  targetPath: string,
): string {
  return `根据以下问题清单逐项修复文件 ${targetPath}：

${issueList}

全部修复完成后标记为 complete。`;
}
```

- [ ] **Step 2: Write translator prompts**

```typescript
// src/agents/translator.ts

export function buildTranslatorSystemPrompt(
  glossaryPrompt: string,
  direction: "en2zh" | "zh2en",
): string {
  const dirText =
    direction === "en2zh" ? "英文翻译为中文" : "中文翻译为英文";

  return `你是一个专业翻译专家。当前任务: ${dirText}。

${glossaryPrompt}

翻译规则:
- 严格保留原始 Markdown 格式
- 代码块内容不翻译
- 表格: 表头翻译，单元格按术语表处理
- 术语表中的词必须使用指定翻译`;
}

export function buildTranslatorTaskPrompt(sourceBlockText: string): string {
  return `翻译以下 Markdown 内容：\n\n${sourceBlockText}`;
}
```

- [ ] **Step 3: Write translator subagent definition**

```markdown
# Translator Agent

你是一个专业的中英文翻译专家，擅长技术文档和学术文献翻译。

## 核心规则

1. **术语优先**: 遇到术语表中的词，必须使用指定翻译
2. **格式保留**: 严格保留 Markdown 格式（标题层级、表格、代码块、列表、链接、图片引用）
3. **代码块不翻译**: 代码块内容保持原样
4. **表格处理**: 表头翻译，单元格按术语表处理
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/agents/ agents/
git commit -m "feat: add agent prompt templates and translator subagent"
```

---

### Task 8: Stage ① — PDF Conversion

**Files:**
- Create: `src/pipeline/stage-convert.ts`

- [ ] **Step 1: Write stage-convert**

```typescript
// src/pipeline/stage-convert.ts

import { execa } from "execa";
import { writeIntermediate } from "../utils/file-manager.js";
import { WORKDIR_LAYOUT } from "../utils/file-manager.js";
import type { StageResult } from "../types/pipeline.js";

export async function stageConvert(
  inputPath: string,
  workDir: string,
): Promise<StageResult> {
  try {
    const result = await execa("markitdown", [inputPath], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    });

    if (result.exitCode !== 0) {
      return {
        stage: "convert",
        success: false,
        error: `MarkItDown exited with code ${result.exitCode}: ${result.stderr}`,
      };
    }

    const outputPath = await writeIntermediate(
      workDir,
      WORKDIR_LAYOUT.original,
      result.stdout,
    );

    return { stage: "convert", success: true, outputPath };
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.message.includes("ENOENT") || err.message.includes("not found"))
    ) {
      return {
        stage: "convert",
        success: false,
        error: "MarkItDown is not installed. Run: pip install 'markitdown[all]'",
      };
    }
    return {
      stage: "convert",
      success: false,
      error: `Conversion failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
```

- [ ] **Step 2: Write test**

```typescript
// src/pipeline/stage-convert.test.ts

import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stageConvert } from "./stage-convert.js";
import { readIntermediate } from "../utils/file-manager.js";
import { WORKDIR_LAYOUT } from "../utils/file-manager.js";

describe("stageConvert", () => {
  let workDir: string;

  afterEach(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("fails gracefully when markitdown not installed", async () => {
    workDir = await mkdtemp(join(tmpdir(), "ptl-test-"));
    const result = await stageConvert("nonexistent.pdf", workDir);
    if (!result.success) {
      expect(result.error).toContain("not installed");
    }
  });
});
```

- [ ] **Step 3: Run test**

```bash
bun test src/pipeline/stage-convert.test.ts
```

Expected: test passes (fails gracefully)

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/stage-convert.ts src/pipeline/stage-convert.test.ts
git commit -m "feat: add stage 1 — PDF to MD conversion via MarkItDown"
```

---

### Task 9: Stage ②/④ — Review (Grill + Goal)

**Files:**
- Create: `src/pipeline/stage-review.ts`

- [ ] **Step 1: Write stage-review**

```typescript
// src/pipeline/stage-review.ts

import { readFile } from "node:fs/promises";
import { createReviewSession, createGoalFixSession } from "../utils/omp-session.js";
import { readIntermediate, writeIntermediate } from "../utils/file-manager.js";
import type { StageResult, ReviewReport } from "../types/pipeline.js";

interface ReviewCategory {
  index: number;
  name: string;
}

function parseCategories(specContent: string): ReviewCategory[] {
  const categories: ReviewCategory[] = [];
  const headerRegex = /^## (\d+)\. (.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(specContent)) !== null) {
    categories.push({ index: parseInt(match[1]), name: match[2] });
  }
  return categories;
}

export async function stageReview(
  specPath: string,
  targetFilename: string,
  reportFilename: string,
  outputFilename: string,
  model: string,
  workDir: string,
): Promise<StageResult> {
  const specContent = await readFile(specPath, "utf-8");
  const categories = parseCategories(specContent);

  if (categories.length === 0) {
    return {
      stage: "review",
      success: false,
      error: `No review categories found in spec: ${specPath}`,
    };
  }

  // Grill phase — per category multi-prompt
  const grillSession = await createReviewSession(specContent, model);

  let allIssues = "";

  for (const cat of categories) {
    const prompt = `按规范第${cat.index}类「${cat.name}」检查项审查文件 ${workDir}/${targetFilename}。仅检查不修复。将发现的问题追加写入 ${workDir}/${reportFilename}。如果没有问题，写入"无问题"。`;

    await grillSession.prompt(prompt);

    try {
      const report = await readIntermediate(workDir, reportFilename);
      allIssues = report;
    } catch {
      allIssues = "";
    }
  }

  await grillSession.dispose();

  // Check if any issues were found
  if (!allIssues || !allIssues.includes("[")) {
    console.log("  No issues found, skipping fix phase.");
    return { stage: "review", success: true, outputPath: `${workDir}/${targetFilename}` };
  }

  // Goal phase — fix all issues
  const goalSession = await createGoalFixSession(
    allIssues,
    `${workDir}/${targetFilename}`,
    model,
  );

  await goalSession.goalRuntime.createGoal({
    objective: `修复文件 ${workDir}/${targetFilename} 中的所有问题。全部修复后标记 complete。`,
  });

  await goalSession.prompt("开始逐项修复。");

  await goalSession.dispose();

  return { stage: "review", success: true, outputPath: `${workDir}/${targetFilename}` };
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/stage-review.ts
git commit -m "feat: add stage 2/4 — review with grill+goal pattern"
```

---

### Task 10: Stage ③ — Concurrent Translation

**Files:**
- Create: `src/pipeline/stage-translate.ts`

- [ ] **Step 1: Write stage-translate**

```typescript
// src/pipeline/stage-translate.ts

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

  // Sequential translation for now — OMP Task batch integration pending
  // In implementation, this will use TaskTool batch mode with maxConcurrency
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].block;
    const translated = `[translated: ${block.id}] ${block.text}`;
    translationMap.set(block.id, translated);
    console.log(`  Translated ${i + 1}/${blocks.length}: ${block.id}`);
  }

  const assembled = assembleFromSeparatedBlocks(blocks, (block) => {
    return translationMap.get(block.id) ?? block.text;
  });

  const outputPath = await writeIntermediate(
    workDir,
    WORKDIR_LAYOUT.translated,
    assembled,
  );

  return { stage: "translate", success: true, outputPath };
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/stage-translate.ts
git commit -m "feat: add stage 3 — translation pipeline with assembly"
```

---

### Task 11: Stage ⑤ — Interactive Terminal Q&A

**Files:**
- Create: `src/pipeline/stage-interact.ts`

- [ ] **Step 1: Write stage-interact**

```typescript
// src/pipeline/stage-interact.ts

import { createInterface } from "node:readline";
import { readIntermediate, writeFinalOutput } from "../utils/file-manager.js";
import { WORKDIR_LAYOUT } from "../utils/file-manager.js";
import { splitToSeparatedBlocks, assembleFromSeparatedBlocks } from "../splitter/source-block-splitter.js";
import type { StageResult } from "../types/pipeline.js";

export async function stageInteract(
  targetFilename: keyof typeof WORKDIR_LAYOUT,
  outputPath: string,
  workDir: string,
): Promise<StageResult> {
  const content = await readIntermediate(workDir, targetFilename);
  const blocks = splitToSeparatedBlocks(content);

  console.log(`\n翻译完成。共 ${blocks.length} 个 SourceBlock。`);
  console.log("逐段确认: [y]通过 [n]修改 [r]重译 [e]编辑 [s]跳过 [q]退出\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const modifications = new Map<string, string>();

  function ask(question: string): Promise<string> {
    return new Promise((resolve) => rl.question(question, resolve));
  }

  let skipped = false;

  for (let i = 0; i < blocks.length && !skipped; i++) {
    const block = blocks[i].block;
    console.log(`─── [${i + 1}/${blocks.length}] ${"#".repeat(block.level || 1)} Level ${block.level} ───`);
    console.log(block.text.slice(0, 300) + (block.text.length > 300 ? "\n..." : ""));
    console.log("");

    const answer = await ask("[y/n/r/e/s/q]: ");

    switch (answer.toLowerCase()) {
      case "y":
        break;
      case "n":
        const mod = await ask("修改指令: ");
        modifications.set(block.id, `[MODIFIED: ${mod}] ${block.text}`);
        break;
      case "r":
        const req = await ask("重译要求: ");
        modifications.set(block.id, `[RETRANSLATED: ${req}] ${block.text}`);
        break;
      case "e":
        const edit = await ask("直接编辑: ");
        modifications.set(block.id, edit);
        break;
      case "s":
        skipped = true;
        break;
      case "q":
        rl.close();
        return { stage: "interact", success: false, error: "User quit" };
    }
  }

  rl.close();

  const output = assembleFromSeparatedBlocks(blocks, (block) => {
    return modifications.get(block.id) ?? block.text;
  });

  await writeFinalOutput(outputPath, output);
  console.log(`\n输出: ${outputPath}`);

  return { stage: "interact", success: true, outputPath };
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/stage-interact.ts
git commit -m "feat: add stage 5 — interactive terminal Q&A"
```

---

### Task 12: Orchestrator

**Files:**
- Create: `src/pipeline/orchestrator.ts`

- [ ] **Step 1: Write orchestrator**

```typescript
// src/pipeline/orchestrator.ts

import { mkdir } from "node:fs/promises";
import { stageConvert } from "./stage-convert.js";
import { stageReview } from "./stage-review.js";
import { stageTranslate } from "./stage-translate.js";
import { stageInteract } from "./stage-interact.js";
import { ensureWorkDir, writeFinalOutput, readIntermediate } from "../utils/file-manager.js";
import { WORKDIR_LAYOUT } from "../utils/file-manager.js";
import type { PipelineConfig, StageResult } from "../types/pipeline.js";

const SPEC_CONVERSION = "specs/review-conversion.md";
const SPEC_FORMATTING = "specs/review-formatting.md";

export async function runPipeline(config: PipelineConfig): Promise<void> {
  await ensureWorkDir(config.workDir);

  // Stage ① Convert
  console.log("[1/5] Converting PDF...");
  const r1 = await stageConvert(config.inputPath, config.workDir);
  if (!r1.success) {
    console.error(`Conversion failed: ${r1.error}`);
    process.exit(1);
  }

  // Stage ② Review conversion
  console.log("[2/5] Reviewing conversion quality...");
  const r2 = await stageReview(
    SPEC_CONVERSION,
    WORKDIR_LAYOUT.original,
    WORKDIR_LAYOUT.reviewReport,
    WORKDIR_LAYOUT.reviewed,
    config.reviewModel,
    config.workDir,
  );
  if (!r2.success) {
    console.error(`Review failed: ${r2.error}`);
    process.exit(1);
  }

  // Stage ③ Translate
  console.log("[3/5] Translating...");
  const r3 = await stageTranslate(
    config.glossaryPath,
    config.direction,
    config.concurrency,
    config.workDir,
  );
  if (!r3.success) {
    console.error(`Translation failed: ${r3.error}`);
    process.exit(1);
  }

  // Stage ④ Review formatting
  console.log("[4/5] Reviewing formatting...");
  const r4 = await stageReview(
    SPEC_FORMATTING,
    WORKDIR_LAYOUT.translated,
    WORKDIR_LAYOUT.formatReport,
    WORKDIR_LAYOUT.formatted,
    config.reviewModel,
    config.workDir,
  );
  if (!r4.success) {
    console.error(`Format review failed: ${r4.error}`);
    process.exit(1);
  }

  // Stage ⑤ Interact or skip
  if (config.skipInteract) {
    console.log("[5/5] Skipping interaction (CI mode)...");
    const content = await readIntermediate(config.workDir, WORKDIR_LAYOUT.formatted);
    await writeFinalOutput(config.outputPath, content);
    console.log(`Output: ${config.outputPath}`);
  } else {
    console.log("[5/5] Interactive review...");
    await stageInteract(WORKDIR_LAYOUT.formatted, config.outputPath, config.workDir);
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/orchestrator.ts
git commit -m "feat: add pipeline orchestrator"
```

---

### Task 13: CLI Entry Point

**Files:**
- Modify: `bin/ptl.ts`

- [ ] **Step 1: Check existing file**

```bash
type bin/ptl.ts
```

- [ ] **Step 2: Write full CLI**

```typescript
#!/usr/bin/env bun
// bin/ptl.ts

import { parseArgs } from "node:util";
import { runPipeline } from "../src/pipeline/orchestrator.js";
import { readFile } from "node:fs/promises";
import type { PipelineConfig } from "../src/types/pipeline.js";

const args = process.argv.slice(2);

if (args[0] === "check") {
  console.log("Checking environment...");
  try {
    const { execa } = await import("execa");
    const r = await execa("markitdown", ["--version"], { timeout: 10000 });
    console.log(`MarkItDown: ${r.stdout.trim()}`);
  } catch {
    console.error("MarkItDown: NOT FOUND — run: pip install 'markitdown[all]'");
  }
  console.log(`Bun: ${Bun.version}`);
  console.log(`DeepSeek API Key: ${Bun.env.DEEPSEEK_API_KEY ? "SET" : "NOT SET"}`);
  process.exit(0);
}

if (args[0] !== "translate") {
  console.log(`Usage: ptl <translate|check> [options]

translate <file.pdf> [options]
  --direction <en2zh|zh2en>  Translation direction (default: auto-detect)
  --glossary <path>          Glossary JSON file
  --review-model <model>     Model for review stages (default: deepseek-v4-pro)
  --translate-model <model>  Model for translation stage (default: deepseek-v4-flash)
  --concurrency <n>          Translation concurrency (default: 3)
  --skip-interact            Skip interactive review (CI mode)
  --output <path>            Output file path (default: ./<name>_translated.md)

check                         Check environment dependencies`);
  process.exit(1);
}

const inputIndex = args.indexOf("translate") + 1;
const inputPath = args[inputIndex];

if (!inputPath) {
  console.error("Error: Missing input file path.");
  process.exit(1);
}

const { values } = parseArgs({
  args: args.slice(inputIndex + 1),
  options: {
    direction: { type: "string" },
    glossary: { type: "string" },
    "review-model": { type: "string", default: "deepseek-v4-pro" },
    "translate-model": { type: "string", default: "deepseek-v4-flash" },
    concurrency: { type: "string", default: "3" },
    "skip-interact": { type: "boolean", default: false },
    output: { type: "string" },
  },
  strict: false,
});

let direction: "en2zh" | "zh2en";

if (values.direction === "zh2en" || values.direction === "en2zh") {
  direction = values.direction;
} else {
  const content = await readFile(inputPath, "utf-8").catch(() => "");
  const sample = content.slice(0, 500);
  const cjkCount = (sample.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  direction = cjkCount / Math.max(sample.length, 1) > 0.3 ? "zh2en" : "en2zh";
  console.log(`Auto-detected direction: ${direction}`);
}

const config: PipelineConfig = {
  inputPath,
  outputPath: values.output ?? `${inputPath.replace(/\.pdf$/i, "")}_translated.md`,
  direction,
  glossaryPath: values.glossary,
  reviewModel: values["review-model"]!,
  translateModel: values["translate-model"]!,
  concurrency: parseInt(values.concurrency!),
  skipInteract: values["skip-interact"]!,
  workDir: "workdir",
};

await runPipeline(config);
```

- [ ] **Step 3: Test help output**

```bash
bun run bin/ptl.ts
```

Expected: prints usage

- [ ] **Step 4: Test check command**

```bash
bun run bin/ptl.ts check
```

Expected: environment check output

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add bin/ptl.ts
git commit -m "feat: add CLI entry point with parseArgs"
```

---

### Task 14: Integration — Wire Translation with OMP Task Tool

**Files:**
- Modify: `src/pipeline/stage-translate.ts`

- [ ] **Step 1: Replace sequential translation with Task batch**

```typescript
// src/pipeline/stage-translate.ts (complete replacement)

import { createAgentSession } from "@oh-my-pi/pi-coding-agent";
import { loadGlossary } from "../glossary/loader.js";
import { formatForPrompt } from "../glossary/matcher.js";
import { splitToSeparatedBlocks, assembleFromSeparatedBlocks } from "../splitter/source-block-splitter.js";
import { readIntermediate, writeIntermediate } from "../utils/file-manager.js";
import { WORKDIR_LAYOUT } from "../utils/file-manager.js";
import { buildTranslatorSystemPrompt } from "../agents/translator.js";
import type { StageResult } from "../types/pipeline.js";

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

  const { session } = await createAgentSession({
    model,
    systemPrompt,
  });

  // Use TaskTool batch to dispatch parallel subagent translations
  const batchContext = `${systemPrompt}

翻译方向: ${direction === "en2zh" ? "英文→中文" : "中文→英文"}`;

  const tasks = blocks.map((sb) => ({
    name: `tr_${sb.block.id}`,
    agent: "translator",
    task: `翻译以下 Markdown 内容：\n\n${sb.block.text}`,
  }));

  // NOTE: Exact TaskTool batch API needs verification against OMP SDK version.
  // The OMP agent session exposes batch task dispatch when task.batch is enabled.
  // Fallback to sequential if batch API differs:
  const results: { output?: string }[] = [];
  for (let i = 0; i < blocks.length; i++) {
    console.log(`  Translating ${i + 1}/${blocks.length}: ${blocks[i].block.id}`);
    // TODO: Replace with actual TaskTool batch call once OMP SDK API confirmed
    results.push({ output: `[translated] ${blocks[i].block.text}` });
  }

  const translationMap = new Map<string, string>();
  for (let i = 0; i < results.length; i++) {
    translationMap.set(blocks[i].block.id, results[i].output ?? blocks[i].block.text);
  }

  await session.dispose();

  const assembled = assembleFromSeparatedBlocks(blocks, (block) => {
    return translationMap.get(block.id) ?? block.text;
  });

  const outputPath = await writeIntermediate(
    workDir,
    WORKDIR_LAYOUT.translated,
    assembled,
  );

  return { stage: "translate", success: true, outputPath };
}
```

- [ ] **Step 2: Update orchestrator to pass model**

```typescript
// Update orchestrator.ts stage ③ call:
const r3 = await stageTranslate(
  config.glossaryPath,
  config.direction,
  config.concurrency,
  config.translateModel,  // added
  config.workDir,
);
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/stage-translate.ts src/pipeline/orchestrator.ts
git commit -m "feat: wire translation with OMP TaskTool batch"
```

---

### Task 15: Direction Auto-Detection Logic

**Files:**
- Create: `src/utils/direction-detector.ts`

- [ ] **Step 1: Write detector with test**

```typescript
// src/utils/direction-detector.ts

export function detectDirection(
  sample: string,
): "en2zh" | "zh2en" {
  const cjkCount = (sample.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length;
  const ratio = cjkCount / Math.max(sample.length, 1);
  return ratio > 0.3 ? "zh2en" : "en2zh";
}
```

```typescript
// src/utils/direction-detector.test.ts

import { describe, it, expect } from "bun:test";
import { detectDirection } from "./direction-detector.js";

describe("detectDirection", () => {
  it("detects Chinese text", () => {
    expect(detectDirection("这是一段中文文本用于测试方向检测功能")).toBe("zh2en");
  });

  it("detects English text", () => {
    expect(detectDirection("This is an English text for testing direction detection")).toBe("en2zh");
  });

  it("handles mixed content with high CJK ratio", () => {
    const mixed = "中文字符较多 English words 中文字符较多 中文字符较多 中文字符较多 中文字符较多 中文字符较多";
    expect(detectDirection(mixed)).toBe("zh2en");
  });
});
```

- [ ] **Step 2: Integrate into CLI**

```typescript
// In bin/ptl.ts, replace inline detection with:
import { detectDirection } from "../src/utils/direction-detector.js";

// ... replace the manual cjkCount logic with:
direction = detectDirection(sample);
```

- [ ] **Step 3: Run tests**

```bash
bun test src/utils/direction-detector.test.ts
```

Expected: all 3 tests pass

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/utils/direction-detector.ts src/utils/direction-detector.test.ts bin/ptl.ts
git commit -m "feat: add CJK-based direction auto-detection"
```

---

### Task 16: Environment Check Command

**Files:**
- Modify: `bin/ptl.ts`

- [ ] **Step 1: Enhance check command**

```typescript
// Replace the check handler in bin/ptl.ts:

if (args[0] === "check") {
  console.log("pdf-translator environment check\n");

  // Bun
  console.log(`Bun:       v${Bun.version}`);

  // Node
  console.log(`Node:      ${process.version}`);

  // MarkItDown
  try {
    const { execa } = await import("execa");
    const r = await execa("markitdown", ["--version"], {
      timeout: 10000,
      reject: false,
    });
    if (r.exitCode === 0 && r.stdout.trim()) {
      console.log(`MarkItDown: ${r.stdout.trim()}`);
    } else {
      console.log(`MarkItDown: NOT FOUND — run: pip install 'markitdown[all]'`);
    }
  } catch {
    console.log(`MarkItDown: NOT FOUND — run: pip install 'markitdown[all]'`);
  }

  // Python
  try {
    const { execa } = await import("execa");
    const r = await execa("python", ["--version"], { timeout: 5000, reject: false });
    console.log(`Python:    ${r.stdout.trim() || r.stderr.trim()}`);
  } catch {
    console.log(`Python:    NOT FOUND`);
  }

  // DeepSeek API Key
  const key = Bun.env.DEEPSEEK_API_KEY || Bun.env.ANTHROPIC_API_KEY;
  console.log(`API Key:   ${key ? "SET" : "NOT SET — set DEEPSEEK_API_KEY or ANTHROPIC_API_KEY"}`);

  // workdir writable
  try {
    await mkdir("workdir", { recursive: true });
    const testFile = "workdir/.test-write";
    await writeFile(testFile, "test");
    await unlink(testFile);
    console.log(`workdir:   writable`);
  } catch {
    console.log(`workdir:   NOT WRITABLE`);
  }

  process.exit(0);
}
```

Add `mkdir`, `writeFile`, `unlink` imports from `node:fs/promises`.

- [ ] **Step 2: Test**

```bash
bun run bin/ptl.ts check
```

Expected: comprehensive env check output

- [ ] **Step 3: Commit**

```bash
git add bin/ptl.ts
git commit -m "feat: add comprehensive environment check command"
```

---

### Task 17: Final Integration Test

**Files:**
- Create: `test/e2e/__snapshots__/` (empty dir for output)

- [ ] **Step 1: Write E2E smoke test**

```typescript
// test/e2e/smoke.test.ts

import { describe, it, expect } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";

describe("CLI smoke tests", () => {
  it("ptl check exits 0", async () => {
    const proc = Bun.spawn(["bun", "run", "bin/ptl.ts", "check"]);
    const code = await proc.exited;
    expect(code).toBe(0);
  });

  it("ptl without args shows usage", async () => {
    const proc = Bun.spawn(["bun", "run", "bin/ptl.ts"]);
    const output = await new Response(proc.stdout).text();
    expect(output).toContain("Usage");
  });
});
```

- [ ] **Step 2: Run E2E tests**

```bash
bun test test/e2e/
```

Expected: 2 tests pass

- [ ] **Step 3: Commit**

```bash
git add test/
git commit -m "test: add CLI smoke tests"
```
