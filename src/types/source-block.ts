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
