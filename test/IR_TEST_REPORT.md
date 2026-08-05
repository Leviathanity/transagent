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

## Phase 6 — 表格修复后完整 33 页链路重跑 + interact 实测（2026-08-01）

表格修复（`5b2818a`）后，用修复代码重新跑完整 `test1.pdf`（33 页）全链路，并补齐此前未实测的 interact 阶段。

| 阶段 | 输入 → 输出 | 结果 |
|---|---|---|
| 3a 重跑 OCR | `test1.pdf` → `test1_final.ir.json` / `test1_final.html` | 33 页 / 665 块 / 8 表；**8 表列数全部一致（0 缺列）**；lint 146，与修复前一致（无回归） |
| 3b 翻译 | `test1_final.ir.json` → `test1_final_translated.ir.json` | 444 块，concurrency=4；译文 HTML lint 146 → 38 |
| 3b review | 译文 HTML → `test1_final_reviewed.html` | Grill 发现 39 项（修复前为 157 项）；Goal **108 assistant turns（226 messages）全部修复**；lint → 0 |
| 3b beautify | reviewed HTML + PDF → `test1_final_beautified.html` | 502 个 right-edge 加 `near-right`；288 行 CSS 注入；lint 0、0 det、8 表完整 |
| interact | beautified HTML → `test1_final_interacted.html` | 33 个 SourceBlock；全确认/skip round-trip 语义等价；编辑路径验证通过 |

### interact 阶段发现并修复的 3 个问题

1. **粒度**：splitter 只按 H2/H3/table/pre 切块，像素级 HTML 无 H2/H3 → 整份文档被当 1 个块，`e` 编辑会替换整个文档。修复：无标题结构时按顶层元素（页面 div）切块（`src/splitter/html-block-splitter.ts`）。
2. **管道输入**：Bun readline 在非 TTY 下 `close` 先于 `line` 触发（崩溃或挂起）。修复：`stageInteract` 改为 stdin 行队列读取，`close` 后未消费输入按 `s`（跳过）处理。
3. **外壳丢失**：`assembleHtmlBlocks` 只输出 body 内容，interact 会丢掉 `<head>`/`<style>`（整个 CSS 风格指南）。修复：保留 `<body>` 前后文档外壳。

已知限制：像素级 HTML 的 interact 粒度为**页面级**（编辑替换整页 div）；语义 HTML 渲染器才有标题级粒度。

### 测试与产物

- 全量测试 63 → **65 pass / 0 fail**（新增：splitter 像素级切块 round-trip、CLI interact 管道编辑冒烟）；`tsc --noEmit` 0 错误。
- 产物归档：`workdir/ir-e2e-final-2026-08-01/`（IR/译文/review/beautify/interact 全部 10 个文件 + 说明）。
- 最终输出：`workdir/ir-e2e-final-2026-08-01/test1_final_beautified.html`（lint 0、0 det、8 表完整、33 页）；interact 产物 `test1_final_interacted.html` 与之语义等价。

## Phase 7 — 图片自包含修复（2026-08-01）

**问题**：转换阶段把图片导出为 `emb_*.png`/`vect_*.png` 旁车文件，HTML 只写相对路径；归档时未复制图片 → 所有归档 HTML 破图（38/38 引用悬空）。深层原因：IR 只存裸文件名，渲染产物依赖"HTML 与图片同目录"的隐式约定，资产打包责任外推给使用方。

**修复（方案 1：渲染/输出时内嵌 data URI）**：

1. 新增 `src/utils/inline-images.ts`：
   - `inlineDocumentImages(ir, imageDir)`：IR 层内嵌（image 块 + 表格 cellImages），渲染器保持纯函数不变；
   - `inlineHtmlImages(html, imageDir)`：HTML 层内嵌，用于既有产物；
   - 文件缺失/不可读时保留原引用（不崩溃），data/http 引用原样跳过。
2. 接入点：
   - `ptl convert --output`：转换输出即自包含；
   - 完整管线：review/beautify 中间阶段**保持相对引用**（避免 Goal 代理把 2.9MB base64 读进 LLM 上下文），最终输出（含 interact 后）自动内嵌；
   - 新增 `ptl inline-images <file.html> [--image-dir <dir>] [--output <path>]` 命令，可对既有 HTML 做自包含化。
3. 产物：`workdir/ir-e2e-final-2026-08-01/` 全部 HTML 已替换为内嵌版（38 张图 → data URI，约 2.9–3.0 MB），lint 0、0 det、8 表完整。

**测试**：新增 `inline-images` 单测 7 项（嵌入/缺失保留/data·http 透传/IR 不突变/HTML 层替换）；全量 **72 pass / 0 fail**，`tsc --noEmit` 0 错误。

## Phase 8 — 页眉翻译 + 页眉/元数据重叠修复（2026-08-01）

**问题 1：页眉未翻译**。第 1 页标题在表格单元格内已译；第 2–30 页 running header 是独立块，OCR `header` → 归一化为 `other`，翻译按设计跳过。

**问题 2：页眉与正文重叠（24/33 页，22–26px）**。根因链：
1. OCR 给页眉块宽 327px，Chrome 实测 "CEER SUPPLIER QUALITY" @27.5px Times 实际宽 333px → `white-space:pre-line` 多折一行（2 行 → 3 行，82.5px → 123px），盒底 197 侵入正文顶 173；
2. lint 旧度量（0.55em、整段长度、固定 1.5 行高）把 3 行算成 2 行（底 158 < 173）→ 检测不到；
3. Grill 39 项清单无此问题 → Goal 只修清单 → 漏网。PDF 原文实测页眉两行、正文 y104 起，无重叠——问题由我们的渲染引入。

**修复**：
1. `translation-prompts.ts`：`other` 块改为可译（image/code 仍跳过）；stage-translate 去重缓存使 29 个同文页眉只调 1 次 LLM（630 块可译，译文 "CEER 供应商质量手册"）。
2. 新增 `src/utils/text-metrics.ts`（CJK 1em / 拉丁 0.65em / 加粗 0.7em，按显式行估算），`multiLineStyle` 用保守宽度折行并去掉重复 `width` 属性。
3. `lint.ts`：逐行估算 + 解析真实 `line-height` + 重复 `width` 取最后值 + `max-width` 不当作 `width`（表格块用它封顶）。
4. `stage-review` 增加 TableStructureGuard：Goal 代理偶发追加空单元格（页 31 表格 5,5,6,5），`repairTableStructure` 按众数列修复。

**重跑结果**（完整 33 页，LLM 实测）：translate 630 块 → review 74 项（42 lint + 32 grill，196 assistant turns 全修）→ beautify 288 行 CSS。最终文件：**lint 0、0 det、8 表完整、页眉 30 页浏览器实测 0 重叠、页眉已译中文**；归档 `workdir/ir-e2e-final-2026-08-01-v2/`（HTML 均为自包含内嵌版）。

**测试**：全量 **88 pass / 0 fail**（+12：text-metrics 4、lint 回归 3、table-repair 4、translation-prompts 2，另更新 stage-translate/renderer 断言），`tsc` 0 错误。

## Phase 9 — 测试结果展示服务器（2026-08-01）

新增 `ptl serve`（`scripts/serve-results.ts` / `src/utils/result-server.ts`）：

- 默认监听 **0.0.0.0**（局域网可访问），默认根目录 `workdir/ir-e2e-final-2026-08-01-v2`；`--port`/`--root` 可覆盖；
- 自动目录索引（文件名/大小/上级目录），正确 MIME（html/md/json/png 等），路径穿越防护（`resolveWithinRoot`）；
- 启动时打印本机、局域网（自动探测非内部 IPv4）访问地址。

```bash
bun run bin/ptl.ts serve            # 或 bun run serve / npm run serve
# 浏览器打开 http://localhost:8080/，局域网设备打开 http://<LAN-IP>:8080/
```

验证：服务器单测 4 项（索引、MIME、嵌套目录、404；沙箱禁止 listen 时自动 skip），实测 0.0.0.0:8080 索引与 2.85MB 最终 HTML 均 200；全量测试 **89 pass / 5 skip / 0 fail**，`tsc` 0 错误。

## Phase 10 — 全仓审计整改：配置层 + 去硬编码/去耦合清理（2026-08-02）

审计结论：分层架构健康（IR 契约/Converter 接缝/纯函数渲染器/通用提示词），但存在机器路径硬编码、与 test1 样本/归档名耦合、魔法阈值不可配等问题。本次整改：

1. **统一配置层** `src/utils/config.ts`：优先级 CLI > env（`PTL_OCR_PYTHON`/`PTL_OCR_MODEL_PATH`/`PTL_PAGE_WIDTH`/`PTL_WORK_DIR`/`PTL_REVIEW_SPEC`/`PTL_*_MODEL` 等）> `ptl.config.json`（或 `PTL_CONFIG` 指定）> 内置默认；新增 `ptl.config.example.json`。
   - OCR：python/model/outputDir、推理参数（imageSize/maxLength/ngramWindow 等）、启发式阈值（dedup/font/image overlap/vector gap/non-white）全部可配，`pdf_to_ir.py` 改为从 args 读取；
   - 页面模型（width/dpi/modelSize）消除三重重复：converter 传参、beautify 内嵌脚本注入、渲染器隐式一致；
   - 管线：`--review-spec`/`--work-dir`/模型 env 兜底（bin/ptl.ts、orchestrator）、TOC 短行阈值、lint `minOverlapY`、beautify 近边/右移阈值、result-server 默认根改为**自动选最新归档**。
2. **方向检测修正**：`ptl translate` 不再读取 PDF 二进制前 500 字节（永远误判 en2zh），改为转换后基于 IR 文本自动检测；`--direction` 仍可显式指定。
3. **清理与去耦合**：
   - 根目录 10 个 test1 样本 HTML 归档至 `workdir/legacy-root-artifacts-2026-08-02/` 并从 git 移除；
   - 删除旧类型 `types/source-block.ts`、未使用的 `source-block-splitter(.test).ts`、omp-session 死代码（旧 HTML 时代提示词）；splitter/translation-prompts 迁移到 `document-ir` 类型。

测试：**94 pass / 0 fail**（新增 config 4 项、pickLatestArchive 1 项；移除旧 splitter 3 项），`tsc` 0 错误。已知保留：OCR/模型默认路径仍指向本机（可用 env/配置覆盖）、review 规范仍与像素渲染器绑定（语义渲染器需配套规范，后续可加）。

## Phase 11 — test2.pdf 泛化性分阶段测试（2026-08-02）

**目的**：用完全不同类型的文档（IMDS MDS 材料数据报告，4 页 A4、Helvetica、密集表格 + 141 个小图标）验证框架通用性。

| 阶段 | 结果 |
|---|---|
| Phase 1 单元/回归 | 94 pass / 0 fail |
| Phase 3a 真实 OCR | 4 页 / 202 块（other 36 / heading 7 / paragraph 12 / table 6 / image 141）；6 表列数全部一致；lint 59（45 项 image-content 为小图标噪声） |
| Phase 3b 翻译 | 61 块可译 / 0 TOC 误分组；页眉、日期、专业术语翻译正确；CAS 号（1333-86-4 等）与 EPDM 等原文保留 |
| review | 60 项（55 lint + 5 grill），23 assistant turns 全修（含第 1 页并排表格 max-width 修复）；lint 55 → 3 |
| beautify | 13 near-right + 251 行 CSS；浏览器实测：页 1 最大重叠 2px、页 2 最大 7px、页 3/4 单对 292px |
| interact | 全确认/skip round-trip 通过 |
| 最终文件 | lint 3（盒模型误报）、0 det、6 表完整、163 图内嵌、自包含（125KB） |

**分析结论**：
1. 核心链路（OCR→IR→翻译→review→beautify）对完全不同的文档类型泛化良好；表格一致性、术语保留、TOC 判定均正常。
2. 新暴露问题一：行内 17x17 小图标被拆成 141 个 image 块（test1 仅 35 个）→ lint 45 项 image-content 误报、review 成本上升；建议 OCR 后过滤/合并 30px 以下图标。
3. 新暴露问题二：页 3/4 右侧 170x30pt 装饰条压在表格空白单元格上（PDF 该区域无文本）→ 292px 为盒模型误报；lint 无"图片压空白区"判定。
4. review 修复效率高（23 turns vs test1 的 196 turns），结构性修复（并排表格 max-width）有效。

产物归档：`workdir/ir-e2e-test2-2026-08-02/`（原始英文 HTML、IR、译文、review/beautify/interact + 报告 + README，HTML 均为自包含内嵌版）。

## Phase 12 — 图像提取双路径权重实施（2026-08-02）

依据 `docs/specs/2026-08-02-image-extraction-dual-path-weighting.md` 实施（阶段 A–D 代码完成，阶段 E 真实 GPU 回归待环境允许后执行）：

### 代码改动

1. **身份层**：`pdf_to_ir.py` 用 `get_image_info(xrefs=True, hashes=True)` 建立唯一资源表（xref/内容 hash），同一资源只提取一次（`img_x{xref}.png`），跨页/跨方向复用不重复建文件；出现位置以 `placements[]` 记录。
2. **分类层（placement 级）**：`placement_kind` 先判 decor（细长分隔线/右缘条带），再判 icon（最大边 <40px 且重复 ≥3，如 17×17 树级图标、19×36 行标记），其余为 content；配置项进入 `PtlConfig.extraction`。
3. **几何统一**：图像块几何一律来自 PDF bbox（代码路径），OCR det 不再作为图像几何来源；文本/表格块保持 OCR 语义，冲突留待诊断。
4. **表格吸收**：icon/decor 不建独立块；表格内 icon → `cellImages`，表格外 icon/decor 丢弃。
5. **矢量路径**：`get_drawings()` 填充路径聚类取代"间隙光栅"启发式，输出 `kind=vector` 块。
6. **IR 契约扩展**：image 块新增 `identity`/`kind`/`placements`；渲染器跳过 icon/decor、content 带 `data-kind`；lint 对 icon/decor 豁免。
7. **诊断脚本**：`scripts/diagnose-images.py` 输出 PDF 真值 vs IR 差异报告。

### test2 实测（优化前 vs 优化后，2026-08-02 真实 GPU/LLM 回归）

| 指标 | 优化前 | 优化后（实测） |
|---|---:|---:|
| PDF 图片放置 | 223 | 223 |
| 唯一资源（xref/hash） | 11 | 11 |
| 提取文件数 | 223（144 重复） | 11 |
| IR 独立 image 块 | 141 | **1** |
| 表格 cellImages | 82 | **66**（4 个唯一图标资源） |
| 提取后 lint | 59（45 项 image-content 噪声） | **10** |
| 原始英文 HTML | 120,316 B | **32,712 B** |
| 翻译后 lint | 55 | **10** |
| review | 60 项 / 23 turns | **17 项 / 59 turns** |
| 最终文件 | 127,764 B | **71,589 B**（自包含，lint 1 为盒模型误报） |
| 几何偏差 >5px / 空 src | 0 / 0 | 0 / 0 |

真实回归全部通过：223 处放置 → 11 个唯一资源文件；图标（194 处）进表格 cellImages、装饰（28 处）丢弃、内容图保留 1 块；表格数据零丢失（CAS/EPDM 完好）；LLM 链路翻译/审查/美化/交互跑通。遗留：页 1 顶部 IMDS 标志为矢量/表单对象，矢量路径未捕获（前后版本均未提取，后续扩展 get_drawings/Form XObject）。

test1 推演：36 处放置全部 content，块数与现状持平（无回归风险，待真实回归确认）。

产物归档：`workdir/ir-e2e-test2-2026-08-02-v2/`（自包含 HTML + README）；HTTP 展示：`ptl serve`（默认根自动选最新归档）。

全量测试 99 项（0 fail，5 项沙箱 skip），`tsc` 0 错误，`py_compile` 通过。

## Phase 13 — 小图标回填修复（2026-08-03）

**问题**：提取阶段大量小图标未回填（219 处仅 66 处进表格），且回填位置错误（渲染器按行高估算 + 插入末列）。

**根因（三层）**：
1. 表格 bbox 来自 OCR det、图标来自 PDF 坐标，两套坐标系导致边缘/表头带图标被 50% 交叠阈值丢弃（页 2 表格 bbox 仅覆盖 875–1205，48 个图标只回填 8 个）；
2. cellImages 无 row/col，渲染器用"表格高/行数"均匀估行、把图标插进该行最后一个 `<td>`——列必然错位；
3. 表格外图标被静默丢弃。

**修复**：
1. 图标归属改为"中心落入表格 bbox（±80px 容差）"→ cellImages；表格外图标保留为独立 icon 块（精确 PDF 坐标）；
2. cellImages 渲染改为表格容器内**绝对定位覆盖层**（按相对 left/top 精确定位），废除行高估算与末列猜测；
3. WSL 检测抽为公共 `src/utils/wsl.ts`（binfmt 标记缺失时用 /proc/version + /mnt/c 兜底），修复 WSL 重启后 beautify 误走 `wsl` 包装；
4. `diagnose-images.py` 新增 backfill.coverage 指标。

**实测（test2 v3）**：覆盖率 66/218（30%）→ **194/218（89%）**（113 cellImages + 81 独立块；剩余 24 个为 decor 分隔线，按设计丢弃）；几何偏差 p50 0.74px / max 1.09px；最终 lint 0、0 det、6 表完整、CAS/EPDM 保留；全链路 review 19 项 / 52 turns、beautify 228 行 CSS。

归档：`workdir/ir-e2e-test2-2026-08-02-v3/`（自包含 HTML + README）；HTTP 展示 `http://192.168.2.118:8080/`。

## Phase 14 — 网格/单元格级图标回填（2026-08-03，test2 v5）

**问题**：v3 仍有 81 个独立 icon 块显示在表格外。取证确认图标绝对坐标正确
（218/218 落在 PDF 矢量网格外框内），但 OCR det table bbox 是"文字包围盒"
（p1 网格 y=48..1353 vs OCR bbox y=875..1205），回填误用 OCR bbox 当表格区域。

**修复**（计划 `docs/superpowers/plans/2026-08-03-grid-cell-backfill.md`）：

1. `pdf_to_ir.py` 新增代码路径**表格网格提取**（矢量线连通分量 → 外框/行列/单元格），
   含无 GPU 的 `grids_only` 调试模式；`doc.close()` 移到脚本末尾（原实现中
   `get_drawings()` 在 close 后必然抛异常，v3 的 vector 提取实际从未执行）；
2. **OCR 表格 ↔ 网格对齐**：表格 geometry 以网格外框为准，OCR 文字经
   `contentOffset` 保持在 PDF 真值位置（IR schema 新增 `contentOffset`，
   渲染器输出内层绝对定位 table）；OCR 漏检时创建 grid-only 表；
3. **单元格级回填**：图标中心落入 cell → cellImages（新增 row/col）；
4. **lint 盒模型修正**：`.det-table` 按 contentOffset + CSS max-width 计算真实渲染盒，
   消除中文表格文字长度估算的溢出误报。

**实测（test2 v5，真实 GPU + DeepSeek 全链路）**：

| 指标 | v3 | v5 |
|---|---:|---:|
| cellImages | 113 | **194** |
| 独立 icon 块 | 81 | **0** |
| 非 decor 回填率 | 89% | **100%（194/194，全部带 row/col）** |
| DOM 实测位置偏差 | — | p50 0.54px / max 0.71px（194/194 在表格内） |
| 转换 lint | 10 | 10（与 v3 完全一致） |
| 最终 lint | 0 | **0** |
| 全量单测 | 98 | **101 pass / 0 fail**（新增 contentOffset 渲染、converter 透传、lint 盒模型） |

全链路：translate 61 块 → review（10 lint + 3 grill，106 turns）→ beautify
（20 near-right + 204 行 CSS）→ interact。CAS/EPDM 原文保留，最终文件自包含。

归档：`workdir/ir-e2e-test2-2026-08-03-v5/`；HTTP 展示 `http://192.168.2.118:8080/`。

### Phase 14 补充 — DevTools 实测最终输出（2026-08-03，v6）

用 Chrome DevTools（CDP，`scripts/verify-backfill-dom.ts`）对 **review/beautify
后的最终文件**逐图标对拍，发现并修复一个回归：

**问题**：review/beautify 的 "Structural repair" 会把"绝对定位 div 嵌套在
绝对定位 div 内"的元素平铺到 `.page` 根。图标覆盖层 `.det-table-imgs`
（absolute）嵌套在 `.det-table`（absolute）内，被移出后 containing block
从表格原点变成页面原点，194 个图标全部位移（第 1 页偏左 635px、上移 48px）。
v5 的转换/翻译文件正确，最终文件错误；v3 最终文件同样受影响。

**修复**：`pixel-perfect.ts` 将覆盖层改为静态包装（不参与嵌套判定），
绝对定位 `<img>` 仍以 `.det-table` 为 containing block；重跑
review（68 turns）→ beautify（23 near-right + 277 行 CSS）→ interact。

**实测（test2v6_interacted.html）**：194/194 图标与 IR/PDF 位置匹配
（≤2px，p50 0.54px / max 0.71px），194/194 落在网格表格内；
表格原点偏差 0px、contentOffset 偏差 0.3px；表格外 content 图位置偏差 0px；
图标可见性经 computed style + 截图像素确认。最终 lint 7（均为盒模型估算误报，
Chrome 实测无重叠/溢出）。单测 102 pass（新增覆盖层静态断言与 lint 盒模型）。

归档：`workdir/ir-e2e-test2-2026-08-03-v6/`（最终输出）；v5 仅保留中间产物。

## Phase 15 — 网格驱动表格（2026-08-03，test2 v8）

**问题**：v6 的图片绝对位置正确，但重构表格是"OCR 内容驱动"的语义表
（行高=文字高度、22 行 ≠ 网格 10 行、盒偏移 204px），图标相对"当前表格"错位。

**修复**（spec `docs/specs/2026-08-03-grid-driven-table-backfill.md`）：

1. **网格驱动渲染**：重构表格盒 = PDF 网格盒（fixed layout + colgroup +
   tr 行高 = 网格边界，`box-sizing:border-box`）；
2. **OCR → 网格映射**：PDF 文本 spans 定位 OCR 单元格 → row/col + colspan，
   `gridLayout` 存 `srcRow/srcCol` 引用（翻译 headerRows/rows 后自动流入）；
   两阶段匹配（独特文本锚行 → 短数字按最近 y 消歧）；不匹配文本（`-5` 树级别
   数字、OCR 错拼）丢弃，真实内容已在页面文本块；
3. **图标进 td**：`td{position:relative}` + `img{position:absolute}` 相对单元格，
   colspan 覆盖列也收集；文本 wrapper 用 CSS class 绝对定位（不撑行高、
   不触发 review 内联 absolute 平铺）；
4. lint：colspan 列结构 + table×页眉/页码盒重叠豁免。

**实测（test2 v8 全链路）**：

| 指标 | 结果 |
|---|---:|
| 重构表格盒 = 网格盒 | 3/3（原点/宽高一致） |
| 图标在所属 td 内 | 194/194 |
| 图标绝对位置偏差 | p50 0.86px / max 1.66px，0 个 >2px |
| 文本映射 | 187/231 项进入网格单元格，抽样位置=网格行（Carbon black→行8、Tree Level→行9） |
| 最终 lint | 0 |
| review 结构修复 | 不再破坏图标（td 内 img + class wrapper） |
| 全量单测 | 105 pass / 0 fail |

归档：`workdir/ir-e2e-test2-2026-08-03-v8/`；HTTP `http://192.168.2.118:8080/`。

## Phase 16 — 去耦修复：消歧通用化 + 转置修复 + 兜底降级（2026-08-04，test2 v10）

**问题**：v8 暴露两个通用性缺陷——① OCR 把 IMDS 宽表转置输出（PDF 行=属性、
列=物质；OCR 行=物质、列=属性），映射时同名同 y 文本（左右两组物质）消歧失败，
右组全部叠加到左组列；② 表头 span 右缘仅越过列边界 0.8px 被误判 colspan=2，
吞掉 col1 物质；③ 映射失败文本静默丢弃、无兜底。

**修复（全部通用算法/配置，无文件特判）**：

1. 消歧：候选少优先锚定 → 行内 x/y 参考 + 候选占用标记（一个 span 只分配一次）；
2. colspan：span 中心定列，仅明显越过边界（`gridColspanEps=3px`）才扩展；
3. 兜底：无 PDF 文本层或覆盖率 < `gridMinCoverage`（30%）→ 回退语义表渲染，
   文本不丢；`mappingStats` 写入 IR + stderr 日志，未匹配可追溯；
4. 配置化：`gridMinCoverage`/`gridColspanEps` 进 `PtlConfig.extraction`。

**实测（v10）**：

| 指标 | 结果 |
|---|---:|
| PDF 真值逐格命中 | 页 2 33/33（100%）、页 3 73/95（77%）、页 4 58/70（83%） |
| 未匹配 | 均为 OCR 拼写/`-5` 拆分（`Non-tyre`、`Paraffin-olis`），无位置错误 |
| 页 3 名称行 | 20 列物质与 PDF 真值一致（EPDM/炭黑/…/EPDM 海绵/EPDM×2/炭黑/…） |
| 图标 | 194/194 在 td 内，p50 0.86px / max 1.66px |
| 最终 lint | 0 |
| test1 回归（前 3 页） | 无网格 → 降级语义表，表格文本完整保留 |
| 全量单测 | 105 pass / 0 fail |

归档：`workdir/ir-e2e-test2-2026-08-04-v10/`；HTTP `http://192.168.2.118:8080/`。

## Phase 17 — 竖排文字还原（2026-08-04，test2 v11）

**问题**：v10 行列已与 PDF 一致（物质横排、逐格对拍 100%/77%/83%），但源 PDF
单元格文字**竖排（旋转 90°）**——`rawdict` 字符坐标 x 相同、y 逐字排列；
渲染横排后 31px 窄列内长物质名换行，视觉上仍像"转置"。

**修复**：

1. 提取层检测竖排 span（bbox 高 > 宽×1.3 且多字符），`gridLayout` 项记录
   `vertical`；渲染器 `writing-mode:vertical-rl` 还原；
2. 页 0 语义表历史 lint 经第二轮 review 收敛（max-width + 标题 nowrap）。

**实测（v11 最终）**：

| 指标 | 结果 |
|---|---:|
| lint | 0 |
| 页 3 名称行 | 21 个竖排单元格（EPDM/炭黑/石蜡油/…），与 PDF 竖排一致 |
| 图标 | 194/194 在 td 内，p50 0.86px / max 1.66px |
| 覆盖/降级 | 78-84%；test1 无网格降级语义表不丢文本 |
| 全量单测 | 105 pass / 0 fail |

归档：`workdir/ir-e2e-test2-2026-08-04-v11/`；HTTP `http://192.168.2.118:8080/`。

## Phase 18 — DevTools 全量验证 + 竖排/colspan 细节修复（2026-08-04，test2 v13）

**修复**：

1. 竖排检测改为 rawdict 字符坐标（`[g]`/`[%]` 短文本不再漏判）；
2. OCR 合并 span 的 colspan 收敛为 1（不吞相邻列，修复页 4 丢 cell）；
3. `merge_spans` 继承 vertical 方向；
4. 新增 `scripts/verify-final-devtools.ts`：CDP 对最终文件逐项对拍
   （lint/图标/表格盒/行列结构/文本落格/竖排方向/独立图）。

**实测（v13 最终输出，DevTools）**：

| 指标 | 结果 |
|---|---:|
| lint | 0 |
| 图标 | 194/194 匹配 ≤2px、td 内、网格内（p50 0.86 / max 1.66） |
| 文本落格 | 164/164（页2 33、页3 73、页4 58） |
| 竖排方向 | 164/164 |
| 表格结构 | 3/3 origin 0、行列匹配 |
| 全量单测 | 105 pass / 0 fail |

归档：`workdir/ir-e2e-test2-2026-08-04-v13/`（含 `DEVTools_verify.json`）；
HTTP `http://192.168.2.118:8080/`。

## Phase 19 — 页面旋转根因修复（2026-08-05，test2 v15）

**根因**：源 PDF 第 2-4 页 `rotation=90`（横向页面，rect 842×595），提取层
一直按第 1 页纵向尺寸处理且未应用页面旋转 → 文本/网格/图标坐标整体旋转 90°，
表格视觉"转置/竖排"。v8-v14 的"竖排还原"是在错误坐标系上的错误还原；
Kimi 视觉审查（与用户判断一致）最终指向方向问题。

**修复**：每页按 `page.rotation` 构建显示元数据，所有原始坐标经
`page.rotation_matrix`（原始→显示）转换；每页独立显示尺寸（页 2-4 横向
1024×723）；竖排检测基于转换后字符坐标。

**实测（v15）**：

| 指标 | 结果 |
|---|---:|
| 页面方向 | 页 2-4 横向，与源 PDF 一致 |
| 文本方向 | 竖排 0，全部横排 |
| 网格 | 页 3 = 21 行 × 10 列（行=物质，转置消失） |
| 图标 | 194/194 在 td 内，vs PDF 真值 p50 0.26px |
| 文本裁剪 | DevTools 0 处 |
| lint | 3（Chrome 实测无重叠，盒模型误报） |

归档：`workdir/ir-e2e-test2-2026-08-05-v15/`；HTTP `http://192.168.2.118:8080/`。

## Phase 20 — 单元格文字自动避让图标（2026-08-05，test2 v16）

**问题**：图标绝对定位回填到 td 后，文字仍从单元格左缘开始，与图标重叠，
未参与单元格排版。

**修复**：文字起始位置按本 cell 图标右缘计算（`iconPadLeft`），图标保持
PDF 精确位置；无图标 cell 不变。

**实测（v16）**：图标与文字重叠 cell = 0；194/194 图标在 td 内
（p50 1.26px）；lint 0；页面横向/横排保持。

归档：`workdir/ir-e2e-test2-2026-08-05-v16/`；HTTP `http://192.168.2.118:8080/`。

## Phase 21 — 单元格富文本自动排版（2026-08-05，test2 v17）

**问题**：表头长文字在固定网格行高内被 `overflow:hidden` 截断（v16 实测 26 处）。
beautify 提示词两轮尝试均不可靠（CSS overflow-wrap 无效；LLM 改行高破坏布局）。

**修复**：文本 wrapper 改为 in-flow，td 高度为最小值、行高按内容自动扩展；
图标保持绝对定位精确位置，文字 margin-left 避让。

**实测（v17）**：裁剪 26 → **0**；图标/文字重叠 0；194/194 图标在 td 内；
lint 3（既有盒模型误报）。

归档：`workdir/ir-e2e-test2-2026-08-05-v17/`；HTTP `http://192.168.2.118:8080/`。

## 附录：表格缺边框问题（2026-07-31 诊断与修复）

**现象**：提取阶段部分表格行内列数不一致（`test1` 8 表中 3 表：`[6,6,5,5,5]`、`[6,5,5]`、`[5,4,5,5]`），缺列即缺边框，且穿透翻译/审查/美化直达最终输出。

**根因**：`parseTableHtml` 对单元格做 `.filter(c => c.length > 0)`，OCR 表格中的**空单元格被丢弃**；渲染器按行内 cells 原样输出，行内 `<td>` 数量不一致 → CSS 无法为不存在的单元格画边框。

**为什么最终输出未解决**：review/beautify 均为样式层修复（Goal 约束禁止改表格结构、beautify 只注入 CSS），CSS 不能为缺失的 `<td>` 画边框；IR 数据从提取阶段就缺列，问题一路保留。

**修复**：
1. `parseTableHtml` / `parseMarkdownTable`：保留空单元格，并按全表最大列数补齐（`src/utils/table-cells.ts`）；
2. 双渲染器 `tableInnerHtml` / `renderTable`：输出前按最大列数补齐 `<td>/<th>`（防御兜底）；
3. `lintHtml` 新增 `table-column-mismatch` 结构检测（`src/utils/lint.ts`）。

**重验**：重跑前 31 页真实 OCR（`test1_fixed.ir.json` / `test1_fixed.html`），7 个表格 IR 层与渲染 HTML 层列数**全部一致（0 缺列）**；全量测试 58 → 63（新增 table-cells 3 项 + 渲染器补齐 1 项 + lint 检测 1 项），全部通过。

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
