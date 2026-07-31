import type { SeparatedBlock, SourceBlock, BlockType } from "../types/source-block.js";
import { parseMarkdownTable } from "../utils/table-cells.js";

function guessBlockType(level: number, text: string): BlockType {
  const t = text.trim();
  if (level > 0) return "heading";
  if (t.startsWith("|")) return "table";
  if (t.startsWith("```")) return "code";
  if (t.startsWith("- ") || t.startsWith("* ") || t.match(/^\d+\.\s/)) return "list";
  return "paragraph";
}

function makeBlock(
  id: string,
  level: number,
  blockType: BlockType,
  text: string,
  separatorBefore: string,
): SeparatedBlock {
  if (blockType === "table") {
    const cells = parseMarkdownTable(text);
    return {
      block: { id, type: "table", level, text, headerRows: cells.headerRows, rows: cells.rows },
      separatorBefore,
    };
  }
  const textType: Exclude<BlockType, "table" | "image"> =
    blockType === "image" ? "other" : blockType;
  return { block: { id, type: textType, level, text }, separatorBefore };
}

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
            ...makeBlock(`sb_${currentLevel}_${blockIndex++}`, currentLevel, guessBlockType(currentLevel, currentText), currentText, separatorBefore),
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
          ...makeBlock(`sb_${currentLevel}_${blockIndex++}`, currentLevel, guessBlockType(currentLevel, currentText), currentText, separatorBefore),
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
            ...makeBlock(`sb_${currentLevel}_${blockIndex++}`, currentLevel, guessBlockType(currentLevel, currentText), currentText, separatorBefore),
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
        ...makeBlock(`sb_${currentLevel}_${blockIndex++}`, currentLevel, guessBlockType(currentLevel, currentText), currentText, separatorBefore),
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
      ...makeBlock(`sb_${currentLevel}_${blockIndex++}`, currentLevel, guessBlockType(currentLevel, currentText), currentText, separatorBefore),
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
