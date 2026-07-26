#!/bin/bash
# Run from WSL: wsl bash scripts/run-ocr-test.sh
set -e

MODEL_PATH="/root/models/Unlimited-OCR/models/PaddlePaddle--Unlimited-OCR/snapshots/master"
PDF_PATH="/mnt/c/Users/daemo/workplace/pdf-translator/test/test1.pdf"
OUTPUT_DIR="/mnt/c/Users/daemo/workplace/pdf-translator/workdir/ocr_output"
VENV_PATH="/root/ptl-ocr-env"

echo "=== Activate venv ==="
source "$VENV_PATH/bin/activate"

echo "=== Test: Single page (page 1) inference ==="
python3 << 'PYEOF'
import os, torch, tempfile, fitz
from transformers import AutoModel, AutoTokenizer

model_path = "/root/models/Unlimited-OCR/models/PaddlePaddle--Unlimited-OCR/snapshots/master"
pdf_path = "/mnt/c/Users/daemo/workplace/pdf-translator/test/test1.pdf"
output_dir = "/mnt/c/Users/daemo/workplace/pdf-translator/workdir/ocr_output"
os.makedirs(output_dir, exist_ok=True)

# Load model
print("Loading model...")
tok = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
model = AutoModel.from_pretrained(
    model_path, trust_remote_code=True, use_safetensors=True,
    torch_dtype=torch.bfloat16,
).eval().cuda()
print(f"Model loaded. VRAM: {torch.cuda.memory_allocated()/1024**3:.2f} GB")

# Convert page 1 to image
print("Converting PDF page 1...")
doc = fitz.open(pdf_path)
mat = fitz.Mat>
