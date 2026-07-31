import type { SourceBlock, SourceBlockType as BlockType } from "./document-ir.js";

export type { SourceBlock, SourceBlockType as BlockType } from "./document-ir.js";

export interface SeparatedBlock {
  block: SourceBlock;
  separatorBefore: string;
}

export interface TranslationUnit {
  sourceBlock: SourceBlock;
  translated: string;
  subagentId: string;
}
