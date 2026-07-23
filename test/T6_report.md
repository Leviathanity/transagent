# 审查报告 — 第1类「编码与乱码」

审查文件: test/T3_output.md
审查日期: 2025-07-18
审查范围: 仅第1类「编码与乱码」检查项

---

## 审查结果: 发现问题（共6类问题）

---

### [error] 编码与乱码 — 全文多处（破折号损坏: `�C`）

**描述**: 原文中的 en-dash (– U+2013) 或 em-dash (— U+2014) 在 PDF→Markdown 转换过程中编码损坏，表现为 U+FFFD（替换字符）后跟字母 "C" 的序列 `�C`。共 27 处，涉及 20 行。

**受影响行**: 19, 21, 22, 24, 28, 48, 64, 93, 113, 153, 319, 591, 617, 926, 1164, 1192, 1216, 1222, 1250, 1257

**典型示例**:
- 第21行: `Kevin Martini �C Supplier Quality Director` → 应为 `Kevin Martini – Supplier Quality Director`
- 第64行: `Acronyms and Abbreviations �C Ceer Specific` → 应为 `Acronyms and Abbreviations – Ceer Specific`

**建议修复**: 将所有 `�C` 替换为 en-dash `–` (U+2013) 或根据上下文恢复原字符。

---

### [error] 编码与乱码 — 全文多处（智能引号/撇号损坏: `��`）

**描述**: 原文中的智能引号（curly double quotes `""` U+201C/U+201D）和智能撇号（curly apostrophe `'` U+2019）编码损坏，表现为成对的 U+FFFD 替换字符 `��`。共出现在 41 行。

**受影响行**: 19, 131, 151, 323, 340, 351, 354, 359, 361, 364, 367, 403, 411, 532, 533, 583, 586, 594, 601, 621, 624, 629, 647, 686, 687, 689, 704, 705, 728, 752, 753, 756, 842, 843, 856, 864, 866, 888, 902, 958, 963

**典型示例**:
- 第19行: `Approver��s Name` → 应为 `Approver's Name`
- 第131行: `��Our Customers��` → 应为 `"Our Customers"`
- 第151行: `��shall�� ... ��should��` → 应为 `"shall" ... "should"`
- 第323行: `Supplier��s` → 应为 `Supplier's`

**建议修复**: 根据上下文将 `��` 替换为对应的 Unicode 引号/撇号，或退化为 ASCII 直引号/撇号。

---

### [error] 编码与乱码 — 全文多处（项目符号损坏: `?`）

**描述**: 原文中的项目符号字符（• U+2022 或类似 Unicode 符号）编码损坏，变为 ASCII 问号 `?` (U+003F)。共 146 行以 `? ` 开头，实际应呈现为 Markdown 无序列表项 `- `。此外表格单元格中也存在内联的 `?` 损坏。

**典型示例**:
- 第171行: `? Communicate to Ceer their current organizational structure...`
- 第288行: `? Supplier Portal (self-registration limited to three supplier personnel)`
- 第336-340行: Core Team 列表项全部以 `?` 开头

**建议修复**: 将所有作为列表标记的 `?` 替换为 Markdown 无序列表符号 `-`，并根据嵌套层级添加适当缩进。

---

### [warning] 编码与乱码 — 第686、688行（子项目符号损坏: `o`）

**描述**: 原文中的子项目符号字符编码损坏，变为小写字母 `o`。共 2 处。

**受影响行**:
- 第686行: `o Serialized (maintains a one-to-one relationship...`
- 第688行: `o Specific Lot (maintains a one-to-one relationship...`

**建议修复**: 将 `o` 替换为适当缩进的 Markdown 子列表标记（如 `  -`）。

---

### [error] 编码与乱码 — 第807-837行（"Issue severity definition"表格字符间距损坏）

**描述**: 表格"问题严重度定义"区域出现严重的字符间距异常——每个字母之间被插入了空格，导致内容完全不可读。这是 PDF 文本提取过程中对特殊排版（可能是竖排文字或特殊格式）处理失败导致的。

**典型示例**:
- 第807行: `A I A G` → 应为 `AIAG`
- 第811行: `S e v e r it y` → 应为 `Severity`
- 第812行: `W a lk  h o m e   9 - 1 0   SD( a f e ty /G o v e r n m e n t R e g u la tio n ...`
- 第815行: `s a f e ty   A ir b a g /B r a k e /A c c e le r a to r /H o r n /A B S /B a tte r y /A x le /S u s p e n s io n /e tc .)`

**建议修复**: 该表格内容需要对照原始 PDF 人工重新录入，无法通过简单的字符替换修复。

---

### [warning] 编码与乱码 — 多处表格碎片残留

**描述**: 在附录 B 的 PPAP 矩阵表格区域（约第1085-1205行），存在多处孤立的单字母/单词片段，疑似表格单元格被拆分后残留的碎片，不构成完整内容。

**示例**:
- 第1098行: `1.5)` — 孤立文本片段
- 第1101行: `s` — 单个字母
- 第1103行: `t n` — 字母碎片
- 第1170-1174行: `s`, `t`, `n`, `e`, `m` — 分散的字母碎片（拼出 "stem" 或类似内容）

**建议修复**: 对照原始 PDF 重建该表格，清除这些残留碎片。

---

## 审查检查项汇总

| 检查项 | 状态 |
|--------|------|
| 全文无不正常字符（乱码、控制字符、私有区字符） | **FAIL** — 大量 U+FFFD 替换字符 |
| 特殊符号完整保留（单位符号 °Ωμ、数学符号 ∑∫∞、版权符号 ©®™） | **FAIL** — 破折号损坏为 `�C` |
| Unicode 字符正确呈现（CJK 扩展字符、emoji、变音符号） | **FAIL** — 智能引号、项目符号全部损坏 |
| 引号正确转换为标准 Markdown 引号或保留原文形式 | **FAIL** — 智能引号全部变成 `��` |
| 破折号（—/–）、省略号（…）正确保留 | **FAIL** — 破折号全部变成 `�C` |

---

## 统计摘要

| 问题类型 | 严重度 | 数量 |
|----------|--------|------|
| `�C` 破折号损坏 | error | 27 处 (20 行) |
| `��` 引号/撇号损坏 | error | 41 行 |
| `?` 项目符号损坏 | error | 146 行 + 表格内多处 |
| `o` 子项目符号损坏 | warning | 2 行 |
| 表格字符间距损坏 | error | ~31 行 (807-837) |
| 表格碎片残留 | warning | ~8 处 |


---

# 审查报告 — 第2类「标题层级」

审查文件: test/T3_output.md
审查范围: 仅第2类「标题层级」检查项

---

## 审查结果: 发现问题（共5类问题）

---

### [error] 标题层级 — 全文（完全缺少 Markdown 标题标记）

**描述**: 全文 1291 行中 **没有任何一行使用 Markdown 标题语法**（`#` 前缀）。文档全部 32 个章节标题（如 `1. Purpose`、`8. Advanced Product Quality Planning (APQP)`）及其下的罗马数字小节（`I.`–`XII.`）和小写罗马数字子节（`i.`–`iii.`）均以纯文本段落形式呈现，而非 `##`/`###`/`####` 标题。这导致文档完全失去结构化导航能力。

**影响范围**: 全文所有层级标题。

**建议修复**: 
- 文档标题 → `# CEER SUPPLIER QUALITY HANDBOOK`
- 章节标题（1–32）→ `## N. Title`
- 罗马数字小节（I–XII）→ `### Roman. Title`
- 小写罗马数字子节（i–iii）→ `#### roman. Title`

---

### [error] 标题层级 — 全文（缺少 H1 文档标题，0 个 H1）

**描述**: 文档规范要求有且仅有一个 H1 标题。当前文件 **H1 数量为 0**。文档标题 "CEER SUPPLIER QUALITY HANDBOOK" 仅以纯文本形式出现在每页的页眉区域（如第57-60行、第99-102行等），从未被标记为 `#` 标题。

**出现位置**（页眉中的文档标题纯文本）: 第57-60行, 第99-102行, 第125-128行, 第157-161行, 第189-192行, 第219-222行, 第261-265行, 第305-308行, 第345-348行, 第387-390行, 第425-429行, 第469-472行, 第511-514行, 第551-554行, 第573-577行, 第613-616行, 第659-663行, 第697-701行, 第741-745行, 第848-851行, 第875-879行, 第913-917行, 第949-952行, 第989-992行, 第1018-1022行, 第1026-1030行, 第1044-1048行, 第1261-1265行

**建议修复**: 在文档正文开始处（第129行之前或第57行处）添加 `# CEER SUPPLIER QUALITY HANDBOOK` 作为唯一 H1。

---

### [error] 标题层级 — 全文（层级完全缺失，无法评估跳级）

**描述**: 由于没有任何 Markdown 标题标记，文档的4级层次结构（文档标题 → 章 → 节 → 子节）完全扁平化，无法通过 `#` 层级来体现。理论上应呈现为：

```
H1: CEER SUPPLIER QUALITY HANDBOOK
├── H2: 1. Purpose
├── H2: 2. Scope
├── H2: 7. Ceer Requirement
│   ├── H3: I. Criteria for selection as a Ceer Supplier
│   │   ├── H4: i. IATF 16949 Registration
│   │   ├── H4: ii. Environmental and Sustainability Compliance
│   │   └── H4: iii. e-Business Capabilities
│   └── H3: II. Supplier Quality Roadmap
│       └── H4: i. Supplier Sourcing and Early SQ Engagement
├── H2: 8. Advanced Product Quality Planning (APQP)
│   └── H3: I. Introduction
├── H2: 9. Quality Activities Prior to Production Part Approval
│   ├── H3: I. Technical Reviews
│   ├── H3: II. Sourcing Eligibility
│   ├── H3: III. APQP Kick-off Meeting ...
│   ├── ...
│   └── H3: XII. APQP Deliverables Submission and Approval
...
```

但实际上这4级全部以纯文本呈现，无任何层级标记。

**建议修复**: 同上，按层级添加 `#`/`##`/`###`/`####`。

---

### [warning] 标题层级 — 多处（未编号的隐含标题混入正文）

**描述**: 以下行在原始 PDF 中为子标题，但转换后以纯文本段落形式呈现，未纳入任何标题层级，容易被误读为正文段落：

| 行号 | 文本 | 所在章节 | 建议层级 |
|------|------|----------|----------|
| 61 | `Table of Contents` | 目录页 | H2 或 加粗 |
| 555 | `Roles and Responsibilities` | §9 (APQP 交付物) | H3 |
| 802 | `Issue severity definition` | §18 (SQPR) | H3 |
| 1081 | `Maturation` | §30 附录B 表格内 | H3 |
| 1084 | `Level` | §30 附录B 表格内 | H4 |
| 1267 | `Definition` | §32 附录D | H3 |
| 1272 | `Categorization` | §32 附录D | H3 |
| 1279 | `Requirements` | §32 附录D | H3 |

**建议修复**: 根据原始文档结构，将这些文本标记为适当层级的 Markdown 标题（`###` 或 `####`）。

---

### [warning] 标题层级 — 第1079行、第1210行（附录标题嵌入表格）

**描述**: 两个附录的主要标题被嵌入 Markdown 表格单元格中，而非独立成行：

- 第1079行: `| 30.  | Appendix B: PPAP Submission and Approval Matrix  | ...` 
- 第1210行: `| 31.  Appendix C: A-B-C-D Sample Definition  | ...`

其他章节标题（1–29, 32）均为独立文本行，仅附录 B 和 C 被错误地放入表格，格式不一致。

**建议修复**: 将这两行从表格中提取出来，改为独立的 `## 30. Appendix B: ...` 和 `## 31. Appendix C: ...` 标题行。

---

## 审查检查项汇总

| 检查项 | 状态 |
|--------|------|
| H1-H6 层级连续，无跳级 | **FAIL** — 全文无任何 Markdown 标题标记，层级完全缺失 |
| 标题文本完整，无截断、无跨页拆分 | **PASS** — 标题文本本身完整 |
| 文档有且仅有一个 H1 | **FAIL** — H1 数量为 0 |
| 无将正文段落、列表项、表格标题错误识别为 Markdown 标题 | **PASS** — 无反向误识别（因为没有标题标记） |
| 数字编号标题格式正确 | **PASS** — `N. Title` 格式一致正确 |

---

## 统计摘要

| 问题类型 | 严重度 | 数量 |
|----------|--------|------|
| 完全缺少 Markdown 标题标记 | error | 全文 (~60+ 标题) |
| 缺少 H1 文档标题 | error | 1 个（缺失） |
| 层级完全缺失 | error | 全文 4 级层次 |
| 未编号隐含标题混入正文 | warning | 8 处 |
| 附录标题嵌入表格 | warning | 2 处 |

---

# 审查报告 — 第3类「表格完整性」

审查文件: test/T3_output.md
审查范围: 仅第3类「表格完整性」检查项

---

## 审查结果: 发现问题（共8类问题）

---

### [error] 表格完整性 — 第31-53行（Change History 表格严重碎片化）

**描述**: "Change History" 表格结构严重损坏。表头行（第31行）被展平为纯文本 `Version  Status  Effective Date  Handled by   Approved by   Comment`，未转换为 Markdown 表格行。多行单元格内容（跨行注释文本）全部脱离表格结构，散落为独立段落。

**具体表现**:
- 第31行: 表头为纯文本，非 `| Version | Status | ...` 格式
- 第36-41行: 版本 2.0 的 Comment 列内容（`Revised version in accordance with GT&C development...`）完全脱离表格
- 第46-53行: 版本 4.0 的 Comment 列内容（`Appendix C: A-B-C-D Sample Definition` 等）完全脱离表格

**建议修复**: 将表头转为 Markdown 表头行；将多行注释合并回对应单元格（使用 `<br>` 或保留展平标注）。

---

### [error] 表格完整性 — 第19-28行（Approval 表格行脱离）

**描述**: Approval 表格中有 2 行数据完全脱离表格结构，变为纯文本：

- 第21行: `Supplier Quality  Kevin Martini �C Supplier Quality Director` — 应为表格行
- 第24行: `Johnny Saldanha �C Chief Procurement and Supply  Johnny Saldanha` — 应为表格行

此外第23行出现了一个冗余的表格分隔线 `|---|---|...`，打断了表格连续性。

**建议修复**: 将第21、24行重新纳入表格行，移除第23行冗余分隔线。

---

### [error] 表格完整性 — 第12-13行（Document Location 行脱离表格）

**描述**: "Document Location" 行（包含 SharePoint 路径信息）完全脱离文档元数据表格，以纯文本形式出现：

```
12: Document Location  (Quality SharePoint / 3. Supplier Quality / 0. Supplier Quality / 4. SQ
13: Management / Supplier Quality Handbook)
```

该行逻辑上属于上方的文档信息表格（第2-11行），但缺少 `|` 管道符。

**建议修复**: 将其作为表格的一行纳入，或标注为表格注释。

---

### [error] 表格完整性 — 第808-837行（Issue Severity Definition 表格严重碎片化 + 内容损坏）

**描述**: 该表格同时存在两类问题：(a) 约13行表格内容（第811-812行, 第815行, 第819-821行, 第826-827行, 第831行, 第835行）完全脱离表格结构变为纯文本；(b) 表格内字符间距损坏（参考第1类审查第5项）。表格结构已完全不可用。

**示例**:
- 第811行 `S e v e r it y`（应为表头单元格）
- 第812行 `W a lk  h o m e   9 - 1 0   SD(...)`（应为表格数据行）
- 第815行 `s a f e ty   A ir b a g /...`（应为表格数据行）

**建议修复**: 对照原始 PDF 完全重建该表格。

---

### [error] 表格完整性 — 第1079-1133行（Appendix B PPAP 矩阵表格严重碎片化）

**描述**: Appendix B 的 PPAP Submission and Approval Matrix 表格中，大量内容散落为纯文本段落和孤立的列表项，与表格行交错混杂：

- 第1081行 `Maturation`、第1084行 `Level` — 子标题被置于表格外
- 第1085-1090行 — 6 行列表项（`? 3D Scanning data...` 等）散落在表格外
- 第1097-1103行 — 数据内容（`? Weld Strength...`, `1.5)`, `s`, `t n`）变成表格外纯文本碎片
- 第1115行 `R`、第1126-1129行 — 更多表格外碎片

**建议修复**: 对照原始 PDF 完全重建该表格。

---

### [error] 表格完整性 — 第1210-1257行（Appendix C A-B-C-D Sample 表格严重碎片化）

**描述**: 与 Appendix B 类似，Appendix C 表格结构完全破碎。原始 PDF 中的多列表格（Category / Build Phase / Definition / Maturity Level / Requirements）被拆散为表格行与纯文本的随机混合：

- 第1212行 — 表头行脱离为纯文本
- 第1213, 1217-1218, 1221-1233行 — 大量纯文本碎片（`Functional samples...`, `PT`, `n  B �C Sample...`, `o`, `i t maturity...` 等）
- 第1240-1242, 1245-1246, 1250-1252, 1256-1257行 — 更多脱离的纯文本

**建议修复**: 对照原始 PDF 完全重建该表格。

---

### [error] 表格完整性 — 第1049-1075行（Appendix A 无边框表格完全未转换）

**描述**: Appendix A "Acronyms and Abbreviations" 在原 PDF 中是一个两列（Term / Definition）的无边框表格。转换后该表格完全被展平为纯文本，每行格式为 `TERM  Definition`，未构建任何 Markdown 表格结构：

```
1050: Term Definition
1051: AIAG Automotive Industry Action Group
1052: APQP Advanced Product Quality Planning
...
1074: TKO Tooling Kick-Off
```

**影响**: 共 23 条缩略语定义全部失去表格结构。

**建议修复**: 转换为标准 Markdown 表格：
```
| Term | Definition |
|------|------------|
| AIAG | Automotive Industry Action Group |
| APQP | Advanced Product Quality Planning |
...
```

---

### [warning] 表格完整性 — 第787-788行（页眉元素被误识别为表格）

**描述**: 第787-788行是一个 8 列的 Markdown 表格，内容为每页重复的页眉信息（`CEER SUPPLIER QUALITY | Doc ID: CEER-QUSQ-SP5-L2-001`）。这不是真正的数据表格，而是 PDF 页眉/页脚布局在转换中被错误构建为表格结构。属于第7类（污染内容）和第3类交叉问题。

```
787: |     | CEER SUPPLIER QUALITY  |     |     |     | Doc ID: CEER-QUSQ-SP5-L2-001  |     |     |
788: | --- | ---------------------- | --- | --- | --- | ----------------------------- | --- | --- |
```

**建议修复**: 移除该表格，将内容作为文档元数据合理呈现。

---

## 审查检查项汇总

| 检查项 | 状态 |
|--------|------|
| 表格行列数正确，无缺列或多列 | **PASS** — 表格内管道符数量基本一致 |
| 表格对齐线 `---|---|` 列数与表头一致 | **PASS** — 对齐线列数与对应表头一致 |
| 合并单元格情况被标注或合理展平 | **FAIL** — 合并单元格（如 Change History 跨行 Comment）被拆散为独立段落 |
| 空单元格有占位内容，不被跳过 | **WARN** — 大量空单元格仅以空格填充，无明确占位符 |
| 无将表格内容展平为纯文本段落 | **FAIL** — 7 处表格内容被大量展平为纯文本 |
| 无边框表格被正确识别并构建为 Markdown 表格 | **FAIL** — Appendix A 无边框表格完全未转换 |

---

## 统计摘要

| 问题类型 | 严重度 | 数量 |
|----------|--------|------|
| Change History 表格碎片化 | error | 1 个表（~20 行脱离） |
| Approval 表格行脱离 | error | 1 个表（2 行脱离 + 冗余分隔线） |
| Document Location 行脱离 | error | 1 行 |
| Severity 表格碎片化 + 损坏 | error | 1 个表（~13 行脱离） |
| Appendix B PPAP 矩阵碎片化 | error | 1 个表（~20+ 行脱离） |
| Appendix C Sample 表格碎片化 | error | 1 个表（~20+ 行脱离） |
| Appendix A 无边框表格未转换 | error | 1 个表（23 条数据） |
| 页眉元素误识别为表格 | warning | 1 处（2 行） |

---

# 审查报告 — 第4类「列表结构」

审查文件: test/T3_output.md
审查范围: 仅第4类「列表结构」检查项

---

## 审查结果: 发现问题（共6类问题）

---

### [error] 列表结构 — 全文（无 Markdown 列表语法，~150 项全部使用损坏标记）

**描述**: 全文约 25 组列表、约 150 个列表项，**全部使用编码损坏的 `?` 字符作为列表标记**，而非标准 Markdown 无序列表语法（`-`、`*`、`+`）。这意味着文档中不存在任何有效的 Markdown 列表。同时属于第1类（编码损坏）和第4类（列表结构）交叉问题。

**影响的列表组**（按出现顺序）:

| # | 行号 | 项数 | 上下文 |
|---|------|------|--------|
| 1 | 171-172 | 2 | Senior Management shall: |
| 2 | 288-294 | 7 | e-Business capabilities include: |
| 3 | 336-340 | 5 | Core Team comprises: |
| 4 | 375-383 | 9 | APQP Kick-off minimum activities: |
| 5 | 437-439 | 3 | SQS & supplier reviews to: |
| 6 | 449-451 | 3 | APQP Team will review: |
| 7 | 459-477 | 12 | Timing plan activities (跨页拆分) |
| 8 | 502-507 | 6 | PFMEA development inputs: |
| 9 | 622-625 | 2 | Run at Rate items: |
| 10 | 636-642 | 5 | SLP criteria: |
| 11 | 680-688 | 7 | Lot number changes: (含2项子列表) |
| 12 | 732-738 | 5 | PTC process definition: |
| 13 | 762-766 | 5 | Serial Production requirements: |
| 14 | 777-796 | 2 | SQPR required actions: |
| 15 | 866-872 | 4 | Unauthorized change consequences: |
| 16 | 972-984 | ~8 | Controlled Shipping flowchart (流程图展平) |
| 17 | 1008-1015 | 7 | EE exit criteria + responsibilities: |
| 18 | 1032-1041 | 10 | Reference Documents: |
| 19 | 1085-1143 | ~20 | Appendix B PPAP requirements (混入表格碎片) |
| 20 | 1151-1198 | ~15 | Appendix B continuation (混入表格碎片) |
| 21 | 1273-1277 | 3 | Appendix D Categorization: |

**建议修复**: 将所有 `? ` 替换为标准 Markdown 无序列表标记 `- `，子列表添加缩进（`  - `）。

---

### [error] 列表结构 — 第686-688行（子列表无缩进，层级扁平化）

**描述**: 第685行 `? When required, the supplier may need to implement:` 后紧跟两个子列表项（第686、688行），但它们使用损坏的 `o` 标记且**完全无缩进**，与父级 `?` 标记齐平。原始 PDF 中应为缩进的二级列表。

**当前呈现**:
```
? When required, the supplier may need to implement:
o Serialized (...) lot traceability; or
o Specific Lot (...) traceability for certain programs.
```

**预期呈现**:
```
- When required, the supplier may need to implement:
  - Serialized (...) lot traceability; or
  - Specific Lot (...) traceability for certain programs.
```

**建议修复**: 将 `o ` 替换为 `  - `（2空格缩进+无序列表标记），体现正确的嵌套层级。

---

### [warning] 列表结构 — 第459-477行（列表被分页符切断）

**描述**: "Timing plan activities" 列表（共 12 项）被分页符切断为两段：
- 上半段: 第459-465行（7项）→ 第466行出现 `Confidential Page 12 of 33`
- 下半段: 第473-477行（5项）→ 中间插入第468-472行的页眉区域（`- External Confidential -`、文档标题等）

这导致原本连续的 12 项列表在视觉和语义上被割裂为两个独立段落。

**建议修复**: 移除中间的分页符和页眉内容后，将两段合并为一个连续列表。

---

### [warning] 列表结构 — 多处（多行列表项缺少续行缩进）

**描述**: 约 10+ 个列表项的内容跨越多行，但续行文本未缩进，无法与独立列表项或后续正文区分。在 Markdown 中，多行列表项续行应缩进 2-4 空格。

**典型示例**:
- 第622-624行: `? R@R #1: ... the evaluation` / `of machine cycle time...` / `��Ceer Supplier Portal��.` — 3 行无缩进续行
- 第639-640行: `? Supplied from... unless otherwise specified` / `by Ceer SQS.` — 续行顶格
- 第777-778行: `? To submit interim containment action... and update` / `periodically.` — 续行顶格

**建议修复**: 为所有续行添加 2-4 空格缩进，如：
```
- R@R #1: 300 pcs minimum or four production hours for the evaluation
  of machine cycle time shall be completed prior to MVB-S MRD...
```

---

### [warning] 列表结构 — 第1085-1143行 及 第1151-1198行（非列表碎片混入列表区域）

**描述**: Appendix B 的 PPAP 矩阵区域中，列表项与表格碎片（孤立的单字母/单词）交错混杂，破坏列表的语义完整性：

- 第1098行: `1.5)` — 表格碎片插入两个列表项之间
- 第1101行: `s` — 单个字母插入列表项之间
- 第1103行: `t n` — 字母碎片
- 第1115行: `R` — 单字母
- 第1120行: `A` — 单字母
- 第1122行: `P ? Parts off serial tools...` — 表格碎片与列表项粘连
- 第1170-1174行: `s`/`t`/`n`/`e`/`m` — 5行字母碎片插入列表

**建议修复**: 这些碎片属于第3类（表格完整性）问题。修复表格后，列表结构将自然恢复。

---

### [warning] 列表结构 — 第972-984行（流程图层级被展平为扁平伪列表）

**描述**: "Controlled Shipping" 流程图在原 PDF 中具有层级结构（Level A→B→C，CS Level 1→2），但转换后被全部展平为 `?` 伪列表项，丢失了原始的方向性和层级关系：

```
972: ? Executive Escalation (EE) Process
973: Level A
974: ? EEC to EEB to EEA
975: Level B Level C
976: ? Failure level A recognized repeatedly...
977: ? QPRR is required...
978: CS Level 2
979: ? Supplier Audit is required.
980: ? Required participation of Supplier Director Level
981: ? Failure level A recognized first time.
982: ? QPRR is required.
983: CS Level 1
984: ? Supplier sorting inspection and control shipment.
985: Fig.2. Control Shipping Process
```

子标题（`Level A`、`Level B Level C`、`CS Level 2`、`CS Level 1`）与列表项交错，无法区分层级归属。

**建议修复**: 如果无法还原流程图，至少应使用嵌套列表体现层级：
```
- Level A: EEC → EEB → EEA
  - Failure level A recognized repeatedly. Failure of CS Level I exit.
  - QPRR is required. Third party sorting inspection approved by Ceer.
- Level B: ...
```

---

## 审查检查项汇总

| 检查项 | 状态 |
|--------|------|
| 有序列表编号连续 | **N/A** — 文档中不存在 Markdown 有序列表 |
| 无序列表嵌套层级正确（最多 4 层） | **FAIL** — 子列表无缩进，层级完全扁平化 |
| 列表项内容完整，无跨项合并或缺失 | **WARN** — 部分列表项续行无缩进；Appendix B 区域混入表格碎片 |
| 列表缩进一致 | **FAIL** — 子列表无缩进；多行续行无缩进 |
| 列表不包含不属于它的段落 | **WARN** — Appendix B 列表区域混入表格碎片；流程图被展平 |

---

## 统计摘要

| 问题类型 | 严重度 | 数量 |
|----------|--------|------|
| 全部列表项使用损坏 `?` 标记 | error | ~150 项 (25 组列表) |
| 子列表无缩进 | error | 1 组 (2 项) |
| 列表被分页符切断 | warning | 1 组 (12 项分裂) |
| 多行列表项缺少续行缩进 | warning | ~10+ 处 |
| 非列表碎片混入列表区域 | warning | 2 个区域 (~15 处碎片) |
| 流程图层级被展平为扁平列表 | warning | 1 组 (~8 项) |

---

# 审查报告 — 第5类「段落连续性」

审查文件: test/T3_output.md
审查范围: 仅第5类「段落连续性」检查项

---

## 审查结果: 发现问题（共4类问题）

---

### [warning] 段落连续性 — 全文（同节内多段落无空行分隔）

**描述**: 在 Markdown 中，段落之间必须用空行分隔。当前文件中，同一章节内的多个逻辑段落全部紧密拼接，之间无任何空行。在 Markdown 渲染器中，这些段落将塌陷为一个连续文本块。

**典型示例 — §1 Purpose（第129-144行）**:
```
129: 1. Purpose
130: To accomplish our world-class quality vision, Ceer is committed...
133: contract and this document.
134: The Purpose of this Supplier Quality Handbook is to outline...
138: certification that will be used in the sourcing process.
139: Unless otherwise specified in the following, the requirements...
142: 3rd Edition & Control Plan 1st Edition released by AIAG.
143: This Supplier Quality Handbook, however, is not intended to change...
144: of inconsistencies, the AIAG standards shall take precedence.
```
以上 4 个逻辑段落全部无缝拼接。正确格式应在每个段落之间插入空行。

**典型示例 — §4 Responsibilities（第162-185行）**:
该节含约 9 个逻辑段落，全部连续拼接无空行。

**影响范围**: 几乎所有含多段落的章节（§1, §2, §4, §5, §7, §8, §9, §10, §12-§28 等），估计 50+ 处段落边界缺少空行。

**建议修复**: 在逻辑段落之间插入空行。如原始 PDF 使用首行缩进区分段落，则转换后必须用空行替代。

---

### [warning] 段落连续性 — 第459-477行、第777-796行（跨页内容被页眉切断）

**描述**: 两处列表内容被分页符 + 页眉块切断（详见第4类审查）：

- **第459-477行**: "Timing plan activities" 12 项列表被分页符（第466行）+ 页眉（第468-472行）切断为 7+5 项
- **第777-796行**: SQPR required actions 列表被分页符（第783行）+ 页眉表格（第787-788行）切断为 2+2 项。页眉在此处异常地使用了表格格式（`| CEER SUPPLIER QUALITY | ...`），进一步加重割裂感

此外，第340-349行和第507-515行等处的段落-列表过渡区在跨页时也被页眉打断。

**建议修复**: 移除页眉/页脚块后合并被切断的列表和段落。

---

### [info] 段落连续性 — 全文（33处分页符均匀分布，大多位于节边界）

**描述**: 文档包含 33 个分页符（`Confidential Page X of 33`），均匀对应原始 PDF 的 33 页。检查发现，大多数分页符（~28/33）恰好落在章节/子章节边界，未切断段落。仅 2 处（第459-477行、第777-796行）切断列表内容。

分页符位置:
```
Page  1 → line  54 | Page 12 → line 466 | Page 23 → line 911
Page  2 → line  96 | Page 13 → line 508 | Page 24 → line 946
Page  3 → line 122 | Page 14 → line 548 | Page 25 → line 986
...
```

**结论**: 分页符虽属污染内容（见第7类），但从段落连续性角度看影响有限。

---

### [info] 段落连续性 — 全文（无连续多余空行，无首行缩进）

**描述**: 
- **空行**: 文件以 CRLF (`\r\n`) 换行。全文无连续 2 个以上空行，符合规范。
- **首行缩进**: 全文所有段落均无首行缩进（左对齐到第 1 列），完全一致。符合 Markdown 段落规范。

---

## 审查检查项汇总

| 检查项 | 状态 |
|--------|------|
| 跨页断行的段落已合并为一段 | **WARN** — 大部分段落未跨页拆分，但 2 处列表跨页未合并 |
| 无多余空行（连续 3 个及以上空行视为异常） | **PASS** — 无连续多余空行 |
| 无丢失的段落 | **PASS** — 与 TOC 对照，32 个章节内容完整；无明显段落缺失 |
| 段落首行缩进处理一致 | **PASS** — 全文统一无首行缩进，符合 Markdown 规范 |

---

## 统计摘要

| 问题类型 | 严重度 | 数量 |
|----------|--------|------|
| 同节内段落无空行分隔 | warning | ~50+ 处（几乎所有多段落章节） |
| 跨页列表被页眉切断 | warning | 2 组 |
| 分页符分布（大多在节边界） | info | 33 处（仅 2 处切断内容） |
| 连续空行 / 首行缩进 | info | 正常，无异常 |

---

# 审查报告 — 第6类「特殊元素」

审查文件: test/T3_output.md
审查范围: 仅第6类「特殊元素」检查项

---

## 审查结果: 发现问题（共2类问题）

---

### [warning] 特殊元素 — 第200行、第985行、第1023行（图片丢失：3 处 Figure 仅有标题无图片）

**描述**: 原始 PDF 中包含 3 个图片（流程图/示意图），转换后仅保留了图题（Figure caption），图片本身未被提取，也无任何 `![描述](path)` 或 `[IMAGE: 描述]` 占位标记。

| 行号 | 图题 | 说明 |
|------|------|------|
| 200 | `Fig.01. Ceer APQP Process Definition` | APQP 流程图，位于 §5 |
| 985 | `Fig.2. Control Shipping Process` | 受控发运流程图，位于 §26 |
| 1023 | `Fig.03. Executive Escalation Process` | 执行升级流程图，位于 §27 |

其中 Fig.03（第1023行）尤为突出——该行独占第27页，该页除图文外仅有页眉/页脚，图片丢失导致整页几乎为空。

**建议修复**: 从原始 PDF 中提取图片，保存为独立文件，在图题处添加 `![Fig.01. Ceer APQP Process Definition](path/to/fig01.png)`。

---

### [warning] 特殊元素 — 第237行、第277行（URL 未超链接化）

**描述**: 文档中有 2 处 URL 以纯文本形式呈现，未使用 Markdown 超链接语法 `[text](url)`：

| 行号 | 当前呈现 | 建议呈现 |
|------|----------|----------|
| 237 | `(IMDS) (www.mdsystem.com).` | `(IMDS) ([www.mdsystem.com](https://www.mdsystem.com)).` |
| 277 | `visit http://www.aiag.org.` | `visit [http://www.aiag.org](http://www.aiag.org).` |

此外，第545行的 `Supplier Portal URL: TBD` 为原始文档中的占位文本（To Be Determined），无需转换。

**建议修复**: 将 URL 包装为 `[url](url)` 或 `[描述](url)` 格式。

---

## 审查检查项汇总

| 检查项 | 状态 |
|--------|------|
| 图片引用保留 | **FAIL** — 3 处图片丢失，无任何占位标记 |
| 代码块起止边界配对 | **N/A** — 文档无代码块 |
| 内联代码符号配对正确 | **N/A** — 文档无内联代码 |
| 代码块语言标记保留 | **N/A** — 文档无代码块 |
| 引用块 `>` 嵌套层级正确 | **N/A** — 文档无引用块 |
| 脚注/尾注引用和定义关联正确 | **N/A** — 文档无脚注 |
| 超链接 `[text](url)` 语法完整 | **WARN** — 2 处 URL 未使用超链接语法 |

---

## 统计摘要

| 问题类型 | 严重度 | 数量 |
|----------|--------|------|
| 图片丢失（仅保留标题） | warning | 3 处 |
| URL 未转换为超链接 | warning | 2 处 |

---

# 审查报告 — 第7类「污染内容」

审查文件: test/T3_output.md
审查范围: 仅第7类「污染内容」检查项

---

## 审查结果: 发现问题（共3类问题）

---

### [error] 污染内容 — 全文（页眉块重复混入：~150 行，占全文 11.6%）

**描述**: 原始 PDF 的页眉区域在转换中被完整保留并混入正文。每页重复出现以下 5 行页眉块（行数因个别页面格式略有差异）：

```
- External Confidential -
CEER SUPPLIER QUALITY Doc ID: CEER-QUSQ-SP5-L2-001
Version/Status: 4.0/ Released
HANDBOOK
Effective Date: 07 July 2024
```

**精确统计**:

| 页眉元素 | 出现次数 |
|----------|----------|
| `- External Confidential -` | 32 次 |
| `CEER SUPPLIER QUALITY` + `Doc ID: CEER-QUSQ-SP5-L2-001` | 30 次 |
| `Version/Status: 4.0/ Released` | 29 次 |
| `HANDBOOK` | 30 次 |
| `Effective Date: 07 July 2024` | 29 次 |

**影响**: 这些行在阅读时反复出现，严重干扰阅读流畅性。在正文中搜索时也会产生大量误匹配。

**建议修复**: 移除所有页眉行。文档标题和元数据应仅在文档开头出现一次。

---

### [error] 污染内容 — 全文（页脚/页码残留：33 行）

**描述**: 原始 PDF 的页脚 `Confidential Page X of 33` 在每一页末尾重复出现，共 33 次：

| 页码 | 行号 | 页码 | 行号 |
|------|------|------|------|
| Page 1 | 54 | Page 18 | 695 |
| Page 2 | 96 | Page 19 | 739 |
| Page 3 | 122 | Page 20 | 783 |
| ... | ... | ... | ... |
| Page 17 | 657 | Page 33 | 1291 |

部分页脚存在格式变体，如第845行: `Confidential                                                             Page 21 of 33`（含大量空格填充）。

**建议修复**: 移除所有页脚行。

---

### [warning] 污染内容 — 第1行、第2行、第787-788行（污染格式异常）

**描述**: 三处污染内容与标准格式不一致：

1. **第1行**: `- External Confidential`（缺少尾部 ` -`）—— 这是封面页的文档密级标记，与正文页眉 `- External Confidential -` 格式不同。严格来说属于文档封面内容，但格式不统一。

2. **第2行**: `|     |     |     |  Confidential  |     |     |     |` —— 封面上的装饰性表格行，将 "Confidential" 密级标记嵌入 7 列表格中。这属于封面设计元素残留。

3. **第787-788行**: 页眉被异常转换为 Markdown 表格：
   ```
   |     | CEER SUPPLIER QUALITY  |     |     |     | Doc ID: CEER-QUSQ-SP5-L2-001  |     |     |
   | --- | ---------------------- | --- | --- | --- | ----------------------------- | --- | --- |
   ```
   这是唯一一处页眉被构建为表格的页面（Page 21）。其余 28+ 页均使用纯文本页眉。

**建议修复**: 统一处理：移除封面装饰行，修复异常表格页眉为纯文本（或一并移除）。

---

## 污染占比分析

| 类别 | 行数 | 占全文比例 |
|------|------|------------|
| 页眉块（5 行 × ~29 页） | ~150 | 11.6% |
| 页脚（1 行 × 33 页） | 33 | 2.6% |
| 封面异常 | 2 | 0.2% |
| **合计** | **~185** | **~14.3%** |

全文 1290 行中约 **185 行（14.3%）为重复污染内容**，每页平均 ~5.6 行污染。

---

## 审查检查项汇总

| 检查项 | 状态 |
|--------|------|
| 无页眉文字混入正文 | **FAIL** — ~150 行页眉混入正文，每页重复 |
| 无页脚/页码残留 | **FAIL** — 33 行 `Confidential Page X of 33` 残留 |
| 无水印文字混入 | **PASS** — "Confidential" 为文档原始密级标记，非 PDF 水印 |
| 无 PDF 元数据残留 | **PASS** — 未发现文件路径、创建日期等元数据 |

---

## 统计摘要

| 问题类型 | 严重度 | 数量 |
|----------|--------|------|
| 页眉块重复混入 | error | ~150 行 (~29 组完整页眉) |
| 页脚/页码残留 | error | 33 行 |
| 污染格式异常 | warning | 3 处 |

---

# 审查报告 — 第8类「数学公式」

审查文件: test/T3_output.md
审查范围: 仅第8类「数学公式」检查项

---

## 审查结果: 无问题

该文档为供应商质量手册（Supplier Quality Handbook），属于企业质量管理类文档，全文不包含任何数学公式。

具体检查:
- LaTeX 公式标记 `$$...$$` 或 `$...$`: **不存在**
- 数学符号（±÷×∑∫√∞≈≠≤≥ 等）: **不存在**
- 行内/行间公式: **不存在**

---

## 审查检查项汇总

| 检查项 | 状态 |
|--------|------|
| LaTeX 数学公式完整保留 | **N/A** — 文档不含数学公式 |
| 公式无截断或乱码 | **N/A** — 文档不含数学公式 |
| 行内公式与行间公式区分正确 | **N/A** — 文档不含数学公式 |

---

## 统计摘要

| 问题类型 | 严重度 | 数量 |
|----------|--------|------|
| — | — | 0 |