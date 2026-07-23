# 审查报告：编码与乱码（第1类）

审查文件: test/test1_converted.md
审查日期: 2025-07-17
审查范围: 编码与乱码（规范第1类全项）

---

## 审查总结

发现两类系统性编码损坏问题，涉及 **U+FFFD (REPLACEMENT CHARACTER)** 的广泛出现，表明 PDF→Markdown 转换过程中原始 Unicode 字符丢失。

---

## 问题模式 A：破折号编码损坏 — `�C`（应为 En Dash `–` 或 Em Dash `—`）

**根因**: 原始 PDF 中的 en dash (`–`, U+2013, UTF-8 `E2 80 93`) 或 em dash (`—`, U+2014, UTF-8 `E2 80 94`) 在转换时未被正确解码，被替换为 U+FFFD (`�`)，且后续字符 `C` 被保留，形成视觉上的 `�C`。

共发现 **19** 处：

| # | 行号 | 上下文 |
|---|------|--------|
| 1 | 21 | `Kevin Martini �C Supplier Quality Director` |
| 2 | 22 | `Mitchell Thomas �C Chief Quality Officer` |
| 3 | 24 | `Johnny Saldanha �C Chief Procurement and Supply` |
| 4 | 28 | `Markus Leitner �C Chief Technical Officer` |
| 5 | 48 | `RASIC & process map �C APQP` |
| 6 | 64 | `3. Acronyms and Abbreviations �C Ceer Specific` |
| 7 | 93 | `11. Run at Rate �C Supplier Capacity Verification` |
| 8 | 113 | `24. Ceer Properties �C Ceer Tooling Asset` |
| 9 | 153 | `3. Acronyms and Abbreviations �C Ceer Specific` |
| 10 | 319 | `�C Non-Saleable (MVB-nS) (or) end of SV2 event.` |
| 11 | 591 | `Manufacturing Validation Build �C Non-Saleable` |
| 12 | 617 | `11. Run at Rate �C Supplier Capacity Verification` |
| 13 | 926 | `24. Ceer Properties �C Ceer Tooling Asset` |
| 14 | 1164 | `Validation Build �C measured.` |
| 15 | 1192 | `Validation Build �C standard.` |
| 16 | 1216 | `A �C Sample` |
| 17 | 1222 | `B �C Sample` |
| 18 | 1250 | `Build �C Saleable)` |
| 19 | 1257 | `Build �C Saleable) +` |

**严重度**: error — 必须修复（破折号语义丢失，`�C` 不可阅读）

**建议修复**: 将 `�C` 替换为 `–`（en dash）或 `—`（em dash），根据原始 PDF 确定。推断为 `–`（en dash，用于分隔并列/补充信息）的可能性最高。

---

## 问题模式 B：弯引号/撇号编码损坏 — `��`（应为弯引号 `""` 或撇号 `'`）

**根因**: 原始 PDF 中的弯引号（left/right double quotation mark `"` U+201C / `"` U+201D）或弯撇号（right single quotation mark `'` U+2019）在转换时未被正确解码，每个原始字符被替换为一个 U+FFFD (`�`)，两个相邻形成 `��`。

共发现 **41** 处：

| # | 行号 | 上下文 | 应恢复为 |
|---|------|--------|----------|
| 1 | 19 | `Approver��s Name` | `Approver's` (弯撇号) |
| 2 | 131 | `��Our Customers��` | `"Our Customers"` (弯双引号) |
| 3 | 151 | `��shall��` | `"shall"` (弯双引号) |
| 4 | 151 | `��should��` | `"should"` (弯双引号) |
| 5 | 323 | `Supplier��s progress` | `Supplier's` (弯撇号) |
| 6 | 340 | `Supplier��s nominated` | `Supplier's` (弯撇号) |
| 7 | 351 | `supplier��s organization` | `supplier's` (弯撇号) |
| 8 | 354 | `supplier��s technical` | `supplier's` (弯撇号) |
| 9 | 359 | `supplier��s technical, manufacturing` | `supplier's` (弯撇号) |
| 10 | 361 | `supplier��s understanding` | `supplier's` (弯撇号) |
| 11 | 364 | `supplier��s manufacturing` | `supplier's` (弯撇号) |
| 12 | 367 | `supplier��s responsibility` | `supplier's` (弯撇号) |
| 13 | 403 | `supplier��s APQP timing` | `supplier's` (弯撇号) |
| 14 | 411 | `FMEA��s` | `FMEA's` (弯撇号) |
| 15 | 532 | `supplier��s manufacturing` | `supplier's` (弯撇号) |
| 16 | 533 | `suppliers�� internal` | `suppliers'` (弯撇号) |
| 17 | 583 | `��Ceer Supplier Portal��` | `"Ceer Supplier Portal"` (弯双引号) |
| 18 | 586 | `��Ceer Supplier Portal��` | `"Ceer Supplier Portal"` (弯双引号) |
| 19 | 594 | `��Full approved��` | `"Full approved"` (弯双引号) |
| 20 | 601 | `��Ceer Supplier Portal��` | `"Ceer Supplier Portal"` (弯双引号) |
| 21 | 621 | `Supplier��s Run at Rate` | `Supplier's` (弯撇号) |
| 22 | 624 | `��Ceer Supplier Portal��` | `"Ceer Supplier Portal"` (弯双引号) |
| 23 | 629 | `��Ceer Supplier Portal��` | `"Ceer Supplier Portal"` (弯双引号) |
| 24 | 647 | `Supplier��s Control Plan` | `Supplier's` (弯撇号) |
| 25 | 686 | `goods�� serial` | `goods'` (弯撇号) |
| 26 | 687 | `components�� serial` | `components'` (弯撇号) |
| 27 | 689 | `components�� lot` | `components'` (弯撇号) |
| 28 | 704 | `��predictors of process stability��` | `"predictors of process stability"` (弯双引号) |
| 29 | 705 | `supplier��s Control Plan` | `supplier's` (弯撇号) |
| 30 | 728 | `��pass through characteristics��` | `"pass through characteristics"` (弯双引号) |
| 31 | 752 | `��Supplier Request for Change��` | `"Supplier Request for Change"` (弯双引号) |
| 32 | 756 | `Tier n��s` | `Tier n's` (弯撇号) |
| 33 | 842 | `��Ceer National Automotive Company, General Terms and Conditions for Direct Procurement of Goods��` | `"Ceer National..."` (弯双引号) |
| 34 | 856 | `��Ceer Supplier Portal��` | `"Ceer Supplier Portal"` (弯双引号) |
| 35 | 864 | `supplier��s manufacturing` | `supplier's` (弯撇号) |
| 36 | 866 | `supplier��s Registrar` | `supplier's` (弯撇号) |
| 37 | 888 | `��Ceer Supplier Portal��` | `"Ceer Supplier Portal"` (弯双引号) |
| 38 | 902 | `supplier��s facility` | `supplier's` (弯撇号) |
| 39 | 958 | `supplier��s employees` | `supplier's` (弯撇号) |
| 40 | 963 | `supplier��s facility` | `supplier's` (弯撇号) |

**严重度**: error — 必须修复（所有格语义受损，引号不可阅读）

**建议修复**: 将 `��...��` 替换为 `"..."`（标准直双引号）或 `"..."`（弯双引号）；将 `��s` 替换为 `'s`（撇号）。

---

## 逐项核查结论

| 检查项 | 结果 |
|--------|------|
| 全文无不正常字符（乱码、控制字符、私有区字符） | **FAIL** — U+FFFD 替换字符广泛存在（60处） |
| 特殊符号完整保留（°Ωμ、∑∫∞、©®™） | **PASS** — 未发现相关符号缺失 |
| Unicode 字符正确呈现（CJK、emoji、变音符号） | **FAIL** — en/em dash、弯引号全部损坏为 U+FFFD |
| 引号正确转换为标准 Markdown 引号或保留原文形式 | **FAIL** — 弯引号全部损坏为 `��` |
| 破折号（—/–）、省略号（…）正确保留 | **FAIL** — 破折号全部损坏为 `�C` |

---

**总问题数**: 60 处（模式 A: 19 处，模式 B: 41 处）
**严重度**: 全部为 **error**
