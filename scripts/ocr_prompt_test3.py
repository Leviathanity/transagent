import torch, os, sys, io, re
from transformers import AutoModel, AutoTokenizer

os.environ["TOKENIZERS_PARALLELISM"] = "false"
model_path = "/root/models/Unlimited-OCR/models/PaddlePaddle--Unlimited-OCR/snapshots/master"

tok = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
model = AutoModel.from_pretrained(model_path, trust_remote_code=True,
    use_safetensors=True, dtype=torch.bfloat16).eval().cuda()

tests = [
    # Current baseline
    ("baseline", "<image>document parsing."),
    # DeepSeek-OCR grounding + markdown
    ("grounding markdown", "<image>\n<|grounding|>Convert the document to markdown."),
    # Grounding + OCR
    ("grounding ocr", "<image>\n<|grounding|>Free OCR."),
    # Grounding + HTML
    ("grounding html", "<image>\n<|grounding|>Convert the document to HTML."),
    # Free OCR without grounding
    ("free ocr", "<image>\nFree OCR."),
    # DeepSeek-OCR2 default
    ("ocr2 default", "<image>\n<|grounding|>OCR this image."),
]

for name, prompt in tests:
    print(f"\n{'='*60}", flush=True)
    print(f"=== Prompt: {name} ===", flush=True)
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
    has_grounding = "<|grounding|>" in text
    has_style = "style=" in text or "font-size" in text
    has_markdown = bool(re.search(r'^#{1,6}\s', text, re.M))
    print(f"Length: {len(text)} | det: {has_det} | table: {has_table} | grounding: {has_grounding} | style: {has_style} | md: {has_markdown}", flush=True)
    print("[RAW]", flush=True)
    print(text[:2500], flush=True)
    print("[END]", flush=True)
