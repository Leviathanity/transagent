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
