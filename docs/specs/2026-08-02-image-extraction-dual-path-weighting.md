# Spec：图像提取双路径权重优化（OCR 语义 × 代码几何）

> 状态：ready-for-agent
> 日期：2026-08-02
> 触发来源：test2.pdf（IMDS 材料数据报告）泛化性测试发现（Phase 11）

## Problem Statement

当前转换阶段对文档图片的提取以 OCR 检测为主、代码路径（PyMuPDF）为辅，导致：

- 大量小图标被提取为独立 image 块（test2 共 141 块），但其**位置与引用地址和源文件存在系统性差异**：图标按 PDF 精确坐标渲染，表格/文本按 OCR det 坐标渲染，两套坐标系并存造成 5–20px 的相对漂移（例如页 3 表头行图标悬浮在表格上缘之外）；
- `src` 命名是"出现序号"（`emb_p0002_n152.png`）而非资源身份（xref/内容 hash）：同一图标在 PDF 中被放置 153 次（unique xref = 1），实际仅 ~10 个唯一内容，却产生 350+ 个重复文件；无法与源 PDF 资源对应，且放大 HTML 体积、lint 误报与 review 成本；
- 矢量图依赖"间隙 ≥120px + 非白 >3%"的光栅启发式，是为 test1 调的，对表格密集型文档（IMDS）不稳健；
- 图标与 OCR 文本块重叠时，当前"overlap>0.3 首个命中"匹配可能吞掉文本语义，且不区分内容图/图标/装饰。

用户期望：以"代码路径给几何与资源身份、OCR 给语义与结构"的双路径权重模型，实现更准确、可复现、低噪声的图像提取，并保持 test1/test2 双文档回归通过。

## Solution

建立**按领域分配权威**的双路径提取模型：

- **代码路径（PyMuPDF）＝几何与资源真值**（权重 1.0）：图像 bbox、xref/内容 hash、文本 span、矢量 drawings；
- **OCR 路径＝语义与结构真值**（权重 1.0）：文本内容、表格结构、标题层级、图像类别；
- 图像按 `kind`（content / icon / decor / vector）分层处理：内容图保留为独立块，行内小图标归入表格 cellImages 或装饰层，矢量图改用 `get_drawings()` 精确路径；
- 图片按资源身份去重（xref/hash 唯一键），同一资源只提取一次，出现位置以 `placements` 列表挂在块上；
- 所有块（文本/表格/图像）统一以 PDF 坐标换算为显示坐标，OCR det 仅用于块划分；冲突输出诊断记录而非静默取一方。

## User Stories

1. 作为翻译管线用户，我希望转换阶段输出的每个图片引用都能对回源 PDF 的具体资源（xref/内容），以便核对提取是否正确。
2. 作为翻译管线用户，我希望同一图标（如 IMDS 树级标记）在全文只保留一份资源文件，而不是每出现一次生成一个文件。
3. 作为翻译管线用户，我希望小图标（<30px、重复出现）不再挤占独立 image 块，避免最终 HTML 里出现大量悬浮小图。
4. 作为翻译管线用户，我希望表格单元格内的图标作为表格的一部分渲染（cellImages），位置与单元格对齐，而不是绝对定位悬浮在表格上方。
5. 作为翻译管线用户，我希望图标与正文/表格的相对位置与源 PDF 一致（误差 ≤2px），不再出现"图标错位"。
6. 作为翻译管线用户，我希望 OCR 把"文本+图标"识别为一个块时，文本内容不被图标匹配吞掉。
7. 作为翻译管线用户，我希望装饰性元素（页眉条、右侧条带、行分隔线）可以被识别并降级处理，而不是参与内容级 lint/审查。
8. 作为开发者，我希望在 Converter 契约（真实 PDF → Document IR）这一个接缝上验证全部图像提取不变式。
9. 作为开发者，我希望新增的 image 字段（identity/kind/placements）通过既有 IR 序列化 round-trip 测试保证不回归。
10. 作为维护者，我希望图像分类阈值（图标尺寸、重复度、IoU、几何容差）可通过配置层调整，而不是改代码。
11. 作为维护者，我希望矢量图提取不再依赖"间隙光栅"启发式，而是基于 PDF 矢量路径。
12. 作为维护者，我希望有诊断脚本能输出"当前 IR vs PDF 真值"差异报告，作为优化前后的基线。
13. 作为审查/美化阶段用户，我希望 image-content 类 lint 误报大幅下降（图标/装饰不再被当成内容重叠）。
14. 作为测试工程师，我希望 test1（质量手册）与 test2（IMDS 报告）双文档回归，证明参数不针对单一文档调优。
15. 作为运行者，我希望提取产物（图片文件数、HTML 体积）明显下降，降低存储与传输成本。
16. 作为运行者，我希望在无法识别资源身份时仍能优雅降级（保留出现序号命名），不产生空 src。
17. 作为运行者，我希望不同文档类型（扫描件、学术论文、多栏排版）下的图像提取行为可预测、可配置。

## Implementation Decisions

### 1. 双路径权威域分配

| 维度 | 权威路径 | 权重 |
|---|---|---|
| 几何（位置/尺寸） | 代码路径（PDF bbox → 显示坐标） | 1.0 |
| 资源身份（xref/内容 hash/复用次数） | 代码路径 | 1.0 |
| 内容语义（文本、表格、标题、图像类别） | OCR 路径 | 1.0 |
| 结构（表行列、图标所属单元格） | 交叉校验：OCR 结构 + 代码几何对齐 | 联合 |

OCR det 块不再作为 image 块的几何来源；仅用于块划分与语义分类。

### 2. 图像身份层

- 以 `page.get_images(full=True)` 的 xref（缺失时用字节 hash）作为唯一键；
- 同一资源只提取一次，`src` 指向唯一资源文件（命名与源身份对齐，如 `img_x{ref}` 或内容 hash 前缀）；
- 所有出现位置以 `placements[]` 记录（page / bbox），渲染按 placements 放置；
- 跨页复用同一资源时不重复提取。

### 3. 图像分类层（kind）

- `content`：≥64px 或语义上属于内容图（logo/照片/插图）→ 独立 image 块；
- `icon`：<30px 且重复 ≥3 的行内标记 → 表格内归 cellImages，表格外归装饰层（默认不建独立块，可配置保留）；
- `decor`：页眉条/右侧条带/分隔线等 → 不参与内容级 lint 与审查；
- `vector`：改用 `page.get_drawings()` 的精确路径/bbox 提取，替代间隙光栅启发式。

### 4. 几何统一与对齐

- 所有块（文本/表格/图像）统一按同一 PDF→显示坐标换算（沿用现有 page 模型，dpi/宽度来自配置层）；
- 表格 bbox 用代码路径（文本 span 或 drawings 行线）校正，图标按"最近单元格"归位；
- 当 |OCR 几何 − PDF 几何| 超过配置容差时输出诊断记录（diff 报告），不静默选择。

### 5. 匹配算法

- 从"overlap>0.3 首个命中"改为：最大 IoU + 尺寸比 + 内容 hash 校验；
- 一个 OCR 块包含多个图标时全部挂入 cellImages/相邻图列表，不吞文本。

### 6. Document IR schema 扩展（来自现有 IR 契约的原型形状）

```ts
interface ImageSourceBlock extends BaseSourceBlock {
  type: "image";
  identity: { xref?: number; hash: string; sourceName?: string };
  kind: "content" | "icon" | "decor" | "vector";
  src: string; // 唯一资源文件，按 identity 去重
  placements: { page: number; x: number; y: number; width: number; height: number }[];
  alt: string;
}
```

序列化/反序列化、渲染器与 lint 随 schema 扩展；旧字段（src/alt/几何）保留兼容。

### 7. 渲染器与 lint

- 渲染器按 kind 决定输出：content → 独立 `<img>`；icon-in-cell → 表格 cellImage；decor → 背景层或跳过；
- lint 对 icon/decor 类豁免 image-content 重叠判定（目标区域无文本时不计问题）。

### 8. 配置化

- 图标尺寸阈值、重复度、IoU 阈值、几何容差、装饰判定规则全部进入既有 `ptl.config.json` / env 配置层（沿用 Phase 10 的 `PtlConfig` 结构，新增 `extraction` 段）。

## Testing Decisions

- **好测试的标准**：只测外部行为——给定真实 PDF，断言 Converter 输出 IR 满足不变式；不测试内部实现细节（不 mock 匹配算法内部步骤）。
- **主测试接缝（已与用户确认）**：`Converter.convert(input, options?) → Promise<DocumentIR>`，以真实 PDF 夹具（test1.pdf / test2.pdf）驱动，断言：
  - 唯一图片资源数（test2：141 独立块/350+ 文件 → ~10 资源）；
  - `src` 非空率 100%，且资源身份可对回源 PDF；
  - 图像几何与 PDF 真值偏差 ≤2px；
  - 文本/表格数据零丢失（CAS 号、物质名等关键内容回归）；
  - kind 分类正确（content/icon/decor/vector）。
- **附属测试接缝**：IR 序列化 round-trip（既有 `ir-serialization.test.ts`）与渲染器单测（既有 `pixel-perfect.test.ts` / `semantic.test.ts`），覆盖 schema 扩展不回归。
- **既有先例**：`test/integration/ir-pipeline.test.ts`（OCR payload → IR → HTML）、`scripts/verify-ir.ts`（真实 OCR 端到端统计）、`unlimited-ocr.test.ts`（normalizeOcrPayload）、`config.test.ts`（阈值配置）。
- **验收指标**：唯一资源文件数、位置误差 ≤2px、src 非空 100%、表格数据零丢失、image-content 误报数（test2：45 → 目标 <5）、HTML 体积下降、test1/test2 双回归全绿。

## Out of Scope

- 翻译/审查/美化阶段的语义与提示词修改；
- 训练或更换 OCR 模型；
- 文本与表格 OCR 识别精度本身（本次仅统一几何权威与图像层）；
- 新增 HTML 渲染器或改变渲染语义；
- issue tracker 自动化（本 spec 以仓库文档形式发布）；
- 除去重带来的隐式收益外的性能优化。

## Further Notes

- 数据事实（2026-08-02 test2 实测）：页 3 单页 153 次图像出现、unique xref = 1、唯一内容 ~10 个（md5 聚类）、代码路径坐标偏差 0、两坐标系相对漂移 5–20px。
- 实施路线（分阶段，先出基线再改）：阶段 A 诊断对比脚本 → 阶段 B 身份层+几何统一 → 阶段 C 分类/权重 → 阶段 D 渲染/契约 → 阶段 E test1/test2 双回归。
- 与既有 ADR 关系：本方案是 Converter 适配器内部的提取策略调整，不改变 Document IR 契约方向（符合 `0001-document-ir-as-pipeline-contract`），仅扩展 image 块载荷。
- 相关报告：`test/IR_TEST_REPORT.md` Phase 10（配置层）/ Phase 11（test2 泛化性测试）。
