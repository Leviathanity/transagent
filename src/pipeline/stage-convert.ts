import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { UnlimitedOCRConverter } from "../converters/unlimited-ocr.js";
import { renderPixelPerfectHtml } from "../renderers/pixel-perfect.js";
import { renderSemanticHtml } from "../renderers/semantic.js";
import { serializeDocument } from "../utils/ir-serialization.js";
import { inlineDocumentImages } from "../utils/inline-images.js";
import { hasGeometry, type DocumentIR } from "../types/document-ir.js";
import type { StageResult } from "../types/pipeline.js";

async function convertPdf(
  inputPath: string,
  outputDir: string,
  maxPages?: number,
): Promise<DocumentIR> {
  const converter = new UnlimitedOCRConverter();
  return converter.convert(inputPath, { maxPages, outputDir });
}

export async function stageConvert(
  inputPath: string,
  outputPath?: string,
  maxPages?: number,
): Promise<StageResult> {
  try {
    const ir = await convertPdf(
      inputPath,
      outputPath ? dirname(resolve(outputPath)) : "",
      maxPages,
    );
    const embedded = await inlineDocumentImages(
      ir,
      outputPath ? dirname(resolve(outputPath)) : undefined,
    );
    const html = hasGeometry(embedded) ? renderPixelPerfectHtml(embedded) : renderSemanticHtml(embedded);
    if (outputPath) {
      await mkdir(dirname(resolve(outputPath)), { recursive: true });
      await writeFile(outputPath, html, "utf-8");
      return { stage: "convert", success: true, outputPath };
    }
    return { stage: "convert", success: true, output: html };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { stage: "convert", success: false, error: `OCR failed: ${message}` };
  }
}

export async function stageConvertToIr(
  inputPath: string,
  irPath: string,
  maxPages?: number,
): Promise<StageResult> {
  try {
    const ir = await convertPdf(inputPath, dirname(resolve(irPath)), maxPages);
    await mkdir(dirname(resolve(irPath)), { recursive: true });
    await writeFile(irPath, serializeDocument(ir), "utf-8");
    return { stage: "convert", success: true, outputPath: irPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { stage: "convert", success: false, error: `OCR failed: ${message}` };
  }
}
