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

export function assembleHtmlBlocks(
  blocks: SeparatedBlock[],
  getContent: (block: SourceBlock) => string,
): string {
  return blocks.map((sb) => sb.separatorBefore + getContent(sb.block)).join("");
}
