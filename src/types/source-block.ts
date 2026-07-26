export type BlockType = "heading" | "paragraph" | "table" | "code" | "list" | "other";

export interface SourceBlock {
  id: string;
  level: number;
  blockType: BlockType;
  text: string;
  /** When set, this block is a fragment split from a single DOM element.
   *  Consecutive blocks with the same mergeKey will be re-joined on assembly. */
  mergeKey?: string;
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
