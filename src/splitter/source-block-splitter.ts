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
