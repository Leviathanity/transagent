#!/bin/bash
set -e

VENV_DIR="$HOME/ptl-ocr-env"
MODEL_DIR="$HOME/models/Unlimited-OCR"
MODELSCOPE_MODEL="PaddlePaddle/Unlimited-OCR"

echo "=== Step 1: Create venv ==="
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

echo "=== Step 2: Install dependencies ==="
pip install -q modelscope
pip install -q torch torchvision --index-url https://download.pytorch.org/whl/cu124
pip install -q transformers pillow pymupdf einops addict easydict

echo "=== Step 3: Download model from ModelScope ==="
mkdir -p "$MODEL_DIR"
export MODELSCOPE_CACHE="$MODEL_DIR"
python3 -c "
from modelscope import snapshot_download
snapshot_download('$MODELSCOPE_MODEL', cache_dir='$MODEL_DIR')
print('Download complete')
"

echo "=== Step 4: Verify ==="
ls -lh "$MODEL_DIR/PaddlePaddle/Unlimited-OCR/" | head -20
echo ""
echo "=== Deployment ready ==="
echo "Activate: source $VENV_DIR/bin/activate"
echo "Model at: $MODEL_DIR/PaddlePaddle/Unlimited-OCR/"
