import type { SeparatedBlock, SourceBlock, BlockType } from "../types/source-block.js";
import { parseHTML } from "linkedom";

function serializeNode(node: any): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType === 8) return "";
  const el = node;
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

function guessBlockType(level: number, text: string): BlockType {
  if (level > 0) return "heading";
  if (text.includes("<table>")) return "table";
  if (text.includes("<pre>")) return "code";
  if (text.includes("<ul>") || text.includes("<ol>")) return "list";
  return "paragraph";
}

export function splitHtmlToBlocks(html: string): SeparatedBlock[] {
  const trimmed = html.trim();
  const needsWrapper = !/^<(?:!doctype\s+)?html\b/i.test(trimmed);
  const wrappedHtml = needsWrapper
    ? `<!doctype html><html><body>${html}</body></html>`
    : html;
  const { document } = parseHTML(wrappedHtml) as any;
  const body = document.body;
  const root = body;
  const blocks: SeparatedBlock[] = [];
  let currentParts: string[] = [];
  let currentLevel = 0;
  let currentSeparator = "";
  let pendingWhitespace = "";

  function flushBlock(): void {
    const text = currentParts.join("");
    if (text.length > 0) {
      blocks.push({
        block: {
          id: `sb_${currentLevel}_${blocks.length}`,
          level: currentLevel,
          blockType: guessBlockType(currentLevel, text),
          text,
        },
        separatorBefore: currentSeparator,
      });
    }
    currentParts = [];
    currentSeparator = "";
  }

  for (const node of root.childNodes) {
    if (node.nodeType === 8) continue;

    if (node.nodeType === 3) {
      const text: string = node.textContent ?? "";
      if (text.trim() === "") {
        pendingWhitespace += text;
      } else {
        currentParts.push(pendingWhitespace + text);
        pendingWhitespace = "";
      }
      continue;
    }

    const el = node as any;
    const tag: string = (el.tagName ?? "").toLowerCase();

    if (tag === "h2" || tag === "h3") {
      flushBlock();
      currentLevel = parseInt(tag[1]);
      currentSeparator = pendingWhitespace;
      pendingWhitespace = "";
      currentParts.push(serializeNode(node));
    } else if (tag === "table") {
      flushBlock();
      blocks.push({
        block: {
          id: `sb_0_${blocks.length}`,
          level: 0,
          blockType: "table",
          text: serializeNode(node),
        },
        separatorBefore: pendingWhitespace,
      });
      pendingWhitespace = "";
      currentLevel = 0;
    } else if (tag === "pre") {
      flushBlock();
      blocks.push({
        block: {
          id: `sb_0_${blocks.length}`,
          level: 0,
          blockType: "code",
          text: serializeNode(node),
        },
        separatorBefore: pendingWhitespace,
      });
      pendingWhitespace = "";
      currentLevel = 0;
    } else {
      currentParts.push(pendingWhitespace + serializeNode(node));
      pendingWhitespace = "";
    }
  }

  flushBlock();
  return blocks;
}

export function splitPerfectHtmlToBlocks(html: string): SeparatedBlock[] {
  const trimmed = html.trim();
  const wrappedHtml = !/^<(?:!doctype\s+)?html\b/i.test(trimmed)
    ? `<!doctype html><html><body>${html}</body></html>`
    : html;
  const { document } = parseHTML(wrappedHtml) as any;
  const blocks: SeparatedBlock[] = [];
  const pages = [...document.querySelectorAll(".page")] as any[];

  for (const page of pages) {
    const divs = [...page.querySelectorAll("div[style*='position:absolute']")] as any[];

    for (const el of divs) {
      const className = el.className || "";
      const isTable = className.includes("det-table");
      const isImage = className.includes("det-image");
      const isPageNum = className.includes("det-pagenumber") || className.includes("det-footer");
      const level = isPageNum ? 0 : isTable ? 0 : 0;
      let blockType: BlockType = "paragraph";

      if (isTable) blockType = "table";
      else if (isImage) blockType = "other";
      else if (isPageNum) blockType = "other";

      const text = isTable ? el.innerHTML : (el.textContent ?? "");
      blocks.push({
        block: {
          id: `sb_${blocks.length}`,
          level,
          blockType,
          text,
        },
        separatorBefore: "",
      });
    }
  }
  return blocks;
}

export function assemblePerfectHtml(
  blocks: SeparatedBlock[],
  translations: Map<string, string>,
  originalHtml: string,
): string {
  const { document } = parseHTML(
    /^<(?:!doctype\s+)?html\b/i.test(originalHtml.trim())
      ? originalHtml
      : `<!doctype html><html><body>${originalHtml}</body></html>`
  ) as any;

  const pages = [...document.querySelectorAll(".page")] as any[];
  let bi = 0;
  for (const page of pages) {
    const divs = [...page.querySelectorAll("div[style*='position:absolute']")] as any[];
    for (const el of divs) {
      const block = blocks[bi];
      if (!block) break;
      const t = translations.get(block.block.id);
      if (t !== undefined) {
        const className = el.className || "";
        if (className.includes("det-table")) {
          // For tables: keep original HTML structure, replace only text node content
          replaceTableText(el, t);
        } else if (className.includes("det-image")) {
          // Images: don't translate, skip
        } else {
          const escaped = t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          el.textContent = escaped;
        }
      }
      bi++;
    }
  }

  const headContent = document.head?.innerHTML ?? "";
  const bodyContent = (document.body || document.documentElement).innerHTML;
  return (headContent ? `<head>${headContent}</head>` : "") + bodyContent;
}

/** Replace only the text content inside table cells, preserving HTML structure */
function replaceTableText(tableWrapper: any, translated: string): void {
  const allCells = [...tableWrapper.querySelectorAll("td,th")] as any[];
  // Parse LLM output: one translated line per cell (skip empty lines)
  const translatedLines = translated
    .split("\n")
    .map((s: string) => s.replace(/<[^>]*>/g, "").trim()) // strip any accidental HTML tags
    .filter((s: string) => s.length > 0);

  let ti = 0;
  for (const cell of allCells) {
    const originalText = (cell.textContent ?? "").trim();
    if (originalText.length > 0 && ti < translatedLines.length) {
      cell.textContent = translatedLines[ti];
      ti++;
    }
  }
}

export function assembleHtmlBlocks(
  blocks: SeparatedBlock[],
  getContent: (block: SourceBlock) => string,
): string {
  return blocks.map((sb) => sb.separatorBefore + getContent(sb.block)).join("");
}
