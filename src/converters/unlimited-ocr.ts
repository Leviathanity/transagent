import { execa } from "execa";
import { resolve } from "node:path";
import { loadConfig } from "../utils/config.js";
import { isRunningInWsl } from "../utils/wsl.js";
import type { Converter, ConvertOptions } from "./types.js";
import { parseTableHtml } from "../utils/table-cells.js";
import type {
  CellImageRef,
  DocumentIR,
  FontStyle,
  Geometry,
  SourceBlock,
  SourceBlockType,
} from "../types/document-ir.js";

/** Raw block emitted by scripts/ocr/pdf_to_ir.py (pre-normalization). */
export interface OcrBlockPayload {
  type: string;
  /** Display-space bbox [x1, y1, x2, y2]. */
  bbox: [number, number, number, number];
  text?: string;
  /** Raw table HTML (only for table blocks). */
  html?: string;
  src?: string;
  alt?: string;
  font?: FontStyle;
  table_images?: CellImageRef[];
  content_offset?: { left: number; top: number };
  identity?: { xref?: number; hash?: string; sourceName?: string };
  kind?: "content" | "icon" | "decor" | "vector";
  placements?: { page: number; x: number; y: number; width: number; height: number }[];
}

export interface OcrPagePayload {
  width: number;
  height: number;
  blocks: OcrBlockPayload[];
}

export interface OcrPayload {
  pages: OcrPagePayload[];
}

function toWslPath(winPath: string): string {
  return winPath
    .replace(/^([A-Za-z]):\\/, (_m, d: string) => `/mnt/${d.toLowerCase()}/`)
    .replace(/\\/g, "/");
}

function toGeometry(bbox: [number, number, number, number]): Geometry {
  const [x1, y1, x2, y2] = bbox;
  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1),
  };
}

function mapBlockType(rawType: string): SourceBlockType {
  switch (rawType) {
    case "title":
      return "heading";
    case "header":
    case "footer":
    case "page_number":
      return "other";
    case "table":
      return "table";
    case "image":
      return "image";
    case "paragraph":
    default:
      return "paragraph";
  }
}

/** Normalize the raw OCR payload into a Document IR. */
export function normalizeOcrPayload(payload: OcrPayload): DocumentIR {
  return {
    pages: payload.pages.map((page, pi) => ({
      width: page.width,
      height: page.height,
      blocks: page.blocks.map((raw, bi): SourceBlock => {
        const type = mapBlockType(raw.type);
        const base = {
          id: `sb_${pi}_${bi}`,
          type,
          level: type === "heading" ? 1 : 0,
          text: "",
          geometry: toGeometry(raw.bbox),
          ...(raw.font ? { font: raw.font } : {}),
        };

        if (type === "table") {
          const cells = parseTableHtml(raw.html ?? "");
          return {
            ...base,
            type,
            headerRows: cells.headerRows,
            rows: cells.rows,
            ...(raw.table_images ? { cellImages: raw.table_images } : {}),
            ...(raw.content_offset ? { contentOffset: raw.content_offset } : {}),
          };
        }
        if (type === "image") {
          return {
            ...base,
            type,
            src: raw.src ?? "",
            alt: raw.alt ?? "",
            ...(raw.identity ? { identity: raw.identity } : {}),
            ...(raw.kind ? { kind: raw.kind } : {}),
            ...(raw.placements ? { placements: raw.placements } : {}),
          };
        }
        return { ...base, type, text: raw.text ?? "" };
      }),
    })),
  };
}

/**
 * Unlimited-OCR converter: runs the external Python OCR script and normalizes
 * its JSON payload into a Document IR. All OCR-specific details (det tags,
 * coordinate systems, font matching, model/venv paths) live behind this seam.
 */
export class UnlimitedOCRConverter implements Converter {
  readonly name = "unlimited-ocr";

  async convert(
    inputPath: string,
    options?: ConvertOptions,
  ): Promise<DocumentIR> {
    const absInput = resolve(inputPath);
    const insideWsl = isRunningInWsl();
    const scriptPath = resolve("scripts/ocr/pdf_to_ir.py");
    const cfg = loadConfig();
    const outputDir = options?.outputDir ?? "";

    const args = {
      pdf_path: insideWsl ? absInput : toWslPath(absInput),
      output_dir: insideWsl ? outputDir : toWslPath(outputDir),
      ...(options?.maxPages !== undefined ? { max_pages: options.maxPages } : {}),
      page_width: cfg.page.width,
      dpi: cfg.page.dpi,
      model_size: cfg.page.modelSize,
      ocr_output_dir: cfg.ocr.outputDir,
      base_size: cfg.ocr.baseSize,
      image_size: cfg.ocr.imageSize,
      crop_mode: cfg.ocr.cropMode,
      max_length: cfg.ocr.maxLength,
      no_repeat_ngram_size: cfg.ocr.noRepeatNgramSize,
      ngram_window: cfg.ocr.ngramWindow,
      dedup_threshold: cfg.ocr.dedupThreshold,
      font_overlap_ratio: cfg.ocr.fontOverlapRatio,
      image_overlap_ratio: cfg.ocr.imageOverlapRatio,
      vector_gap_min: cfg.ocr.vectorGapMin,
      vector_gap_max_ratio: cfg.ocr.vectorGapMaxRatio,
      table_overlap_ratio: cfg.ocr.tableOverlapRatio,
      table_near_px: cfg.ocr.tableNearPx,
      non_white_value: cfg.ocr.nonWhiteValue,
      non_white_ratio: cfg.ocr.nonWhiteRatio,
      icon_size_px: cfg.extraction.iconSizePx,
      icon_repeat_min: cfg.extraction.iconRepeatMin,
      grid_line_min_len: cfg.extraction.gridLineMinLenPt,
      grid_tol: cfg.extraction.gridTolPt,
      grid_table_overlap_ratio: cfg.extraction.gridTableOverlapRatio,
      decor_aspect_ratio: cfg.extraction.decorAspectRatio,
      decor_min_dim: cfg.extraction.decorMinDim,
      decor_right_edge_ratio: cfg.extraction.decorRightEdgeRatio,
      decor_min_len: cfg.extraction.decorMinLen,
      decor_max_min_dim: cfg.extraction.decorMaxMinDim,
      vector_min_area: cfg.extraction.vectorMinArea,
      vector_non_white_value: cfg.extraction.vectorNonWhiteValue,
      vector_non_white_ratio: cfg.extraction.vectorNonWhiteRatio,
      table_image_overlap_ratio: cfg.extraction.tableImageOverlapRatio,
    };

    const python = insideWsl ? cfg.ocr.python : "wsl";
    const pythonArgs = insideWsl
      ? [scriptPath, cfg.ocr.modelPath, JSON.stringify(args)]
      : [cfg.ocr.python, scriptPath, cfg.ocr.modelPath, JSON.stringify(args)];

    const result = await execa(python, pythonArgs, {
      timeout: 1_200_000,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `Unlimited-OCR exited with code ${result.exitCode}: ${result.stderr}`,
      );
    }

    let payload: OcrPayload;
    try {
      payload = JSON.parse(result.stdout) as OcrPayload;
    } catch (err) {
      throw new Error(`Unlimited-OCR produced invalid JSON: ${String(err)}`);
    }
    return normalizeOcrPayload(payload);
  }
}
