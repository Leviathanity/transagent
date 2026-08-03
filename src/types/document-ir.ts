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
  /** Cell position inside the code-path table grid (0-based), when known. */
  row?: number;
  col?: number;
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
  /**
   * Offset of the OCR semantic table content inside the table geometry
   * (display px). Set when the geometry comes from the code-path vector grid
   * and the OCR text sits at a sub-region of that grid.
   */
  contentOffset?: { left: number; top: number };
}

export interface ImageSourceBlock extends BaseSourceBlock {
  type: "image";
  src: string;
  alt: string;
  /** Resource identity from the source PDF (xref / content hash). */
  identity?: { xref?: number; hash?: string; sourceName?: string };
  /** Image role: content / icon / decor / vector. */
  kind?: "content" | "icon" | "decor" | "vector";
  /** All placements of this resource across the document (page + display coords). */
  placements?: { page: number; x: number; y: number; width: number; height: number }[];
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
