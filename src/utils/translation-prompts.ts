import type { SourceBlock } from "../types/source-block.js";

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
export function buildTextPrompt(text: string): string {
  const plain = stripHtml(text).trim();
  if (!plain) return "";
  return `将以下内容翻译为目标语言（只输出译文，不要附加任何解释或前言）：\n\n${plain}`;
}

/** Build translation prompt for a table block — one cell per line */
export function buildTablePrompt(headerRows: string[][], rows: string[][]): string {
  const lines = [...headerRows, ...rows]
    .flat()
    .map((c) => c.trim())
    .filter((t) => t.length > 0);
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
  switch (block.type) {
    case "table":
      return buildTablePrompt(block.headerRows, block.rows);
    case "code":
      return "";
    case "other":
      return buildTextPrompt(block.text);
    case "image":
      return "";
    case "heading":
      return buildTextPrompt(block.text);
    case "list":
      return buildListPrompt(block.text);
    case "toc":
      return buildTextPrompt(block.text);
    case "paragraph":
      return buildTextPrompt(block.text);
    default:
      return "";
  }
}

/** Check if a block's prompt would be empty (skippable) */
export function isSkippable(block: SourceBlock): boolean {
  return buildBlockPrompt(block) === "";
}

/** Group consecutive TOC-like blocks into batches for grouped translation */
export interface TocGroup {
  ids: string[];
  texts: string[];
}

export function groupTocBlocks(blocks: Pick<SourceBlock, "id" | "type" | "text">[]): TocGroup[] {
  const groups: TocGroup[] = [];
  let current: TocGroup | null = null;

  for (const b of blocks) {
    if (b.type === "paragraph" && isTocLike(b.text)) {
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
