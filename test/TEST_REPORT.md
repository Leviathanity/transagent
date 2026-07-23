# pdf-translator Test Report

> **Date:** 2026-07-23
> **Test file:** `test/test1.pdf` (33-page Ceer Supplier Quality Handbook)
> **Pipeline:** 5 stages: convert → review → translate-blocks → review → interact

---

## Test Results Summary

| # | Test | Status | Details |
|---|------|--------|---------|
| T1 | Help & Usage | ✅ PASS | All 6 subcommands listed: convert, review, translate-blocks, interact, translate, check |
| T2 | Environment Check | ❌ FAIL | Missing `workdir:` line in output (regression from CLI refactor) |
| T3 | Stage 1: Convert to File | ✅ PASS | 85 KB file, 1290 lines, 189 "Ceer" occurrences |
| T4 | Stage 1: Convert to stdout | ✅ PASS | Non-empty stdout, first line matches PDF content |
| T5 | Review Spec Check | ✅ PASS | 9 sections, 8 with checklist items, valid format |
| T6 | Stage 2: Review (Grill+Goal) | ✅ PASS* | 2 output files: 78 KB reviewed MD + 37 KB report with 33 issues (19 error, 12 warning, 3 info) across all 8 categories |
| T7 | Review Report Content | ✅ PASS | All 8 categories present, 34 total findings |
| T8 | Format Spec Check | ✅ PASS | 11 review categories + 1 output format, 43 checklist items, 97 lines |
| T9 | Full Pipeline | ⚠️ TIMEOUT | Convert completed; review completed; stages 3-5 not reached within 15 min |
| T10 | Direction Detection | ✅ PASS | Auto-detects en2zh for English PDF; confirmation prompt works |

*\* Goal fix phase may be incomplete due to timeout*

---

## Key Findings

### Pipeline Correctness
- Stage 1 (convert): ✅ MarkItDown produces valid Markdown with content structure
- Stage 2 (review): ✅ Grill phase generates comprehensive, categorized issue reports with severity levels
- Stage 3-5: Not tested end-to-end within timeout window

### Performance Issues
- **OMP Agent session per category is slow** (~1-2 min/category × 8 categories = 8-16 min per review)
- **Goal fix phase** additionally slow (OMP agent fixing issues via tool calls)
- Full pipeline needs >30 min for all 5 stages with current architecture

### Quality Assessment
- **Review report quality is excellent**: specific line numbers, counts, sample positions, severity correctly graded
- **Conversion quality is moderate**: MarkItDown handles text extraction well but tables are partially broken, headings lost, special characters corrupted

### Regression Found
- T2: `ptl check` no longer shows `workdir:` status (removed during CLI refactor)

---

## Recommendations

1. **Add `workdir:` back to `ptl check`** (regression fix)
2. **Consider parallelism for review categories** (instead of sequential per-category OMP calls) to reduce review time
3. **Add progress logging** to show which category is being checked during review
4. **Add stage-level timeout configuration** for long-running operations
