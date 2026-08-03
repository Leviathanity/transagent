import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface PtlConfig {
  ocr: {
    python: string;
    modelPath: string;
    outputDir: string;
    baseSize: number;
    imageSize: number;
    cropMode: boolean;
    maxLength: number;
    noRepeatNgramSize: number;
    ngramWindow: number;
    dedupThreshold: number;
    fontOverlapRatio: number;
    imageOverlapRatio: number;
    vectorGapMin: number;
    vectorGapMaxRatio: number;
    tableOverlapRatio: number;
    tableNearPx: number;
    nonWhiteValue: number;
    nonWhiteRatio: number;
  };
  page: { width: number; dpi: number; modelSize: number };
  paths: { workDir: string; reviewSpec: string; beautifySpec: string };
  models: { translate: string; review: string; beautify: string };
  beautify: { nearRightPx: number; rightAdjustPx: number; rightAdjustMinLeft: number };
  toc: { shortLineMax: number };
  lint: { minOverlapY: number };
  extraction: {
    /** Max dimension (display px) for a repeated image to be treated as an icon. */
    iconSizePx: number;
    iconRepeatMin: number;
    decorAspectRatio: number;
    decorMinDim: number;
    decorRightEdgeRatio: number;
    decorMinLen: number;
    decorMaxMinDim: number;
    vectorMinArea: number;
    vectorNonWhiteValue: number;
    vectorNonWhiteRatio: number;
    tableImageOverlapRatio: number;
    gridLineMinLenPt: number;
    gridTolPt: number;
    gridTableOverlapRatio: number;
  };
}

export const DEFAULT_CONFIG: PtlConfig = {
  ocr: {
    python: "/root/ptl-ocr-env/bin/python3",
    modelPath:
      "/root/models/Unlimited-OCR/models/PaddlePaddle--Unlimited-OCR/snapshots/master",
    outputDir: "",
    baseSize: 1024,
    imageSize: 1024,
    cropMode: false,
    maxLength: 32768,
    noRepeatNgramSize: 35,
    ngramWindow: 128,
    dedupThreshold: 15,
    fontOverlapRatio: 0.25,
    imageOverlapRatio: 0.3,
    vectorGapMin: 120,
    vectorGapMaxRatio: 0.7,
    tableOverlapRatio: 0.3,
    tableNearPx: 200,
    nonWhiteValue: 235,
    nonWhiteRatio: 0.03,
  },
  page: { width: 1024, dpi: 300, modelSize: 1024 },
  paths: {
    workDir: "workdir",
    reviewSpec: "specs/review-layout.md",
    beautifySpec: "specs/beautify-layout.md",
  },
  models: {
    translate: "deepseek/deepseek-v4-flash",
    review: "deepseek/deepseek-v4-flash",
    beautify: "deepseek/deepseek-v4-flash",
  },
  beautify: { nearRightPx: 150, rightAdjustPx: 16, rightAdjustMinLeft: 100 },
  toc: { shortLineMax: 60 },
  lint: { minOverlapY: 5 },
  extraction: {
    iconSizePx: 40,
    iconRepeatMin: 3,
    decorAspectRatio: 5,
    decorMinDim: 24,
    decorRightEdgeRatio: 0.75,
    decorMinLen: 128,
    decorMaxMinDim: 64,
    vectorMinArea: 5000,
    vectorNonWhiteValue: 235,
    vectorNonWhiteRatio: 0.03,
    tableImageOverlapRatio: 0.5,
    gridLineMinLenPt: 15,
    gridTolPt: 2.0,
    gridTableOverlapRatio: 0.3,
  },
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, override: DeepPartial<T>): T {
  if (isPlainObject(base) && isPlainObject(override)) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const key of Object.keys(override)) {
      const ov = (override as Record<string, unknown>)[key];
      out[key] =
        isPlainObject(out[key]) && isPlainObject(ov)
          ? deepMerge(
              out[key] as Record<string, unknown>,
              ov as Record<string, unknown>,
            )
          : ov;
    }
    return out as T;
  }
  return override as T;
}

function loadFileConfig(): DeepPartial<PtlConfig> {
  const filePath =
    process.env.PTL_CONFIG ?? resolve(process.cwd(), "ptl.config.json");
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as DeepPartial<PtlConfig>;
  } catch (err) {
    console.warn(`[ptl] 忽略无效配置文件 ${filePath}: ${String(err)}`);
    return {};
  }
}

function loadEnvConfig(): DeepPartial<PtlConfig> {
  const cfg: DeepPartial<PtlConfig> = {};
  const env = process.env;
  if (env.PTL_OCR_PYTHON) cfg.ocr = { ...cfg.ocr, python: env.PTL_OCR_PYTHON };
  if (env.PTL_OCR_MODEL_PATH) cfg.ocr = { ...cfg.ocr, modelPath: env.PTL_OCR_MODEL_PATH };
  if (env.PTL_OCR_OUTPUT_DIR) cfg.ocr = { ...cfg.ocr, outputDir: env.PTL_OCR_OUTPUT_DIR };
  if (env.PTL_PAGE_WIDTH) cfg.page = { ...cfg.page, width: parseInt(env.PTL_PAGE_WIDTH, 10) };
  if (env.PTL_PAGE_DPI) cfg.page = { ...cfg.page, dpi: parseInt(env.PTL_PAGE_DPI, 10) };
  if (env.PTL_MODEL_SIZE) cfg.page = { ...cfg.page, modelSize: parseInt(env.PTL_MODEL_SIZE, 10) };
  if (env.PTL_WORK_DIR) cfg.paths = { ...cfg.paths, workDir: env.PTL_WORK_DIR };
  if (env.PTL_REVIEW_SPEC) cfg.paths = { ...cfg.paths, reviewSpec: env.PTL_REVIEW_SPEC };
  if (env.PTL_BEAUTIFY_SPEC) cfg.paths = { ...cfg.paths, beautifySpec: env.PTL_BEAUTIFY_SPEC };
  if (env.PTL_TRANSLATE_MODEL) cfg.models = { ...cfg.models, translate: env.PTL_TRANSLATE_MODEL };
  if (env.PTL_REVIEW_MODEL) cfg.models = { ...cfg.models, review: env.PTL_REVIEW_MODEL };
  if (env.PTL_BEAUTIFY_MODEL) cfg.models = { ...cfg.models, beautify: env.PTL_BEAUTIFY_MODEL };
  if (env.PTL_ICON_SIZE_PX)
    cfg.extraction = { ...cfg.extraction, iconSizePx: parseInt(env.PTL_ICON_SIZE_PX, 10) };
  return cfg;
}

let cached: PtlConfig | undefined;

/**
 * Load pipeline config: CLI overrides > environment > ptl.config.json
 * (PTL_CONFIG env or cwd) > built-in defaults. Result is cached per process.
 */
export function loadConfig(overrides: DeepPartial<PtlConfig> = {}): PtlConfig {
  if (!cached || Object.keys(overrides).length > 0) {
    const merged = deepMerge(
      deepMerge(deepMerge(DEFAULT_CONFIG, loadFileConfig()), loadEnvConfig()),
      overrides,
    );
    if (Object.keys(overrides).length === 0) cached = merged;
    return merged;
  }
  return cached;
}

/** Test helper: drop the process-level config cache. */
export function resetConfigCache(): void {
  cached = undefined;
}
