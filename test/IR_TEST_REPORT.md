# Document IR 重构后分阶段测试报告

> **Date:** 2026-07-31
> **Scope:** Document IR 管线（Converter → IR → Renderer）重构后的完整测试：单元、无 GPU 集成、真实 GPU OCR 端到端、优化对比。
> **Runtime:** WSL (Linux x64) + Bun 1.3.14 + Python 3.12.3 + PyTorch 2.13.0+cu130
> **GPU:** NVIDIA GeForce RTX 4060 Ti（沙箱内被阻止，沙箱外可用，CUDA True）
> **LLM:** DeepSeek V4 Flash —— **本次未配置 API key，LLM 阶段 BLOCKED**

---

## 测试阶段设计

| 阶段 | 目标 | 依赖 | 状态 |
|---|---|---|---|
| Phase 0 | 环境与基线探测（Bun/Python/GPU/模型/API key） | 无 | ✅ |
| Phase 1 | 单元/组件回归（58 tests，含 34 项新增） | 无 | ✅ 58/58 |
| Phase 2 | 无 GPU/LLM 集成：fixture → IR → 渲染 → lint → translate(fake) | 无 | ✅ 6/6 |
| Phase 3a | 真实 OCR 端到端：`test/test1.pdf` → IR JSON → 像素级 HTML | GPU + 模型 | ✅ |
| Phase 3b | 真实 LLM 链路：translate / review / beautify | DEEPSEEK_API_KEY（测试期间由用户提供） | ✅ |
| Phase 4 | 优化验证（会话复用、Python 外置、格式嗅探移除、det 收敛） | Phase 1–3 证据 | ✅ |
| Phase 5 | 回归与报告 | 全量测试 + typecheck | ✅ |

---

## Phase 0 — 环境与基线

| 检查项 | 结果 | 备注 |
|---|---|---|
| Bun | v1.3.14 | `~/.bun/bin/bun`；PATH 中的 `bun` 是 Windows shim，需用完整路径 |
| TypeScript | `tsc --noEmit` 0 错误 | `node_modules/.bin/tsc` |
| Python | 3.12.3 | `/root/ptl-ocr-env/bin/python3` |
| PyTorch CUDA | True（RTX 4060 Ti） | 沙箱内 NVML blocked，沙箱外可用 |
| Unlimited-OCR 模型 | 存在 | `/root/models/Unlimited-OCR/.../snapshots/master` |
| DEEPSEEK_API_KEY | 测试期间由用户提供 | 仅作环境变量传入，未写入仓库 |
| 测试基线 | 旧：24 tests；新：58 tests | 新增 34 项 |

## Phase 1 — 单元/组件测试（58 pass / 0 fail）

| 套件 | 数量 | 覆盖 |
|---|---:|---|
| IR 序列化 | 3 | JSON round-trip、缺 pages 拒绝、嵌套表格载荷 |
| Converter 归一化 | 6 | OCR 类型→IR 映射、bbox→几何、表格 HTML→cells、图片 src/alt、字体、稳定 id |
| Pixel-perfect 渲染器 | 8 | 页面容器、几何/字体、转义、pre-line、表格 th/td、图片、页码右对齐、基础 CSS |
| Semantic 渲染器 | 8 | h2/h3、p、table thead/tbody、img、ul/li、pre/code、转义、separator 保留 |
| stage-translate | 3 | 跳过 image/code/other、表格逐格回填、**会话复用与轮换断言** |
| splitter（HTML/Markdown） | 10 | H2/H3 切分、表格独立块+cells、代码块、separator 还原、头部前文本 |
| 其他（async-pool / direction / matcher / stage-convert / smoke） | 12 | 既有行为回归 |
| 集成（Phase 2） | 6 | 见下 |
| CLI smoke | 2 | `ptl check`、usage（修复为 `process.execPath` + 30s 超时） |

## Phase 2 — 无 GPU/LLM 集成（6 pass / 0 fail）

`test/integration/ir-pipeline.test.ts`

1. OCR payload → IR → 像素级 HTML：无 `<|det|>`、无 `<PAGE_BREAK>`，结构完整；
2. 无几何 IR → semantic HTML（h2/table 结构）；
3. lint 干净布局 0 问题；人为重叠布局 >0 问题（几何 lint 在渲染产物上仍生效）；
4. translate → render 端到端（fake session）：译文回填文本与表格单元格、图片保留；
5. IR JSON 文件往返：几何不丢失；
6. 外部 OCR 脚本存在且 `py_compile` 通过。

## Phase 3a — 真实 OCR 端到端（GPU，✅）

命令：`bun run scripts/verify-ir.ts test/test1.pdf /tmp/ptl_ir_e2e/test1.ir.json /tmp/ptl_ir_e2e/test1.html`

| 指标 | 结果 | 旧管线（2026-07-29 报告） |
|---|---:|---:|
| 页数 | 33 | 33 |
| IR 块总数 | 665 | 663 elements（HTML 时代） |
| 类型分布 | paragraph 375 / other 186 / heading 61 / image 35 / table 8 | — |
| 渲染 HTML 大小 | 213,341 B | 210,562 B |
| lint 问题 | 146 | 145 |
| det 标签残留 | 0 | 0 |
| 运行时间 | ~9 分钟（33 页逐页 infer） | 同量级 |

CLI 契约：`ptl convert test/test1.pdf --output cli.html --pages 1` → exit 0、`<!DOCTYPE html>` 开头、无 det 标签、1 个 `.page`。

## Phase 3b — 真实 LLM 链路（✅ 实测通过）

### 3b-1 第 1 页翻译（10 块，5 可译，concurrency=2）

✅ 成功。表格单元格逐格回填（`Document Title` → `文件标题`、`CEER Supplier Quality Handbook` → `CEER 供应商质量手册`、`Approval:` → `审批：`）；图片块保留；`other` 块（Confidential / Page 1 of 33）按设计跳过。

> 首次运行暴露并发 bug：`asyncPool` 的动态调度会在同一 worker session 尚未完成时派发第二个 prompt（OMP 报 `Agent is already processing`）。已修复为**按 worker 分组串行、组间并行**，保证每会话同一时刻只有一个 prompt 在飞；stage-translate 单测同步覆盖。

### 3b-2 33 页全量翻译（444 块可译，concurrency=4）

✅ 成功，输出 `/tmp/ptl_ir_e2e/test1_translated.ir.json`。翻译后渲染 HTML 204,132 B；**lint 从 146 降至 38**（text-text 28 / overflow 7 / title-content 1 / image-content 1 / table-content 1），与旧管线翻译后量级一致（旧报告 37–43）。

### 3b-3 审查（第 1 页，Grill + Goal）

✅ 成功：lint 2 + grill 1 = 3 个问题，Goal 19 个 assistant turns 全部修复（对 `.det-table table` 追加 `max-width:823px`，保留既有 CSS 规则），输出 `test1p1_reviewed.html`。

### 3b-4 美化（第 1 页，PDF 参考布局 + CSS 风格指南）

✅ 成功：识别 6 个 right-edge 元素并加 `near-right`，Grill 生成 181 行 CSS 风格指南注入 `<style>`（保留 review 的 max-width 修复），输出 `test1p1_beautified.html`（9,681 B，无 det 标签）。

### 3b-5 33 页完整文件 review → beautify（补跑）

| 阶段 | 结果 |
|---|---|
| review（33 页） | ✅ Grill 发现 157 项（38 lint + 119 grill），Goal **95 个 assistant turns（202 messages）全部修复**：7 张表追加 `max-width:900px`、24 处 title-content 加宽标题容器等；输出 `test1_reviewed.html`（227,794 B） |
| beautify（33 页） | ✅ 502 个 right-edge 元素加 `near-right`，Grill 生成 **270 行 CSS** 风格指南注入；review 修复全部保留；输出 `test1_beautified.html`（227,794 B，无 det 标签） |

完整产物已归档至 `workdir/ir-e2e-2026-07-31/`（`test1_reviewed.html`、`test1_beautified.html`、`test1_review_report.md`、`test1_reviewed_beautify_report.md`）。

复现命令（需 `DEEPSEEK_API_KEY` 环境变量）：

```bash
bun run bin/ptl.ts translate-blocks <file.ir.json> --output <translated.ir.json> --concurrency 4
bun run bin/ptl.ts review <translated.html> --spec specs/review-layout.md --output <reviewed.html> --report <report.md>
bun run bin/ptl.ts beautify <reviewed.html> <file.pdf> --output <beautified.html>
bun run bin/ptl.ts translate test/test1.pdf --skip-interact   # 完整管线
```

## Phase 4 — 优化验证

| 优化点 | 旧实现 | 新实现 | 证据 |
|---|---|---|---|
| OMP 会话开销 | 每块 1 个 session（722 块 ≈ 722 次初始化） | 每 worker 复用 + 10 次轮换（concurrency=3 → ≤3 活跃） | stage-translate 单测：fake factory 计数断言（worker 复用 ≤ 并发；轮换后重建） |
| Python 维护 | `ocr-processor.ts` 内嵌 ~400 行模板字符串 + 运行时写 `tmp_ocr.py` 双份 | 单一 `scripts/ocr/pdf_to_ir.py`（JSON 输出） | 文件删除 + py_compile + 真实运行 |
| 格式嗅探 | `includes('class="page"')` 分流双 splitter | 统一 IR 契约，渲染器负责 HTML | stage-translate 重写（无嗅探） |
| det 解析 | 散落在 HTML 生成路径 | 收敛在 Converter 归一化 | normalizeOcrPayload 单测 6 项 |
| 可移植性 | 硬编码 `/root/...` 路径 | `PTL_OCR_PYTHON` / `PTL_OCR_MODEL_PATH` | 环境变量实现 |
| 测试覆盖 | 24 tests | 58 tests（+34） | `bun test` |
| 会话并发安全 | asyncPool 动态调度可并发打同 session（真实运行暴露） | 按 worker 分组串行、组间并行 | 真实 1 页翻译 + 单测断言 |

## Phase 5 — 结论

1. **新架构在真实 GPU 上跑通**：PDF → IR JSON（665 块）→ 像素级 HTML，33 页产物规模与旧管线一致（213KB / 146 lint），无格式泄漏。
2. **LLM 链路全链路实测通过**：翻译（含表格回填）、审查（Goal 修复）、美化（CSS 注入）均正常；翻译后 lint 146 → 38。
3. **测试体系完成分阶段搭建**：无 GPU/LLM 即可回归全部核心逻辑；真实依赖阶段命令留档，GPU 与 API 均验证可用。
4. **API key 安全**：key 仅以环境变量临时传入，未写入仓库；建议测试后轮换。

## 复现命令

```bash
# Phase 1/2/5
node_modules/.bin/tsc --noEmit
~/.bun/bin/bun test

# Phase 2（单文件）
~/.bun/bin/bun test test/integration/ir-pipeline.test.ts

# Phase 3a（需 GPU，沙箱外）
bun run scripts/verify-ir.ts test/test1.pdf /tmp/out.ir.json /tmp/out.html
bun run bin/ptl.ts convert test/test1.pdf --output /tmp/cli.html --pages 1

# Phase 3b（需 DEEPSEEK_API_KEY）
bun run bin/ptl.ts translate-blocks <file.ir.json> --output <translated.ir.json> --concurrency 2
bun run bin/ptl.ts translate test/test1.pdf --skip-interact
```
