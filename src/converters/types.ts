import type { DocumentIR } from "../types/document-ir.js";

export interface ConvertOptions {
  maxPages?: number;
  /** Directory where extracted/cropped assets (images) are written. */
  outputDir?: string;
}

/** A converter turns an input document (e.g. PDF) into a Document IR. */
export interface Converter {
  readonly name: string;
  convert(inputPath: string, options?: ConvertOptions): Promise<DocumentIR>;
}
