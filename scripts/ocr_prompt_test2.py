import torch, os, sys, io, re
from transformers import AutoModel, AutoTokenizer

os.environ["TOKENIZERS_PARALLELISM"] = "false"
model_path = "/root/models/Unlimited-OCR/models/PaddlePaddle--Unlimited-OCR/snapshots/master"

tok = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
model = AutoModel.from_pretrained(model_path, trust_remote_code=True,
    use_safetensors=True, dtype=torch.bfloat16).eval().cuda()

tests = [
    # Baseline
    ("document parsing", "<image>document parsing."),
    # Styled HTML
    ("styled HTML", "<image>\nReconstruct this page as styled HTML. Include font sizes with px units, table border colors, and cell background colors."),
    # Formatting emphasis
    ("formatting", "<image>OCR with formatting. Produce HTML tables with col widths and row heights. Use bgcolor on cells where detected."),
    # visual layout
    ("visual layout", "<image>Extract text, tables, and images with font sizes and visual styles."),
    # detailed extraction
    ("detailed", "<image>Parse this document page. Include font size, font weight, text color, and background color in the output."),
    # HTML focus
    ("html focus", "<image>Convert to HTML with preserved formatting: include style attributes on table cells with background colors, borders, and text alignment."),
]

for name, prompt in tests:
    print(f"\n{'='*60}", flush=True)
    print(f"=== Prompt: {name} ===", flush=True)
    print(f"=== Text: {prompt[:80]} ===", flush=True)
    old = sys.stdout
    sys.stdout = buf = io.StringIO()
    model.infer(tok, prompt=prompt,
        image_file="/tmp/ocr_test_pages/page_1.png",
        output_path="/tmp/ocr_output",
        base_size=1024, image_size=1024, crop_mode=False,
        max_length=8192, no_repeat_ngram_size=35, ngram_window=128)
    sys.stdout = old
    text = buf.getvalue()
    has_det = "<|det|>" in text
    has_table = "<table>" in text
    has_style = "style=" in text or "font-size" in text or "color" in text or "bgcolor" in text
    has_font = "font" in text.lower()
    print(f"Length: {len(text)} | det: {has_det} | table: {has_table} | style: {has_style} | font: {has_font}", flush=True)
    # Print raw first 2000 chars
    print("[RAW OUTPUT START]", flush=True)
    print(text[:2000], flush=True)
    print("[RAW OUTPUT END]", flush=True)
