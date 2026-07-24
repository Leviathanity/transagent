import { execa } from "execa";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { StageResult } from "../types/pipeline.js";

const WSL_PYTHON = "/root/ptl-ocr-env/bin/python3";
const OCR_MODEL_PATH =
  "/root/models/Unlimited-OCR/models/PaddlePaddle--Unlimited-OCR/snapshots/master";

/** WSL-accessible path to the Python script (relative to project root) */
function wslScriptPath(): string {
  // From WSL, C:\Users\... becomes /mnt/c/Users/...
  const abs = resolve("tmp_ocr.py");
  return abs
    .replace(/^([A-Za-z]):\\/, (_m, d: string) => `/mnt/${d.toLowerCase()}/`)
    .replace(/\\/g, "/");
}

const PYTHON_SCRIPT = `
import torch, os, sys, io, re, json, fitz, tempfile

os.environ["TOKENIZERS_PARALLELISM"] = "false"
model_path = sys.argv[1]
args = json.loads(sys.argv[2])
pdf_path = args["pdf_path"]

from transformers import AutoModel, AutoTokenizer

tok = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
model = AutoModel.from_pretrained(model_path, trust_remote_code=True,
    use_safetensors=True, dtype=torch.bfloat16).eval().cuda()

# Convert PDF to images
doc = fitz.open(pdf_path)
tmp_dir = tempfile.mkdtemp(prefix="ptl_ocr_")
mat = fitz.Matrix(300 / 72, 300 / 72)
max_pages = min(3, len(doc))
images = []
for i in range(max_pages):
    out = os.path.join(tmp_dir, f"p{i:04d}.png")
    doc[i].get_pixmap(matrix=mat).save(out)
    images.append(out)
doc.close()

# Run inference, capture stdout
old = sys.stdout
sys.stdout = buf = io.StringIO()

os.makedirs("/tmp/ptl_ocr_out", exist_ok=True)
for img in images:
    model.infer(tok, prompt="<image>document parsing.",
        image_file=img,
        output_path="/tmp/ptl_ocr_out",
        base_size=1024, image_size=1024, crop_mode=False,
        max_length=32768, no_repeat_ngram_size=35, ngram_window=128)
    print("<PAGE_BREAK>", flush=True)

sys.stdout = old
raw = buf.getvalue()

# Strip det tags (keep text between them)
clean = re.sub(r"<\\|det\\|>[^<]+<\\|/det\\|>", "", raw)
clean = re.sub(r"\\n{3,}", "\\n\\n", clean).strip()
html = "<!DOCTYPE html>\\n<html><body>\\n" + clean + "\\n</body></html>"
print(html)

import shutil
shutil.rmtree(tmp_dir, ignore_errors=True)
`.trim();

export async function stageConvertWithOcr(
  inputPath: string,
  outputPath?: string,
): Promise<StageResult> {
  try {
    const absInput = resolve(inputPath);
    const wslInputPath = absInput
      .replace(/^([A-Za-z]):\\/, (_m: string, d: string) => `/mnt/${d.toLowerCase()}/`)
      .replace(/\\/g, "/");
    const scriptPath = wslScriptPath();

    // Write inference script to project root (accessible from WSL as /mnt/c/...)
    await writeFile("tmp_ocr.py", PYTHON_SCRIPT, "utf-8");

    const argsJson = JSON.stringify({ pdf_path: wslInputPath });

    const result = await execa(
      "wsl",
      [WSL_PYTHON, scriptPath, OCR_MODEL_PATH, argsJson],
      {
        timeout: 600_000,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    if (result.exitCode !== 0) {
      return {
        stage: "convert",
        success: false,
        error: result.stderr || `OCR exited with code ${result.exitCode}`,
      };
    }

    if (outputPath) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, result.stdout, "utf-8");
      return { stage: "convert", success: true, outputPath };
    }

    return { stage: "convert", success: true, output: result.stdout };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { stage: "convert", success: false, error: `OCR failed: ${message}` };
  }
}
