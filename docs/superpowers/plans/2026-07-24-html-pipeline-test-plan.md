# pdf-translator HTML Pipeline Test Plan

> **Objective:** Verify the Unlimited-OCR-based HTML pipeline produces correct output using `test/test1.pdf` (33-page automotive quality handbook).

## Unit Tests (No API Key Required)

| # | Test | Scope | Verification |
|---|------|-------|-------------|
| UT1 | HTML Splitter | `src/splitter/html-block-splitter.test.ts` | `bun test src/splitter/html-block-splitter.test.ts` — 6 tests |
| UT2 | Async Pool | `src/utils/async-pool.test.ts` | `bun test src/utils/async-pool.test.ts` — 5 tests |
| UT3 | Direction Detector | `src/utils/direction-detector.test.ts` | `bun test src/utils/direction-detector.test.ts` — 3 tests |
| UT4 | Glossary Matcher | `src/glossary/matcher.test.ts` | `bun test src/glossary/matcher.test.ts` — 3 tests |
| UT5 | Stage Convert Export | `src/pipeline/stage-convert.test.ts` | `bun test src/pipeline/stage-convert.test.ts` — 1 test |
| UT6 | Full Suite | All unit tests | `bun test` — 19 tests, all pass |

## Integration Tests (GPU + WSL Required)

| # | Test | CLI Command | Expected Output | Verification |
|---|------|-------------|-----------------|-------------|
| T1 | Help & Usage | `ptl` | All 6 subcommands listed (convert, review, translate-blocks, interact, translate, check) | Check stdout |
| T2 | Environment Check | `ptl check` | Bun/Node/Python/API Key/workdir status | Check stdout |
| T3 | Stage 1: Convert to File | `ptl convert test/test1.pdf --output test/T3_output.html` | HTML file with `<table>` tags, no `<\|det\|>` tags, heading detection active | File exists, contains `<html><body>`, contains `<h2>`, has `<PAGE_BREAK>` converted to `<hr>` |
| T4 | Stage 1: Print mode | `ptl convert test/test1.pdf` | HTML content to stdout | Non-empty stdout, begins with `<!DOCTYPE html>` |
| T5 | Stage 1: Heading Detection | Inspect output of T3 | Numbered headings wrapped in `<h2>`, roman numeral in `<h3>`, `<PAGE_BREAK>` → `<hr>` | grep `<h2>` count >= 5 |
| T6 | Stage 1: Table Integrity | Inspect output of T3 | HTML `<table>` with `rowspan`, correct column alignment | Check `<table>` count >= 3, check `<td>` vs `<th>` ratio |
| T7 | Stage 1: No Encoding Corruption | Inspect output of T3 | Em-dashes, smart quotes preserved, no `�C`/`��` | grep -c "�" returns 0 |
| T8 | Stage 1: No Det Tags | Inspect output of T3 | All `<\|det\|>` tags stripped | grep -c "<|det|>" returns 0 |
| T9 | Review Spec Check | Check `specs/review-conversion.md` | 8 review categories, all HTML-specific items | Parse categories, verify count >= 8 |
| T10 | Format Spec Check | Check `specs/review-formatting.md` | 11 review categories | Parse categories, verify count >= 8 |
| T11 | Stage 2: Review (Grill only) | `ptl review test/T3_output.html --spec specs/review-conversion.md --output test/T11_reviewed.html --report test/T11_report.md` | Reviewed HTML + report file | Report contains issues, output file exists |
| T12 | Stage 3: Translate (dry) | `ptl translate-blocks test/T11_reviewed.html --direction en2zh --output test/T12_translated.html` | Translated HTML with preserved tags | File exists, contains `<table>`, `<h2>` preserved |
| T13 | Stage 3: Concurrency | Same as T12 with `--concurrency 5` | Same output, faster execution | File identical to T12 |
| T14 | Stage 5: Interact | `ptl interact test/T12_translated.html --output test/T14_final.html` | User confirm flow, final output | Output file exists |
| T15 | Full Pipeline (skip interact) | `ptl translate test/test1.pdf --skip-interact --direction en2zh` | All 5 stages run, all workdir intermediate files created | Check `workdir/01_original.html` through `workdir/04_formatted.html` exist |
| T16 | Full Pipeline (interactive) | `ptl translate test/test1.pdf --direction en2zh` | Direction detected, user confirm, all stages run | Final output exists |
| T17 | Full Pipeline with Glossary | `ptl translate test/test1.pdf --glossary <path> --skip-interact` | Glossary terms translated consistently | Check output for glossary term usage |
| T18 | Pipeline: direction auto-detect | `ptl translate test/test1.pdf --skip-interact` | Direction detected based on CJK ratio | Console shows direction |

## Execution Order

```
UT1 → UT6 (unit tests, no API key)

T1 → T2 (CLI tests, no GPU)
T3 → T8 (Stage 1: Unlimited-OCR, GPU + WSL required)
T9 → T10 (spec validation)
T11 (Stage 2: Review, API key required)
T12 → T13 (Stage 3: Translate, API key required, concurrency tested)
T14 (Stage 5: Interact)
T15 → T18 (Full pipeline, all dependencies)
```

## Pre-requisites

| Dependency | Required For | Check Command |
|-----------|-------------|---------------|
| WSL with GPU | T3-T8, T15-T18 | `wsl nvidia-smi` |
| Unlimited-OCR model | T3-T8, T15-T18 | Model at `/root/models/Unlimited-OCR/` |
| WSL Python venv | T3-T8, T15-T18 | `/root/ptl-ocr-env/bin/python3 --version` |
| DEEPSEEK_API_KEY | T11-T18 | `echo $DEEPSEEK_API_KEY` |

## Current Test Status (as of 2026-07-24)

```
$ bun test
 24 pass
 0 fail
Ran 24 tests across 7 files.

$ bun run typecheck
$ (no errors)
```
