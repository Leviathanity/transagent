# pdf-translator Test Report

> **Date:** 2026-07-29
> **Test file:** `test/test1.pdf` (33-page Ceer Supplier Quality Handbook)
> **Pipeline:** 4 stages: convert → review → translate-blocks → review
> **Runtime:** WSL (Linux x64) + Bun 1.3.14 + Python 3.12.3
> **GPU:** NVIDIA GeForce RTX 4060 Ti (CUDA available)
> **LLM:** DeepSeek V4 Flash
> **OCR:** Unlimited-OCR (PaddlePaddle) bfloat16 on CUDA

---

## Test Results Summary

| # | Test | Status | Details |
|---|------|--------|---------|
| U1 | Unit Tests (6 files) | ✅ PASS | 22 pass, 0 fail, 37 expects, 651ms |
| T1 | Environment Check | ✅ PASS | Bun v1.3.14, Node v24.3.0, workdir writable |
| T2 | Stage 1: Convert | ✅ PASS | 33 pages, 663 elements, 12 tables, 33 images, 210KB HTML |
| T3 | Stage 2: Review (Grill) | ✅ PASS | 202行报告, 145 lint + 2 grill = 147 问题 |
| T4 | Stage 2: Review (Goal) | ❌ TIMEOUT | 147 issues > 10min Goal fix timeout |
| T5 | Stage 3: Translate | ✅ PASS | 722 SourceBlocks, 690 translated, concurrency=3, 198KB |
| T6 | Stage 4: Review (Grill) | ✅ PASS | 37 lint + 6 grill = 43 问题 (翻译修复了大量重叠) |
| T7 | Stage 4: Review (Goal) | ✅ PASS | 26 assistant turns, 全43问题修复, 125 messages total |
| T8 | Stage 5: Interact | ⏭️ SKIPPED | 跳过 (CI mode) |

---

## Stage Details

### Stage 1: PDF → HTML (OCR Conversion)

| Metric | Value |
|--------|-------|
| Input file | test/test1.pdf (33 pages) |
| OCR engine | Unlimited-OCR (PaddlePaddle) |
| Model dtype | bfloat16 on CUDA |
| GPU | NVIDIA GeForce RTX 4060 Ti |
| Output file | workdir/01_original.html |
| File size | 210,562 bytes |
| Lines | 797 |
| Pages detected | 33 |
| position:absolute elements | 663 |
| Tables (det-table) | 12 |
| Images (det-image) | 33 |
| WSL adaptation | ✅ Added native path detection (no `wsl` bridge needed) |

### Stage 2: Conversion Quality Review

| Metric | Value |
|--------|-------|
| Spec file | specs/review-layout.md |
| Lint issues found | 145 (element overlap + page overflow) |
| Grill issues found | 2 |
| Total issues | 147 |
| Report file | workdir/02_review_report.md (202 lines, 28KB) |
| Top issue types | text-text overlap, table overflow, content-header overlap |
| Goal fix phase | ❌ Timeout after 10 minutes (147 issues too many) |

**Key observation:** The pixel-perfect OCR layout inevitably produces element overlaps due to tight bounding boxes. The lint phase alone finds 145 issues before the LLM even reviews.

### Stage 3: Block Translation

| Metric | Value |
|--------|-------|
| Input file | workdir/01_original.html |
| Format | pixel-perfect |
| Total SourceBlocks | 722 |
| Translated blocks | 690 |
| Skipped blocks | 32 (images, page numbers, etc.) |
| TOC groups | 0 |
| Concurrency | 3 |
| Output file | workdir/03_translated.html |
| File size | 198,368 bytes (-5.8% vs original, Chinese text denser) |
| Pages preserved | 33 ✅ |
| position:absolute preserved | 663 ✅ |

**Key observation:** Translation of Chinese→English naturally reduces text volume. Dedup cache was highly effective for repeated elements like headers/footers.

### Stage 4: Formatting Review (Post-Translation)

| Metric | Value |
|--------|-------|
| Spec file | specs/review-layout.md |
| Lint issues found | 37 (大幅减少, 翻译修复了重叠) |
| Grill issues found | 6 |
| Total issues | 43 |
| Report file | workdir/04_format_report.md (50 lines, 7.6KB) |
| Goal fix turns | 26 assistant turns (125 total messages) |
| Fix result | ✅ All 43 issues fixed |
| Table overflow fixes | 9 tables (max-width adjustments) |
| Structural repair | Un-nested position:absolute elements |
| Output file | workdir/04_formatted.html |
| Final size | 195,841 bytes, 796 lines, 33 pages |

**Key observation:** 翻译后重叠从 145 降到了 37（中文文本更紧凑自然减少了重叠）。Goal 修复全部成功。

---

## Pipeline Data Flow

```
test/test1.pdf (33 pages)
  ↓ Stage 1: OCR → Unlimited-OCR + PyMuPDF font matching
01_original.html (210KB, 33 pages, 663 abs elements, 12 tables, 33 images)
  ↓ Stage 2: Grill → 147 issues, Goal → TIMEOUT (skipped)
  ↓ Stage 3: DeepSeek V4 Flash, concurrency=3, 690 blocks
03_translated.html (198KB, 33 pages, 663 abs elements)
  ↓ Stage 4: Grill → 43 issues, Goal → 26 turns, ALL FIXED
04_formatted.html (195KB, 33 pages, 652 abs elements)
```

---

## Environment & Dependency Notes

| Component | Status | Notes |
|-----------|--------|-------|
| Bun (Linux) | ✅ | Installed natively via `bun.sh/install` — Windows npm bun failed vsock |
| pi-natives | ✅ | Reinstalled via `bun install` (optional dep `pi-natives-linux-x64`) |
| Python OCR | ✅ | `/root/ptl-ocr-env/bin/python3` with PyTorch CUDA |
| WSL bridge | 🔧 | Added native path detection — `wsl` binary not needed inside WSL |
| DEEPSEEK_API_KEY | ✅ | Set via environment variable |

---

## vs Previous Test Run (2026-07-23)

| Test | Previous (7/23) | Current (7/29) | Change |
|------|--------|------|--------|
| Unit tests | Not run | 22 pass, 0 fail | 🆕 |
| Stage 1 Convert | 85KB Markdown (MarkItDown) | 210KB pixel-perfect HTML (Unlimited-OCR) | 🆙 Better quality |
| Stage 2 Review Grill | ✅ | ✅ | Same |
| Stage 2 Review Goal | Incomplete | TIMEOUT (147 issues) | ⚠️ More issues from pixel-perfect |
| Stage 3 Translate | Not tested | ✅ 690 blocks | 🆕 End-to-end confirmed |
| Stage 4 Review Grill | Not tested | ✅ 43 issues | 🆕 |
| Stage 4 Review Goal | Not tested | ✅ 26 turns, all fixed | 🆕 |
| Stage 5 Interact | Not tested | Skipped (CI mode) | Same |

---

## Recommendations

1. **Goal fix speed**: 147 issues at ~26 turns suggests ~5-6 issues per turn. Consider increasing OMP concurrency or using a faster model for fix phase.
2. **OCR overlap threshold**: Pixel-perfect OCR produces many false-positive overlaps. Consider increasing overlap tolerance from 5px to 10-15px.
3. **Resume support**: Goal fix phase should checkpoint progress to survive timeouts.
4. **Unit test quality**: Current 22 tests cover core logic but don't test OCR or LLM integration.
