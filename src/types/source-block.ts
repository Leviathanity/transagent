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
