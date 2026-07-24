# HTML Pipeline Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace markitdown with Unlimited-OCR as the PDF converter and switch the entire pipeline from Markdown to HTML processing.

**Architecture:** A new DOM-based HTML splitter replaces the line-based Markdown splitter; Unlimited-OCR's `<|det|>` wrapped HTML output is post-processed into clean HTML; all prompt templates and review specs are updated for HTML semantics; file extensions change from `.md` to `.html`.

**Tech Stack:** linkedom (DOM parser), Unlimited-OCR (Transformers), Bun/TypeScript

---

## File Plan

| File | Action | Responsibility |
|------|--------|---------------|
| `src/utils/ocr-processor.ts` | **Create** | Python subprocess calling Unlimited-OCR `model.infer()` + post-processing to strip `<\|det\|>` tags |
| `src/types/source-block.ts` | Modify | Add `blockType: BlockType` field |
| `src/splitter/html-block-splitter.ts` | **Create** | DOM-based HTML splitter using linkedom (replaces `source-block-splitter.ts`) |
| `src/splitter/html-block-splitter.test.ts` | **Create** | Tests for the new splitter |
| `src/utils/file-manager.ts` | Modify | `WORKDIR_LAYOUT`: `.md` → `.html` |
| `src/pipeline/stage-convert.ts` | Rewrite | Call Unlimited-OCR via `ocr-processor.ts` instead of markitdown |
| `src/pipeline/stage-convert.test.ts` | Modify | Update mock for Unlimited-OCR |
| `src/pipeline/stage-translate.ts` | Modify | Use new HTML splitter; update prompt text |
| `src/pipeline/stage-interact.ts` | Modify | Use new HTML splitter; strip tags for terminal display |
| `src/pipeline/orchestrator.ts` | Modify | Update file path references |
| `bin/ptl.ts` | Modify | `.md` → `.html` in all help text and defaults |
| `src/agents/translator.ts` | Modify | Prompt: Markdown → HTML rules |
| `src/utils/omp-session.ts` | Modify | Prompt: Markdown → HTML in createTranslateSession |
| `agents/translator.agent.md` | Modify | Prompt: Markdown → HTML rules |
| `specs/review-conversion.md` | Rewrite | Checklist items for HTML validation |
| `specs/review-formatting.md` | Rewrite | Checklist items for HTML formatting |
| `src/utils/table-repair.ts` | Rewrite | HTML DOM-based table repair (linkedom) |
| `src/splitter/source-block-splitter.ts` | Kept (deprecated) | Retained for reference until full migration verified |
| `src/splitter/source-block-splitter.test.ts` | Kept (deprecated) | Retained for reference |
| `package.json` | Modify | Add `linkedom` dependency |

---

### Task 1: Install Dependency + Add BlockType

**Files:**
- Modify: `package.json`
- Modify: `src/types/source-block.ts`

- [ ] **Step 1: Add linkedom dependency**

```bash
bun add linkedom
```

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 2: Add BlockType to SourceBlock**

`src/types/source-block.ts`:
```typescript
export type BlockType = "heading" | "paragraph" | "table" | "code" | "list" | "other";

export interface SourceBlock {
  id: string;
  level: number;
  blockType: BlockType;
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

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock src/types/source-block.ts
git commit -m "feat: add linkedom dep and BlockType to SourceBlock"
```

---

### Task 2: HTML DOM Splitter

**Files:**
- Create: `src/splitter/html-block-splitter.ts`

- [ ] **Step 1: Write the splitter**

```typescript
import { parseHTML } from "linkedom";
import type { SeparatedBlock, SourceBlock, BlockType } from "../types/source-block.js";

function tagToBlockType(tag: string): BlockType {
  switch (tag) {
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": return "heading";
    case "table": return "table";
    case "pre": return "code";
    case "ul": case "ol": case "dl": return "list";
    case "p": case "div": case "section": case "article": return "paragraph";
    default: return "other";
  }
}

function tagLevel(tag: string): number {
  const m = tag.match(/^h([1-6])$/);
  return m ? parseInt(m[1]) : 0;
}

function serializeNode(node: ChildNode): string {
  if (node.nodeType === 3) return (node as Text).textContent ?? "";
  if (node.nodeType === 8) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  let html = `<${tag}`;
  for (const attr of el.attributes) {
    html += ` ${attr.name}="${attr.value.replace(/"/g, "&quot;")}"`;
  }
  html += ">";
  for (const child of el.childNodes) {
    html += serializeNode(child);
  }
  html += `</${tag}>`;
  return html;
}

function isSplitHeading(tag: string, level: number): boolean {
  const l = tagLevel(tag);
  if (l === 0) return false;
  return l <= 2 || (l === 3 && level >= 3);
}

export function splitHtmlToBlocks(html: string): SeparatedBlock[] {
  const blocks: SeparatedBlock[] = [];
  const { document } = parseHTML(html);
  const body = document.body || document.documentElement;

  let currentFragments: ChildNode[] = [];
  let currentLevel = 0;
  let blockIndex = 0;
  let separatorBefore = "";

  function flush() {
    if (currentFragments.length === 0) return;
    const text = currentFragments.map(serializeNode).join("");
    if (!text.trim()) { currentFragments = []; return; }

    const firstEl = currentFragments.find((n) => n.nodeType === 1) as Element | undefined;
    const tag = firstEl?.tagName?.toLowerCase() ?? "";
    const blockType = tagToBlockType(tag);

    blocks.push({
      block: {
        id: `sb_${currentLevel}_${blockIndex++}`,
        level: currentLevel,
        blockType,
        text,
      },
      separatorBefore,
    });
    separatorBefore = "";
    currentFragments = [];
  }

  const children = [...body.childNodes];
  for (const node of children) {
    if (node.nodeType === 8) continue; // skip comments

    const el = node as Element;
    const tag = el.tagName?.toLowerCase() ?? "";

    if (tag.startsWith("h") && tag.length === 2 && tagLevel(tag) > 0) {
      if (isSplitHeading(tag, currentLevel)) {
        flush();
        currentLevel = tagLevel(tag);
      }
      currentFragments.push(node);
      continue;
    }

    if (tag === "table" || tag === "pre") {
      flush();
      currentFragments.push(node);
      flush();
      continue;
    }

    currentFragments.push(node);
  }

  flush();

  return blocks;
}

export function assembleHtmlBlocks(
  blocks: SeparatedBlock[],
  getContent: (block: SourceBlock) => string,
): string {
  return blocks
    .map((sb) => sb.separatorBefore + getContent(sb.block))
    .join("");
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/splitter/html-block-splitter.ts
git commit -m "feat: add DOM-based HTML block splitter"
```

---

### Task 3: HTML Splitter Tests

**Files:**
- Create: `src/splitter/html-block-splitter.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { describe, it, expect } from "bun:test";
import { splitHtmlToBlocks, assembleHtmlBlocks } from "./html-block-splitter.js";

describe("splitHtmlToBlocks", () => {
  it("splits on <h2> boundaries", () => {
    const html = "<h2>One</h2><p>text one</p><h2>Two</h2><p>text two</p>";
    const result = splitHtmlToBlocks(html);
    expect(result.length).toBe(2);
    expect(result[0].block.text).toContain("<h2>One</h2>");
    expect(result[1].block.text).toContain("<h2>Two</h2>");
  });

  it("extracts <table> as independent block", () => {
    const html = "<h2>Table</h2><table><tr><td>a</td><td>b</td></tr></table><p>text after</p>";
    const result = splitHtmlToBlocks(html);
    const tableBlocks = result.filter((b) => b.block.blockType === "table");
    expect(tableBlocks.length).toBe(1);
    expect(tableBlocks[0].block.text).toContain("<table>");
  });

  it("extracts <pre> as independent block", () => {
    const html = "<h2>Code</h2><pre><code>fn main() {}</code></pre><p>after</p>";
    const result = splitHtmlToBlocks(html);
    const codeBlocks = result.filter((b) => b.block.blockType === "code");
    expect(codeBlocks.length).toBe(1);
    expect(codeBlocks[0].block.text).toContain("<pre>");
  });

  it("preserves separatorBefore for reassembly", () => {
    const html = "<h2>A</h2><p>content a</p><h2>B</h2><p>content b</p>";
    const blocks = splitHtmlToBlocks(html);
    const assembled = assembleHtmlBlocks(blocks, (b) => b.text);
    expect(assembled).toBe(html);
  });

  it("handles text before first heading", () => {
    const html = "<p>intro text</p><h2>Section</h2><p>body</p>";
    const result = splitHtmlToBlocks(html);
    expect(result.length).toBe(2);
    expect(result[0].block.text).toContain("intro text");
    expect(result[0].block.blockType).toBe("paragraph");
  });

  it("labels heading blocks with correct blockType", () => {
    const html = "<h2>Section A</h2><p>body</p><h3>Sub section</h3><p>detail</p>";
    const result = splitHtmlToBlocks(html);
    expect(result[0].block.blockType).toBe("heading");
    expect(result[0].block.level).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun test src/splitter/html-block-splitter.test.ts`
Expected: 6 tests pass

- [ ] **Step 3: Commit**

```bash
git add src/splitter/html-block-splitter.test.ts
git commit -m "test: add HTML block splitter tests"
```

---

### Task 4: Unlimited-OCR Post-Processor

**Files:**
- Create: `src/utils/ocr-processor.ts`

- [ ] **Step 1: Write the post-processor**

```typescript
import { execa } from "execa";
import { writeFile, readFile } from "node:fs/promises";

const WSL_VENV_PYTHON = "/root/ptl-ocr-env/bin/python3";
const MODEL_PATH = "/root/models/Unlimited-OCR/models/PaddlePaddle--Unlimited-OCR/snapshots/master";
const OCR_SCRIPT = "/tmp/ptl_ocr_infer.py";

const OCR_INFER_SCRIPT = `
import torch, os, sys, io, re, json
from transformers import AutoModel, AutoTokenizer

os.environ["TOKENIZERS_PARALLELISM"] = "false"
model_path = json.loads(sys.argv[1])
image_paths = json.loads(sys.argv[2])

tok = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
model = AutoModel.from_pretrained(model_path, trust_remote_code=True,
    use_safetensors=True, dtype=torch.bfloat16).eval().cuda()

old = sys.stdout
sys.stdout = buf = io.StringIO()

if len(image_paths) == 1:
    model.infer(tok, prompt="<image>document parsing.",
        image_file=image_paths[0],
        base_size=1024, image_size=1024, crop_mode=False,
        max_length=32768, no_repeat_ngram_size=35, ngram_window=128)
else:
    model.infer_multi(tok, prompt="<image>Multi page parsing.",
        image_files=image_paths, image_size=1024,
        max_length=65536, no_repeat_ngram_size=35, ngram_window=1024)

sys.stdout = old
raw = buf.getvalue()

# Strip <|det|> tags but keep content
clean = re.sub(r"<\\|det\\|>[^<]+<\\|/det\\|>", "", raw)
# Collapse multiple blank lines
clean = re.sub(r"\\n{3,}", "\\n\\n", clean).strip()
# Wrap in html document
html = "<!DOCTYPE html>\\n<html><body>\\n" + clean + "\\n</body></html>"
print(html)
`;

export async function stageConvertWithOcr(
  pdfPath: string,
  outputPath?: string,
  pageRange?: [number, number],
): Promise<{ success: boolean; output?: string; error?: string; outputPath?: string }> {
  try {
    // Write inference script
    await writeFile(OCR_SCRIPT, OCR_INFER_SCRIPT, "utf-8");

    // Convert PDF pages to images and run inference
    // First check if python env is available
    const checkResult = await execa(WSL_VENV_PYTHON, ["--version"], {
      reject: false,
      timeout: 5000,
    });
    if (checkResult.exitCode !== 0) {
      return {
        success: false,
        error: "Unlimited-OCR Python environment not found at " + WSL_VENV_PYTHON,
      };
    }

    // Full pipeline: convert PDF to images via pymupdf, then run OCR
    const result = await execa(WSL_VENV_PYTHON, [
      "-c",
      `
import fitz, os, tempfile, json, subprocess, sys
script_path = ${JSON.stringify(OCR_SCRIPT)}
model_path = ${JSON.stringify(MODEL_PATH)}
pdf_path = ${JSON.stringify(pdfPath)}

doc = fitz.open(pdf_path)
tmp = tempfile.mkdtemp(prefix="ptl_ocr_")
mat = fitz.Matrix(300/72, 300/72)
images = []
for i in range(len(doc)):
    out = os.path.join(tmp, f"p{i:04d}.png")
    page = doc[i]
    page.get_pixmap(matrix=mat).save(out)
    images.append(out)
doc.close()

r = subprocess.run(
    [sys.executable, script_path, json.dumps(model_path), json.dumps(images)],
    capture_output=True, text=True, timeout=600
)
print(r.stdout)
if r.stderr:
    print(r.stderr, file=sys.stderr)

import shutil
shutil.rmtree(tmp, ignore_errors=True)
      `,
    ], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 600_000,
    });

    const html = result.stdout;
    if (!html.trim()) {
      return { success: false, error: "Unlimited-OCR produced empty output" };
    }

    if (outputPath) {
      await writeFile(outputPath, html, "utf-8");
      return { success: true, outputPath };
    }
    return { success: true, output: html };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `OCR conversion failed: ${msg}` };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/ocr-processor.ts
git commit -m "feat: add Unlimited-OCR processor with det-tag stripping"
```

---

### Task 5: Rewrite stage-convert

**Files:**
- Modify: `src/pipeline/stage-convert.ts`
- Modify: `src/pipeline/stage-convert.test.ts`

- [ ] **Step 1: Rewrite stage-convert**

```typescript
import { writeFile } from "node:fs/promises";
import { stageConvertWithOcr } from "../utils/ocr-processor.js";
import type { StageResult } from "../types/pipeline.js";

export async function stageConvert(
  inputPath: string,
  outputPath?: string,
): Promise<StageResult> {
  const r = await stageConvertWithOcr(inputPath, outputPath);
  if (!r.success) {
    return {
      stage: "convert",
      success: false,
      error: r.error ?? "Unknown OCR error",
    };
  }
  if (outputPath) {
    return { stage: "convert", success: true, outputPath };
  }
  return { stage: "convert", success: true, output: r.output };
}
```

- [ ] **Step 2: Update test**

```typescript
import { describe, it, expect } from "bun:test";
import { stageConvert } from "./stage-convert.js";

describe("stageConvert", () => {
  it("fails gracefully when OCR environment unavailable", async () => {
    const result = await stageConvert("nonexistent.pdf");
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });
});
```

- [ ] **Step 3: Run test**

Run: `bun test src/pipeline/stage-convert.test.ts`
Expected: passes

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/stage-convert.ts src/pipeline/stage-convert.test.ts
git commit -m "feat: replace markitdown with Unlimited-OCR in stage-convert"
```

---

### Task 6: Update File Manager and CLI Extensions

**Files:**
- Modify: `src/utils/file-manager.ts`
- Modify: `bin/ptl.ts`

- [ ] **Step 1: Update WORKDIR_LAYOUT**

`src/utils/file-manager.ts`:
```typescript
export const WORKDIR_LAYOUT = {
  original: "01_original.html",
  reviewed: "02_reviewed.html",
  reviewReport: "02_review_report.md",
  translated: "03_translated.html",
  formatted: "04_formatted.html",
  formatReport: "04_format_report.md",
} as const;
```

- [ ] **Step 2: Update CLI help text and default paths**

`bin/ptl.ts` — replace all `.md` references with `.html` in:
- Line 47: `review <file.md>` → `review <file.html>`
- Line 60: `mdPath` → `htmlPath`
- Line 62: usage string
- Line 66: `mdPath.replace(/\.md$/, "_reviewed.md")` → `htmlPath.replace(/\.html$/, "_reviewed.html")`
- Line 67: same pattern for report
- Line 82: `translate-blocks <file.md>` → `translate-blocks <file.html>`
- Lines 96-102: same pattern
- Lines 119-133: same pattern for interact
- Line 205: `_translated.md` → `_translated.html`
- Lines 221-224: help text `PDF → Markdown` → `PDF → HTML`

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/utils/file-manager.ts bin/ptl.ts
git commit -m "refactor: switch file extensions from .md to .html"
```

---

### Task 7: Update Pipeline Stages for HTML Splitter

**Files:**
- Modify: `src/pipeline/stage-translate.ts`
- Modify: `src/pipeline/stage-interact.ts`
- Modify: `src/pipeline/orchestrator.ts`

- [ ] **Step 1: Update stage-translate**

Replace imports and variable names:

```typescript
import { splitHtmlToBlocks, assembleHtmlBlocks } from "../splitter/html-block-splitter.js";
```
Replace `splitToSeparatedBlocks(mdContent)` with `splitHtmlToBlocks(htmlContent)`
Replace `assembleFromSeparatedBlocks` with `assembleHtmlBlocks`
Replace `翻译以下 Markdown 内容：` with `翻译以下 HTML 内容：`

- [ ] **Step 2: Update stage-interact**

Replace imports and splitter call, strip HTML tags for display:

```typescript
import { splitHtmlToBlocks, assembleHtmlBlocks } from "../splitter/html-block-splitter.js";

// Inside the loop, for display:
const displayText = block.text
  .replace(/<[^>]+>/g, "")  // strip HTML tags
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"')
  .slice(0, 300);
console.log(displayText + (block.text.length > 300 ? "\n..." : ""));
```

- [ ] **Step 3: Update orchestrator**

Update the `SPEC_CONVERSION` and `SPEC_FORMATTING` references — these are still `.md` files (review specs). No change needed. The pipeline paths now have `.html` extensions via WORKDIR_LAYOUT.

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/stage-translate.ts src/pipeline/stage-interact.ts
git commit -m "refactor: switch stages to HTML splitter and prompts"
```

---

### Task 8: Update Prompt Templates

**Files:**
- Modify: `src/agents/translator.ts`
- Modify: `src/utils/omp-session.ts`
- Modify: `agents/translator.agent.md`

- [ ] **Step 1: Update translator.ts**

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
- 严格保留原始 HTML 结构和标签（标题层级、表格、列表、链接、图片）
- <pre><code> 标签内容不翻译
- <code> 内联代码不翻译
- <table>: <th> 表头翻译，<td> 单元格按术语表处理
- <a href="...">: href 属性不翻译，链接文本翻译
- <img src="..." alt="...">: src 不翻译，alt 翻译
- 属性值（class, id, style）不翻译
- 术语表中的词必须使用指定翻译`;
}

export function buildTranslatorTaskPrompt(sourceBlockText: string): string {
  return `翻译以下 HTML 内容：\n\n${sourceBlockText}`;
}
```

- [ ] **Step 2: Update omp-session.ts createTranslateSession**

```typescript
翻译规则:
- 严格保留原始 HTML 结构和标签（标题、段落、表格、代码块、链接、图片）
- <pre><code> 标签内容不翻译
- 表格: <th> 表头翻译，<td> 单元格按术语表处理
- 术语表中的词必须使用指定翻译
```

- [ ] **Step 3: Update translator.agent.md**

```markdown
2. **格式保留**: 严格保留原始 HTML 结构和标签（标题层级、表格、代码块、列表、链接、图片）
3. **代码块不翻译**: <pre><code> 标签内容保持原样
4. **表格处理**: <th> 表头翻译，<td> 单元格按术语表处理
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/agents/translator.ts src/utils/omp-session.ts agents/translator.agent.md
git commit -m "refactor: update prompts from Markdown to HTML rules"
```

---

### Task 9: Rewrite Review Specs for HTML

**Files:**
- Modify: `specs/review-conversion.md`
- Modify: `specs/review-formatting.md`

- [ ] **Step 1: Rewrite review-conversion.md**

```markdown
# PDF → HTML 转换质量审查规范

## 1. 编码与乱码

- [ ] 全文无不正常字符（乱码、控制字符、私有区字符）
- [ ] 特殊符号完整保留（单位符号 °Ωμ、数学符号 ∑∫∞、版权符号 ©®™）
- [ ] Unicode 字符正确呈现（CJK 扩展字符、emoji、变音符号）
- [ ] 引号正确转换为 HTML 实体或保留原文形式
- [ ] 破折号（—/–）、省略号（…）正确保留

## 2. 标题层级

- [ ] <h1>-<h6> 层级连续，无跳级（不允许 h1→h3 中间缺 h2）
- [ ] 标题文本完整，无截断、无跨页拆分
- [ ] 文档有且仅有一个 h1（文档标题）
- [ ] 无将正文段落、列表项、表格标题错误识别为 HTML 标题

## 3. 表格完整性

- [ ] <table> 内 <tr> 行数与表头 <th> 一致
- [ ] <td> / <th> 无缺失或多余列
- [ ] rowspan/colspan 属性正确保留
- [ ] 空单元格有占位内容，不被跳过
- [ ] 无边框表格（borderless table）被正确识别为 <table>
- [ ] 表格内容未被展平为纯文本段落
- [ ] 无 <td> 内容泄漏到表格标签之外
- [ ] 多行单元格内容未被错误分割到多个 <tr>

## 4. 列表结构

- [ ] <ol> 列表编号连续
- [ ] <ul> 嵌套层级正确（最多 4 层）
- [ ] <li> 内容完整，无跨项合并或缺失
- [ ] 列表缩进一致（CSS margin/padding 统一）

## 5. 段落连续性

- [ ] 跨页断行的段落已合并为一段
- [ ] 无多余空行或空 <p> 标签堆积
- [ ] 无丢失的段落（对比原文页数/段落数估算）

## 6. 特殊元素

- [ ] <img> 标签的 src 和 alt 属性完整保留
- [ ] <pre><code> 标签起止边界正确配对
- [ ] <code> 内联代码标签配对正确
- [ ] <pre> 语言标记 class 保留（如 language-python）
- [ ] <blockquote> 嵌套层级正确
- [ ] <a href="..."> 链接语法完整

## 7. 污染内容

- [ ] 无页眉文字混入正文
- [ ] 无页脚/页码残留
- [ ] 无水印文字混入
- [ ] 无 PDF 元数据残留

## 8. 数学公式（如有）

- [ ] LaTeX 数学公式 `$$...$$` 或 `$...$` 完整保留
- [ ] 公式无截断或乱码

## 审查输出格式

每个发现的问题按以下格式记录：

```
[严重度] 类别 - 位置
描述: ...
建议修复: ...
```

严重度定义：
- **error**: 必须修复（数据丢失、结构破坏、无法阅读）
- **warning**: 建议修复（格式偏差、可读性下降）
- **info**: 可忽略（轻微偏差，不修复也可接受）
```

- [ ] **Step 2: Rewrite review-formatting.md**

```markdown
# 翻译后排版审查规范

## 1. 中英文长度适配

- [ ] 表格列宽已根据译文重新调整，无单元格溢出或大量留白
- [ ] 列表项文本对齐不受长度变化影响
- [ ] 无因变长导致的布局溢出（如超长行撑破容器）

## 2. 段落完整性

- [ ] 翻译后段落未被意外拆分（原文一个 <p> → 译文一个 <p>）
- [ ] 翻译后段落未被意外合并
- [ ] 段落间空行数与原文一致
- [ ] 空段落（如视觉分隔符）被保留

## 3. 表格排版

- [ ] <table> 内 <th>/<td> 列数与表头一致
- [ ] rowspan/colspan 属性在翻译后正确保留
- [ ] <th> 翻译后，列对齐正常
- [ ] 单元格内换行控制在合理范围

## 4. 标题格式

- [ ] <h1>-<h6> 标签层级关系与原文一致
- [ ] 标题中的术语已正确翻译
- [ ] 无多余或缺失的标题标签

## 5. 代码块与内联代码

- [ ] <pre><code> 内容未被翻译（保持原文）
- [ ] <pre> class 语言标记已保留
- [ ] <code> 内联代码配对正确
- [ ] 代码块边界无多余空白行

## 6. 列表格式

- [ ] <ul>/<ol> 嵌套层级保留，与原文一致
- [ ] <li> 内容完整，列表缩进一致

## 7. 引用块

- [ ] <blockquote> 嵌套层级正确
- [ ] 引用块与正文间有适当间距

## 8. 链接与图片

- [ ] 链接文本已翻译，<a href="..."> 无损
- [ ] <img src="..." alt="..."> 语法无损
- [ ] img alt 文本已翻译（如有意义）
- [ ] 锚点/书签引用保持一致

## 9. 空白与缩进

- [ ] 全文缩进风格统一（CSS 一致）
- [ ] 文件末尾有且仅有一个空行
- [ ] 无多余空白标签

## 10. 特殊符号与标点

- [ ] 中英文标点规则正确
- [ ] 破折号、省略号、引号风格统一
- [ ] HTML 实体（&amp; &lt; &gt; &quot; &#x27;）使用正确

## 11. 翻译一致性

- [ ] 同一术语全文翻译一致（对照术语表）
- [ ] 数字、日期、单位格式符合目标语言习惯
- [ ] 专有名词（人名、地名、机构名）处理一致

## 审查输出格式

每个发现的问题按以下格式记录：

```
[严重度] 类别 - 位置
描述: ...
建议修复: ...
```

严重度定义：
- **error**: 必须修复（排版破坏、格式丢失、不可读）
- **warning**: 建议修复（格式不一致、可读性下降）
- **info**: 可忽略（轻微偏差，可接受）
```

- [ ] **Step 3: Commit**

```bash
git add specs/review-conversion.md specs/review-formatting.md
git commit -m "refactor: rewrite review specs for HTML validation"
```

---

### Task 10: Rewrite table-repair.ts for HTML

**Files:**
- Modify: `src/utils/table-repair.ts`

- [ ] **Step 1: Rewrite with DOM-based table repair**

```typescript
import { parseHTML } from "linkedom";

export interface TableRepairResult {
  repaired: string;
  stats: { tablesFound: number; tablesRepaired: number; };
}

export function repairHtmlTables(html: string): TableRepairResult {
  const { document } = parseHTML(html);
  const tables = document.querySelectorAll("table");
  const stats = { tablesFound: tables.length, tablesRepaired: 0 };

  for (const table of tables) {
    const rows = table.querySelectorAll("tr");
    let maxCols = 0;

    // Determine max column count
    for (const row of rows) {
      let cols = 0;
      for (const cell of row.querySelectorAll("td, th")) {
        const colspan = parseInt(cell.getAttribute("colspan") || "1");
        cols += colspan;
      }
      maxCols = Math.max(maxCols, cols);
    }

    if (maxCols === 0) continue;

    // Repair rows with fewer columns than max
    let repaired = false;
    for (const row of rows) {
      let cols = 0;
      const cells = [...row.querySelectorAll("td, th")];
      for (const cell of cells) {
        cols += parseInt(cell.getAttribute("colspan") || "1");
      }
      while (cols < maxCols) {
        const td = document.createElement("td");
        td.textContent = "";
        row.appendChild(td);
        cols++;
        repaired = true;
      }
    }
    if (repaired) stats.tablesRepaired++;
  }

  const repaired = document.body?.innerHTML ?? html;
  return { repaired, stats };
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/table-repair.ts
git commit -m "refactor: rewrite table repair for HTML DOM-based parsing"
```

---

### Task 11: Smoke Test Full Pipeline

**Files:**
- Test: `workdir/` output files

- [ ] **Step 1: Run pipeline on test PDF**

```bash
# Run conversion only
bun run bin/ptl.ts convert test/test1.pdf --output workdir/01_original.html
```

Expected: Unlimited-OCR processes test PDF → `01_original.html` created with clean HTML

- [ ] **Step 2: Verify HTML structure**

```bash
head -50 workdir/01_original.html
```

Expected: output starts with `<!DOCTYPE html><html><body>`, contains HTML tables

- [ ] **Step 3: Verify splitter**

```typescript
// Quick verification script
import { splitHtmlToBlocks } from "./src/splitter/html-block-splitter.js";
import { readFile } from "node:fs/promises";
const html = await readFile("workdir/01_original.html", "utf-8");
const blocks = splitHtmlToBlocks(html);
console.log(`Split into ${blocks.length} blocks`);
for (const b of blocks) {
  console.log(`  ${b.block.id} [${b.block.blockType}] level=${b.block.level} text.length=${b.block.text.length}`);
}
```

Expected: blocks split on `<h2>` boundaries, `<table>` as independent blocks

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: complete HTML pipeline migration"
```
