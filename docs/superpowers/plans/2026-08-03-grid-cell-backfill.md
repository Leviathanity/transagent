# 图标回填修复：代码路径表格网格 + 单元格级归属（2026-08-03）

## 背景

test2（IMDS 报告）双路径提取 v3 中，81 个独立 icon 块全部落在"表格外"：

- 图标绝对坐标正确（几何偏差 p50 0.74px，218/218 图标落在 PDF 矢量网格外框内）；
- 但 OCR 的 det table bbox 是**表格文字包围盒**，不是表格几何区域：
  - p1：真实网格 (635,48)-(883,1353)，OCR bbox (64,875)-(969,1205)；
  - p2：真实网格 (186,48)-(883,1353)，OCR bbox (64,251)-(967,1215)；
  - p3：真实网格 (186,48)-(666,1353)，OCR bbox (64,251)-(967,885)。
- 回填判定"图标中心 ∈ OCR bbox（±80px 容差）"把 bbox 外的图标判为不在表格内，
  容差带只是把边界附近的图标吸回表格，未纠正表格本身被截短的问题。

根因：**表格几何（区域/单元格）属于代码路径的职责，却由 OCR 的文字包围盒承担**；
矢量网格线（`get_drawings`）已经包含完整表格结构，但没有被用于表格区域模型。

## 目标

1. 代码路径提取表格网格（外框 bbox + 行边界 + 列边界 + 单元格）。
2. 图标回填改为**单元格级归属**：图标中心落入哪个 cell 就挂到该表格的 cellImages，
   并记录 row/col。
3. OCR 表格 ↔ 代码网格对齐：匹配成功时，表格几何以代码网格外框为准，
   同时保留 OCR 内容在网格内的偏移（contentOffset），文字仍渲染在 PDF 真值位置。
4. 表格仅存在于网格、OCR 漏检时，创建空语义表格容器（grid-only table），
   保证图标仍在表格内。
5. 渲染、IR schema、配置、测试、真实 GPU 回归与全链路（translate/review/beautify）验证。

## 设计

### 网格提取（pdf_to_ir.py）

- 收集 `get_drawings()` 的 `l` 线段（跳过纯填充 `f`，包含 `s`/`fs`）：
  - 水平线：`dy < 0.1pt` 且长度 ≥ 15pt；
  - 垂直线：`dx < 0.1pt` 且长度 ≥ 15pt。
- 合并共线重叠线段（容差 2pt，区间取并集）。
- 连通分量：水平线与垂直线相交（±2pt）则同属一个网格。
- 每个网格：
  - 外框 bbox = 分量中所有线的并集范围；
  - 行边界 = 分量内水平线的 y（去重排序）；
  - 列边界 = 分量内垂直线的 x（去重排序）；
  - 每行实际列 = 跨越该行带（中心点）的垂直线 x，支持合并单元格。
- 过滤：无水平线或无垂直线的分量（页眉/页脚装饰线）丢弃。

### OCR 表格 ↔ 网格对齐

- OCR table bbox 中心落入某网格 bbox（或交叠比 ≥ 0.3）→ 匹配。
- 匹配成功：
  - 表格 geometry = 网格外框 bbox；
  - 记录 `content_offset = OCR bbox 原点 - 网格原点`（display px）；
  - cellImages 的 left/top 一律相对**网格原点**。
- 无 OCR 表格匹配但网格内含图标 → 创建空表（grid-only），geometry = 网格 bbox。

### IR / 渲染

- `CellImageRef` 增加可选 `row`/`col`。
- `TableSourceBlock` 增加可选 `contentOffset {left, top}`。
- 渲染器：`.det-table` 容器 = 网格 bbox（带 width/height）；
  语义表格内容放入 `contentOffset` 偏移层；图标覆盖层（0,0 起）保持相对网格定位。

### 配置

`PtlConfig.extraction` 增加：

- `gridLineMinLenPt`（默认 15）
- `gridTolPt`（默认 2.0）
- `gridTableOverlapRatio`（默认 0.3）

## 阶段与验证

| 阶段 | 任务 | 验证 |
|---|---|---|
| P0 | 本计划 + 快速取证脚本 | 计划入库 |
| P1 | `pdf_to_ir.py` 网格提取（含 `grids_only` 调试模式） | 对 test2 输出 3 页网格：行边界 11 条、列边界与 PDF 一致；无 GPU 秒级 |
| P2 | 网格↔OCR 对齐 + 单元格级回填 + grid-only 表 | test2 重跑：cellImages=194、独立 icon=0、decor 仍 24 |
| P3 | IR schema/序列化/渲染器/转换器适配 | `bun test` + `tsc --noEmit` 全绿 |
| P4 | 真实 GPU 全链路 test2（convert→translate→review→beautify） | lint 0、CAS/EPDM 保留、报告归档 workdir |
| P5 | 报告 + HTTP 展示 + 提交 | `workdir/ir-e2e-test2-2026-08-03-*/`，README，git push |

## 风险

- 网格与 OCR 内容行数不一致（IMDS 网格 10 行 vs OCR 表格 10 行是巧合）：本阶段只保证
  几何与图标归属正确，不做 OCR 文本到单元格的语义映射（留待后续）。
- lint 对表格盒的估算基于文字行高，扩大表格几何后需实测 lint 保持 0。
- 网格线阈值是启发式：`gridLineMinLenPt` 过小可能把页面装饰线判成表格，P1 用 test1/test2 对拍。

## 涉及文件

- `scripts/ocr/pdf_to_ir.py` — 网格提取、对齐、回填
- `src/types/document-ir.ts` / `src/converters/unlimited-ocr.ts` — schema
- `src/renderers/pixel-perfect.ts` — contentOffset 渲染
- `src/utils/config.ts` / `ptl.config.example.json` — 配置
- `scripts/diagnose-images.py` — 指标增强（cellImages row/col、standalone 归零验证）
- 测试与归档：`test/IR_TEST_REPORT.md`、`workdir/ir-e2e-test2-2026-08-03-*/`

## 补充（2026-08-03 晚）— DevTools 最终验证

对最终输出文件用 Chrome DevTools 逐图标实测时发现一个**回归**：
review/beautify 的 "Structural repair"（`stage-review.ts` /
`stage-beautify.ts`）把嵌套的绝对定位 div 平铺到 `.page` 根，
覆盖层 `.det-table-imgs`（absolute，嵌套在 absolute 的 `.det-table` 内）
被移出后 containing block 改变，194 个图标全部位移。

修复：渲染器把覆盖层改为**静态包装**（`pointer-events:none`，不设
`position:absolute`），绝对定位 `<img>` 仍以 `.det-table` 为 containing
block；并新增 `scripts/verify-backfill-dom.ts`（CDP 计算布局 vs IR 期望值
逐项对拍）作为最终文件回归工具。

新增阶段：

| 阶段 | 任务 | 验证 |
|---|---|---|
| P6 | 最终文件 DevTools 验证 + 覆盖层静态化修复 + 全链路重跑 | v6：194/194 匹配 ≤2px、表格内 194/194、最终 lint 7（误报） |
