import torch, os, sys, io, re
from transformers import AutoModel, AutoTokenizer

os.environ["TOKENIZERS_PARALLELISM"] = "false"
model_path = "/root/models/Unlimited-OCR/models/PaddlePaddle--Unlimited-OCR/snapshots/master"

tok = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
model = AutoModel.from_pretrained(model_path, trust_remote_code=True,
    use_safetensors=True, dtype=torch.bfloat16).eval().cuda()

tests = [
    ("Free OCR", "<image>\nFree OCR."),
    ("document parsing", "<image>document parsing."),
    ("markdown", "<image>\nConvert the document to markdown."),
]

for name, prompt in tests:
    print(f"\n=== Prompt: {name} ===", flush=True)
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
    print(f"Length: {len(text)} | det: {has_det} | table: {has_table}", flush=True)
    clean = re.sub(r"<\|det\|>[^<]+<\|/det\|>", "", text).strip()
    print(clean[:2000], flush=True)
