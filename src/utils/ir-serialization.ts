import type { DocumentIR } from "../types/document-ir.js";

export function serializeDocument(ir: DocumentIR): string {
  return JSON.stringify(ir, null, 2);
}

export function parseDocument(json: string): DocumentIR {
  const parsed = JSON.parse(json) as Partial<DocumentIR>;
  if (!Array.isArray(parsed.pages)) {
    throw new Error("Invalid Document IR: missing pages");
  }
  return parsed as DocumentIR;
}
