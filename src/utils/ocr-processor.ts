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
output_dir = args.get("output_dir", "")

from transformers import AutoModel, AutoTokenizer

tok = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
model = AutoModel.from_pretrained(model_path, trust_remote_code=True,
    use_safetensors=True, dtype=torch.bfloat16).eval().cuda()

# Convert PDF to images
doc = fitz.open(pdf_path)
tmp_dir = tempfile.mkdtemp(prefix="ptl_ocr_")
mat = fitz.Matrix(300 / 72, 300 / 72)
images = []
for i in range(len(doc)):
    out = os.path.join(tmp_dir, f"p{i:04d}.png")
    doc[i].get_pixmap(matrix=mat).save(out)
    images.append(out)
    # Extract embedded images from this page
    if output_dir:
        for img_index, xref in enumerate(doc.get_page_images(i)):
            xref_id = xref[0]
            pix = fitz.Pixmap(doc, xref_id)
            if pix.n > 4:
                pix = fitz.Pixmap(fitz.csRGB, pix)
            img_name = f"page_{i+1:04d}_img_{img_index}.png"
            pix.save(os.path.join(output_dir, img_name))
            pix = None
doc.close()

# Sequential inference (CUDA + sys.stdout not thread-safe for parallelism)
os.makedirs("/tmp/ptl_ocr_out", exist_ok=True)
old_stdout = sys.stdout
sys.stdout = buf = io.StringIO()
for img in images:
    model.infer(tok, prompt="<image>document parsing.",
        image_file=img, output_path="/tmp/ptl_ocr_out",
        base_size=1024, image_size=1024, crop_mode=False,
        max_length=32768, no_repeat_ngram_size=35, ngram_window=128)
    print("<PAGE_BREAK>", flush=True)
sys.stdout = old_stdout
raw = buf.getvalue()

# Strip det tags (keep text between them)
clean = re.sub(r"<\\|det\\|>[^<]+<\\|/det\\|>", "", raw)
clean = re.sub(r"\\n{3,}", "\\n\\n", clean).strip()

# Detect and wrap headings in HTML tags
def wrap_headings(text):
    lines = text.split("\\n")
    out = []
    for line in lines:
        s = line.strip()
        if s.startswith("<") and not s.startswith("<PAGE_BREAK>"):
            out.append(line)
            continue
        if s == "<PAGE_BREAK>":
            out.append('<hr class="page-break"/>')
            continue
        if len(s) < 5 or "...." in s:
            out.append(line)
            continue
        m = re.match(r"^(\\d+)\\.\\s+(.+)$", s)
        if m:
            out.append(f"<h2>{m.group(1)}. {m.group(2)}</h2>")
            continue
        m = re.match(r"^([IVXLCDM]+)\\.\\s+(.+)$", s)
        if m:
            out.append(f"<h3>{m.group(1)}. {m.group(2)}</h3>")
            continue
        m = re.match(r"^([ivxlcdm]+)\\.\\s+(.+)$", s)
        if m:
            out.append(f"<h4>{m.group(1)}. {m.group(2)}</h4>")
            continue
        out.append(line)
    return "\\n".join(out)

clean = wrap_headings(clean)

# Remove img tags referencing files that don't exist in output_dir
if output_dir:
    def keep_img(m):
        src = m.group(1)
        if src.startswith("http"):
            return m.group(0)
        fpath = os.path.join(output_dir, src)
        if os.path.exists(fpath):
            return m.group(0)
        return f"<!-- image not extracted: {src} -->"
    clean = re.sub(r'<img\s+[^>]*src="([^"]+)"[^>]*>', keep_img, clean)

html = "<!DOCTYPE html>\\n<html><head><style>table{border-collapse:collapse;width:100%}td,th{border:1px solid #888;padding:6px;text-align:left}th{background:#f0f0f0}h2,h3,h4{margin-top:1.5em}img{max-width:100%}hr.page-break{border:none;border-top:2px dashed #ccc;margin:2em 0}</style></head><body>\\n" + clean + "\\n</body></html>"
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

    const outputDir = outputPath ? dirname(outputPath) : "";
    const wslOutputDir = outputDir
      ? outputDir.replace(/^([A-Za-z]):\\/, (_m: string, d: string) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, "/")
      : "";
    const argsJson = JSON.stringify({ pdf_path: wslInputPath, output_dir: wslOutputDir });

    const result = await execa(
      "wsl",
      [WSL_PYTHON, scriptPath, OCR_MODEL_PATH, argsJson],
      {
        timeout: 1_200_000,  // 20 min for 33 pages
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
