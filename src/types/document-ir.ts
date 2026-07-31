/** Geometry in display pixels (page coordinate space). */
export interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Visual styling hints carried from the source document. */
export interface FontStyle {
  family?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

export type SourceBlockType =
  | "heading"
  | "paragraph"
  | "table"
  | "image"
  | "list"
  | "toc"
  | "code"
  | "other";

/** An image embedded inside a table cell (position relative to table bbox). */
export interface CellImageRef {
  src: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface BaseSourceBlock {
  id: string;
  type: SourceBlockType;
  /** Heading level (2/3 for semantic HTML headings, 0 otherwise). */
  level: number;
  /** Plain text (translation input / display). Empty for table/image blocks. */
  text: string;
  geometry?: Geometry;
  font?: FontStyle;
  /** Source-native block type (e.g. OCR det type) kept as render metadata. */
  sourceType?: string;
  /** Original whitespace before this block when imported from HTML. */
  separatorBefore?: string;
}

export interface TableSourceBlock extends BaseSourceBlock {
  type: "table";
  headerRows: string[][];
  rows: string[][];
  colWidths?: number[];
  rowHeights?: number[];
  cellImages?: CellImageRef[];
}

export interface ImageSourceBlock extends BaseSourceBlock {
  type: "image";
  src: string;
  alt: string;
}

export type TextSourceBlock = BaseSourceBlock & {
  type: Exclude<SourceBlockType, "table" | "image">;
};

export type SourceBlock = TableSourceBlock | ImageSourceBlock | TextSourceBlock;

export interface Page {
  width: number;
  height: number;
  blocks: SourceBlock[];
}

export interface DocumentIR {
  pages: Page[];
}

export function isTableBlock(block: SourceBlock): block is TableSourceBlock {
  return block.type === "table";
}

export function isImageBlock(block: SourceBlock): block is ImageSourceBlock {
  return block.type === "image";
}

export function hasGeometry(ir: DocumentIR): boolean {
  return ir.pages.some((page) => page.blocks.some((b) => b.geometry !== undefined));
}
