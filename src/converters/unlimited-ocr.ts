import { execa } from "execa";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
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
}

export interface OcrPagePayload {
  width: number;
  height: number;
  blocks: OcrBlockPayload[];
}

export interface OcrPayload {
  pages: OcrPagePayload[];
}

function isRunningInWsl(): boolean {
  try {
    return existsSync("/proc/sys/fs/binfmt_misc/WSLInterop");
  } catch {
    return false;
  }
}

function toWslPath(winPath: string): string {
  return winPath
    .replace(/^([A-Za-z]):\\/, (_m, d: string) => `/mnt/${d.toLowerCase()}/`)
    .replace(/\\/g, "/");
}

function envStr(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

const OCR_PYTHON = envStr("PTL_OCR_PYTHON", "/root/ptl-ocr-env/bin/python3");
const OCR_MODEL_PATH = envStr(
  "PTL_OCR_MODEL_PATH",
  "/root/models/Unlimited-OCR/models/PaddlePaddle--Unlimited-OCR/snapshots/master",
);

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
          };
        }
        if (type === "image") {
          return { ...base, type, src: raw.src ?? "", alt: raw.alt ?? "" };
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
    const outputDir = options?.outputDir ?? "";

    const args = {
      pdf_path: insideWsl ? absInput : toWslPath(absInput),
      output_dir: insideWsl ? outputDir : toWslPath(outputDir),
      ...(options?.maxPages !== undefined ? { max_pages: options.maxPages } : {}),
    };

    const python = insideWsl ? OCR_PYTHON : "wsl";
    const pythonArgs = insideWsl
      ? [scriptPath, OCR_MODEL_PATH, JSON.stringify(args)]
      : [OCR_PYTHON, scriptPath, OCR_MODEL_PATH, JSON.stringify(args)];

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
