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

/** One mapped text slot inside a grid-driven table cell. */
export interface GridLayoutCellItem {
  /** Index into `[...headerRows, ...rows]` of the semantic table. */
  srcRow: number;
  /** Column index inside that semantic row. */
  srcCol: number;
}

/** A non-empty grid cell: texts mapped from OCR rows + column span. */
export interface GridLayoutCell {
  items: GridLayoutCellItem[];
  /** Number of grid columns this cell covers. */
  colspan: number;
}

/**
 * Code-path grid layout for a table: row/column boundaries in display px and
 * the mapping from semantic OCR rows/cells into grid cells. Rendering with
 * this layout makes the reconstructed table box equal the PDF grid box, so
 * backfilled icons (cellImages row/col) land inside the correct cells.
 */
export interface GridLayout {
  /** Grid row boundaries (display px, length = rows + 1). */
  rows: number[];
  /** Grid column boundaries (display px, length = cols + 1). */
  cols: number[];
  /** rows × cols matrix; null = empty cell. */
  cells: (GridLayoutCell | null)[][];
}

/** OCR→grid mapping diagnostics (extraction only, not rendered). */
export interface GridMappingStats {
  total: number;
  mapped: number;
  unmapped: number;
  coverage: number;
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
  /**
   * Grid-driven layout: PDF grid box + OCR text mapping. Rendering with this
   * layout makes the reconstructed table box equal the PDF grid box, so
   * backfilled icons land inside the correct cells.
   */
  gridLayout?: GridLayout;
  /** OCR→grid mapping coverage diagnostics (unmapped texts are not silent). */
  mappingStats?: GridMappingStats;
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
