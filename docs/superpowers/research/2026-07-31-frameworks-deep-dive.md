# 外部框架深度理解：pdf-translator（DeepWiki 调研）

> 调研日期：2026-07-31
> 方法：以 DeepWiki 的仓库级文档为主要来源（每个结论附 DeepWiki 页面 URL 及其引用的源码路径/行号），并用官方 README、arXiv 论文与本地仓库源码交叉验证。本地文件引用均相对于本仓库 `/mnt/c/Users/daemo/workplace/pdf-translator`。

## 0. 项目与外部框架全景

pdf-translator 是一个基于 Bun/TypeScript 的 PDF 中英互译 CLI（`ptl`），五阶段管线：① Convert（PDF→HTML）→ ② Translate（逐块翻译）→ ③ Review（Lint + Grill + Goal 审查修复）→ ④ Beautify（对照 PDF 原版式微调 CSS）→ ⑤ Interact（人工逐段确认），见 `src/pipeline/orchestrator.ts`。

| 框架 | 版本/来源 | 在本项目中的角色 | DeepWiki 页面 |
|---|---|---|---|
| Oh My Pi（OMP）`@oh-my-pi/pi-coding-agent` | ^17.0.8（can1357/oh-my-pi，monorepo） | LLM 会话/子代理/审查/翻译/美化 | deepwiki.com/can1357/oh-my-pi |
| Unlimited-OCR | baidu/Unlimited-OCR（MIT）；本项目权重来自 ModelScope `PaddlePaddle/Unlimited-OCR` | PDF→像素级定位 HTML 的 OCR 引擎 | deepwiki.com/baidu/Unlimited-OCR |
| MarkItDown | microsoft/markitdown | 曾用于 PDF→Markdown，现仅 `ptl check` 探测 | deepwiki.com/microsoft/markitdown |
| linkedom | WebReflection/linkedom ^0.18.13 | 服务端 DOM 解析：HTML 拆分、lint、表格修复、结构校验 | deepwiki.com/WebReflection/linkedom |
| execa | sindresorhus/execa ^9.6.1 | 子进程执行（WSL 内 Python OCR / PDF 布局提取） | deepwiki.com/sindresorhus/execa |
| PyMuPDF (fitz) | pymupdf/PyMuPDF | PDF 300DPI 渲染、文本/字体/图像信息提取 | deepwiki.com/pymupdf/PyMuPDF |
| HuggingFace Transformers + PyTorch | transformers / torch（CUDA） | 加载并运行 Unlimited-OCR 模型（bfloat16） | deepwiki.com/huggingface/transformers |
| DeepSeek API | Anthropic 兼容端点（经 OMP pi-ai 提供商层） | 翻译/审查/美化模型（默认 `deepseek/deepseek-v4-flash`） | 见 OMP AI Model Integration |

---

## 1. Oh My Pi（OMP）—— 项目的中枢 AI 框架

### 1.1 它是什么

OMP 是一个终端优先的 AI 编程代理平台，主体为 TypeScript（运行在 Bun 上），性能敏感部分用 Rust 实现；聚合 50+ 模型提供商，提供 `read`/`write`/`edit`/`bash` 等工具、会话管理与上下文压缩（DeepWiki Overview：packages/coding-agent/package.json3-5、packages/ai/package.json3-5）。

仓库是 Bun workspace 单体仓库，与本项目直接相关的是 `pi-coding-agent`（CLI、工具、会话管理、SDK）、`pi-agent-core`（代理执行引擎与状态管理）、`pi-ai`（统一 LLM API/流式归一化）、`pi-catalog`（模型元数据）、`pi-tui`、`pi-natives`（Rust N-API）、`pi-mnemopi`（长期记忆）、`snapcompact`（上下文压缩）（DeepWiki Overview：bun.lock4-230）。

### 1.2 分层架构

DeepWiki 的 Architecture 页（https://deepwiki.com/can1357/oh-my-pi/3-session-management）把系统分为五层：

1. **交互层**：CLI / TUI / RPC / ACP / Collab 共享会话；
2. **会话层**：`AgentSession` 与 SDK 抽象，负责 prompt 管理、会话状态与持久化（packages/agent/package.json5）；
3. **AI 模型层**：`pi-ai` 统一多提供商、模型发现、流式接口（packages/ai/package.json5）；
4. **工具层**：内置工具 + 扩展工具 + MCP 工具的统一注册/执行（packages/coding-agent/package.json5）；
5. **原生层**：Rust 高性能实现（grep、shell/PTY、AST 搜索）通过 N-API 暴露（packages/natives/package.json4）。

请求流为：CLI 入口（src/cli.ts）→ `AgentSession`（状态与持久化，JSONL 存于 `.omp/sessions/`）→ `pi-agent-core` 代理循环 → `pi-ai` 流式 LLM 调用 → 工具执行（DeepWiki Architecture + Agent Sessions 页）。

### 1.3 关键机制

**AgentSession**（DeepWiki Agent Sessions 页，即 https://deepwiki.com/can1357/oh-my-pi/4-core-components）：
- 会话历史是**树结构**，支持分支/复现；会话以 UUIDv7 标识；
- 事件实时持久化到 JSONL（crash recovery、导出）；
- 自动监控 token 阈值并在接近上下文窗口时触发压缩（策略：context-full、handoff、snapcompact 视觉归档）；
- 统一承载交互、Print、RPC 等全部运行模式。

**SDK `createAgentSession()`**：程序化创建会话的入口（本地包源码 `node_modules/@oh-my-pi/pi-coding-agent/src/sdk.ts:1198`），支持 `modelPattern`、`systemPrompt`、工具集、会话存储等选项；返回 `{ session }`。

**AI 模型层**（DeepWiki AI Model Integration 页，即 https://deepwiki.com/can1357/oh-my-pi/5-agent-session）：
- `ModelRegistry` 做模型发现与路由；模型目录来自内置 models.json + 动态发现（Ollama/LMStudio/vLLM）+ models.dev 价格数据；
- 流式事件统一为 `AssistantMessageEventStream`（text / thinking / tool call）；
- Anthropic 系提供商支持 interleaved thinking、effort 分级、prompt caching；
- DeepSeek 走 OpenAI/Anthropic 兼容实现，因此本项目 `DEEPSEEK_API_KEY` + `deepseek/deepseek-v4-flash` 的 modelPattern 能直接工作。

**工具系统**（DeepWiki Tool System 页，即 https://deepwiki.com/can1357/oh-my-pi/7-extensibility）：
- 内置 `read`/`write`/`edit`/`bash` 等；`edit` 默认 hashline 模式，用 4-hex 内容哈希做稳定行寻址与陈旧检测（DeepWiki File Editing 页）；
- 自定义工具、扩展工具、MCP 工具统一注册；工具输出有截断与 artifact 溢出机制；
- `task` 工具可派生子代理并行执行，支持隔离文件系统（DeepWiki Tool System：packages/coding-agent/src/task/index.ts1-15）。

**子代理发现 `discoverAgents`**：从工作目录（及插件注册表）扫描 `agents/` 目录加载 `.agent.md` 子代理定义（本地包源码 `node_modules/@oh-my-pi/pi-coding-agent/src/task/discovery.ts:70`、`src/task/index.ts:101` 导出）。

**Goal 运行时**：`AgentSession.goalRuntime`（`src/session/agent-session.ts:1947` 定义、`:8228` 暴露）提供 `createGoal()`——把"目标→逐项自主执行→调用 complete 结束"变成受控的自动循环，代理每轮工具循环都会向 Goal 状态汇报进度。

### 1.4 在本项目中的用法

| 位置 | 用法 |
|---|---|
| `src/utils/omp-session.ts:8` | `createReviewSession()`：以审查规范全文作为 systemPrompt 创建 session |
| `src/utils/omp-session.ts:30` | `createGoalFixSession()`：注入问题清单 + "逐项修复后用 read 验证、全部完成后用 goalTool 标记 complete" |
| `src/utils/omp-session.ts:52` | `createTranslateSession()`：注入术语表与翻译规则 |
| `src/pipeline/stage-translate.ts:20-33` | 每个 SourceBlock **新建**一个 session，`session.prompt(prompt, { toolChoice: "none" })` 纯文本输出，`getLastAssistantMessage()` 取结果，`dispose()` 销毁 |
| `src/pipeline/stage-translate.ts:45-62` | TOC 目录项批量翻译同模式 |
| `src/pipeline/stage-review.ts:59` | Grill 阶段：一个审查 session 输出问题清单 |
| `src/pipeline/stage-review.ts:102-121` | 修复阶段：`grillSession.goalRuntime.createGoal({objective: ...})` 创建自主修复目标，随后 `prompt()` 启动、`waitForIdle()` 等待完成 |
| `src/pipeline/stage-beautify.ts:386` | 美化阶段动态 import `createAgentSession` |
| `agents/translator.agent.md` | 子代理定义，按项目约定由 OMP `discoverAgents` 从根目录自动发现（见 `CONTEXT.md`） |
| `bin/ptl.ts:55,89,147,215-217` | 各命令默认 `deepseek/deepseek-v4-flash` |

项目刻意采用 **Per-Stage Session**：每个阶段独立创建/销毁 OMP 会话，避免上下文污染与 token 浪费（`CONTEXT.md` 会话管理节）。

### 1.5 值得注意的机制与风险

- 翻译阶段逐块创建/销毁 session，隔离性好但每次都有会话初始化和模型注册开销；OMP 自带 `task` 并行子代理（隔离文件系统）可作为替代并发模型。
- Goal 模式是"自主修复闭环"，本项目在 `stage-review.ts:102` 用 10 条硬约束（不得删除 CSS 规则、不得嵌套 absolute div、元素总数不减少等）约束 Goal 代理，配合 OMP 的 goalTool 完成信号，效果可见于 git 历史中的多次修复提交。
- hashline 编辑机制对并发文件修改安全，未来若引入并行子代理写同一文件，OMP 的编辑层已内置保护。

---

## 2. Unlimited-OCR —— PDF→像素级 HTML 的 OCR 引擎

### 2.1 它是什么

Unlimited-OCR 是百度开源的端到端文档解析模型，主打 **One-shot Long-horizon Parsing**：把整份多页文档或高分辨率图片在**一次前向推理**中解析为结构化输出（Markdown/JSON/HTML），而不是"切块再识别"或逐页独立识别（DeepWiki Overview：README.md27-28）。模型以 DeepSeek-OCR 为基础，MIT 协议（DeepWiki 1.1 页：README.md1-3、LICENSE1-21）。

论文（arXiv:2606.23050，官方 README 引用）核心创新是 **Reference Sliding Window Attention（R-SWA）**：把解码器全部注意力层替换为 R-SWA，解码全程 KV Cache 保持恒定，从而在标准 32K 长度下一次转录几十页文档，且输出延迟不随页数线性增长；论文同时指出 R-SWA 可推广到 ASR、翻译等任务。

### 2.2 架构与双后端

官方仓库结构（DeepWiki 1.2 页：Repository Structure and Key Files）：
- `infer.py`：批量推理 CLI，自动拉起 SGLang server（`--attention-backend fa3`、`--context-length 32768`），`ThreadPoolExecutor` 并发处理图片/PDF，带 `get_response_with_retry` 重试（infer.py126-350）；
- `wheel/`：定制 SGLang 开发版 wheel（`sglang-0.0.0.dev11416+g92e8bb79e`），用于支持 `DeepseekOCRNoRepeatNGramLogitProcessor` 长文重复抑制（README.md38-40）；
- `Unlimited-OCR.pdf`：技术论文；`assets/`：架构图与演示。

推理参数（DeepWiki 1.1 页 + 官方 README）：
- **单图两种配置**：`gundam`（`base_size=1024, image_size=640, crop_mode=True`，高分辨率切片）与 `base`（`base_size=1024, image_size=1024, crop_mode=False`，标准解析）；
- **多页/PDF 仅用 base**：官方推荐 `model.infer_multi(tokenizer, prompt='<image>Multi page parsing.', image_files=[...], image_size=1024, max_length=32768, no_repeat_ngram_size=35, ngram_window=1024)`；
- PDF 流程：PyMuPDF 以 300 DPI 逐页渲染 PNG → `infer_multi`（官方 README：pdf_to_images，dpi=300）；
- 重复抑制：`no_repeat_ngram_size=35` + `ngram_window=128/1024` 的 n-gram logit processor，防止长文无限循环（README.md76-88）。

输出中的 `<|det|>type [x1,y1,x2,y2]<|/det|>` 标签携带块类型与 bbox，官方 README 提供 OmniDocBench 后处理的 `DET_RE` 参考实现。

### 2.3 在本项目中的用法

`src/utils/ocr-processor.ts` 在运行时把整段 Python 脚本写入 `tmp_ocr.py`，经 execa 交给 WSL 内的 Python 虚拟环境执行（`/root/ptl-ocr-env/bin/python3`）：

1. **模型加载**：`AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)` + `AutoModel.from_pretrained(..., use_safetensors=True, dtype=torch.bfloat16).eval().cuda()`（ocr-processor.ts:29-33；模型路径为 `/root/models/Unlimited-OCR/models/PaddlePaddle--Unlimited-OCR/snapshots/master`，由 `scripts/deploy-ocr.sh` 从 ModelScope 部署）。
2. **PDF 渲染**：PyMuPDF 以 300/72 矩阵渲染每页 PNG（`fitz.Matrix(300/72, 300/72)`），页面尺寸换算为 300DPI 像素（2481×3508 等）。
3. **逐页推理**：`model.infer(tok, prompt="<image>document parsing.", base_size=1024, image_size=1024, crop_mode=False, max_length=32768, no_repeat_ngram_size=35, ngram_window=128)`，每页后打印 `<PAGE_BREAK>` 分隔（tmp_ocr.py:95-99）。推理期间把 stdout 重定向到 `io.StringIO` 捕获输出。
4. **det 标签解析**：正则 `DET_RE = <\|det\|>(\w+)\s+\[(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\]\s*<\|/det\|>` 解析块类型（header/footer/page_number/title/table/image/paragraph 等）与模型空间 bbox（[0,1024]），再做近重复块去重。
5. **PDF 字体/图像融合**（项目自研后处理）：把 OCR bbox 与 PyMuPDF `get_text("dict")` 的 span bbox 做重叠匹配，继承字体族/字号/粗斜体/颜色；用 `get_image_info()` 裁剪嵌入图片并与 OCR 块重叠匹配；检测文本块之间的"矢量图形间隙"并裁剪为图片块。
6. **HTML 生成**：按 bbox 绝对定位生成 `.page` 容器 + `position:absolute` 文本/表格/图片 div（1024px 宽显示坐标系），表格内再嵌入行内图片。

### 2.4 与官方推荐用法的差异（重要）

当前实现是**逐页 `infer` + `<PAGE_BREAK>` 拼接**（`ngram_window=128`），而官方对 PDF/多页场景推荐 **`infer_multi`（一次推理处理多页）+ `ngram_window=1024`**。逐页方式会丢失跨页上下文（如跨页表格、章节延续），且重复抑制窗口较小；这是多页文档质量提升的最直接优化点。项目还强制**串行推理**并注释"CUDA + sys.stdout 非线程安全"（ocr-processor.ts:109-118），而官方 `infer.py` 支持并发批处理；SGLang/vLLM 后端（radix attention、定制 logit processor）可作为批量生产的吞吐升级路径。

---

## 3. MarkItDown —— 已被替换的历史转换器

### 3.1 它是什么

MarkItDown 是微软开源的 Python 工具，把 20+ 种文档格式（DOCX/XLSX/PPTX/PDF/HTML/图片/音频/邮件等）转换为面向 LLM 的 Markdown（DeepWiki Overview：README.md29-34）。架构为三层层：CLI / Python API / MCP server 三个入口 → `MarkItDown` 类编排（`convert()`/`convert_stream()`/`convert_local()`）→ 按优先级注册的格式转换器；可选集成 Azure Document Intelligence、Azure Content Understanding、LLM 视觉标注（DeepWiki Overview）。仓库为 monorepo，含 `markitdown`、`markitdown-mcp`、`markitdown-ocr` 插件包。

### 3.2 在本项目中的历史角色

- 最初设计：`docs/superpowers/specs/2026-07-23-pdf-translator-design.md` 把 `markitdown[all]` 列为外部依赖，stage-convert 用 `execa markitdown` 子进程转换 PDF。
- 迁移：`docs/superpowers/plans/2026-07-24-html-pipeline-migration.md` 明确"**Replace markitdown with Unlimited-OCR as the PDF converter**"，管线从 Markdown 切换到 HTML，原因之一是测试对比：MarkItDown 输出 85KB Markdown，Unlimited-OCR 输出 210KB 像素级定位 HTML（`test/TEST_REPORT.md`）。
- 现状：仅 `bin/ptl.ts:182` 的 `ptl check` 仍探测 `markitdown --version` 并提示 `pip install 'markitdown[all]'`，作为环境诊断/潜在降级路径保留。

---

## 4. linkedom —— 服务端 DOM 解析

### 4.1 它是什么

LinkeDOM 是为 SSR/DOM-less 环境设计的轻量 DOM 实现（DeepWiki Overview：README.md17-19）。核心创新是**三链表结构**：节点通过 `NEXT/PREV/END/START` 符号属性连接，增删移操作 O(1)，可处理 1200 万+ 节点文档；刻意不做浏览器模拟（无 live collection、无渲染/网络/存储），API 覆盖 SSR 所需子集；提供标准入口、`linkedom/cached`（WeakMap 缓存查询，适合静态文档反复读取）与 `linkedom/worker` 三种入口。依赖 htmlparser2（解析）、css-select（选择器）、cssom（样式）等。

### 4.2 在本项目中的用法

| 位置 | 用途 |
|---|---|
| `src/splitter/html-block-splitter.ts:35,125,179` | `parseHTML()` 把 HTML 解析为 DOM，按 H2/H3/表格等语义切分 SourceBlock，或对像素级 HTML 按 `.page` 内 `position:absolute` div 切块 |
| `src/utils/translation-prompts.ts:37` | 从表格 HTML 提取单元格文本 |
| `src/utils/lint.ts:54` | 几何重叠检测（并手工处理 linkedom 不提供 `<img>` alt 文本的问题，lint.ts:76） |
| `src/utils/table-repair.ts:9` | 表格结构修复 |
| `src/pipeline/stage-review.ts:142-143` | Goal 修复后结构校验/去嵌套 |
| `src/pipeline/stage-beautify.ts:77,360` | 解析翻译后 HTML 与 PDF 布局对比、注入 CSS |

注意：项目用的是默认（非缓存）入口，适合频繁 DOM 变更；lint/beautify 中大量只读 `querySelectorAll` 若成为瓶颈，可评估 `linkedom/cached`。

---

## 5. execa —— 子进程执行

### 5.1 它是什么

Execa 是基于 Node `child_process` 的现代子进程库（DeepWiki Overview：readme.md41-44）：Promise API、`$` 模板字符串语法（自动转义防 shell 注入）、跨平台、本地 bin 解析、流式 I/O、IPC（`sendMessage`/`getOneMessage`）、优雅取消与结构化错误。主要方法：`execa` / `execaSync` / `$` / `execaCommand` / `execaNode`。

### 5.2 在本项目中的用法

- `src/utils/ocr-processor.ts:530-535`：在 Windows 侧以 `wsl` 调 WSL 内 Python（或 WSL 内直接执行），超时 1,200,000ms，捕获 stdout 作为 OCR 产物；
- `src/pipeline/stage-beautify.ts:70-71`：同模式调用 Python 提取 PDF 布局，超时 60,000ms；
- `bin/ptl.ts:182-189`：`ptl check` 探测 `markitdown`/`python` 版本。

---

## 6. PyMuPDF —— PDF 渲染与信息提取

### 6.1 它是什么

PyMuPDF 是基于 MuPDF C 引擎的高性能 PDF/文档库（DeepWiki Overview：README.md27-28），架构为五层：MuPDF C 内核 → C++ 封装 → SWIG 绑定 → Python API（`Document`/`Page`/`Annot`）→ 用户代码。版本号与 MuPDF 内核绑定（如 1.27.x 对应 MuPDF 1.27.x）。核心 API：`open()`、`get_text()`、`get_pixmap()`、`find_tables()` 等（DeepWiki Overview：docs/the-basics.rst174-178、README.md157-158）。

### 6.2 在本项目中的用法

- `tmp_ocr.py:17-26`（即 ocr-processor.ts 内嵌脚本）：`fitz.open(pdf)` + `Matrix(300/72,300/72)` 渲染 300DPI 页面 PNG；
- `tmp_ocr.py`：`get_text("dict")` 提取文本块/行/span 的 bbox、字体名、字号、粗斜体 flags、颜色，用于 OCR 块字体匹配；`get_image_info()` 获取嵌入图片 bbox 并裁剪；
- `src/pipeline/stage-beautify.ts` 内嵌脚本：同样用 `get_text("dict")` 输出参考布局 JSON，供美化阶段与翻译后 HTML 对比；
- `scripts/pdf_text_extract.py`、`scripts/dual_path_test.py`：OCR 与 PDF 直接提取的双路径对比测试。

注意：PyMuPDF 核心库为 AGPL 许可（DeepWiki Overview：README.md84-87），作为本地内部工具使用影响有限，若对外分发需评估许可影响。

---

## 7. HuggingFace Transformers + PyTorch —— OCR 模型运行时

### 7.1 它们是什么

Transformers 是模型定义/加载框架（DeepWiki Overview）：三大核心类 `PreTrainedConfig`/`PreTrainedModel`/`PreTrainedTokenizerBase`+`ProcessorMixin`；`AutoModel`/`AutoTokenizer`/`AutoConfig`/`AutoProcessor` 依据 checkpoint 配置自动选择实现（`MODEL_MAPPING_NAMES` 等懒加载映射）；提供 `Pipeline` 与 `generate()` 等高层 API，是 HF Hub（100 万+ checkpoint）与 vLLM/SGLang/TGI 等推理引擎之间的枢纽（DeepWiki Overview：src/transformers/models/auto/modeling_auto.py41-490）。

PyTorch 提供张量计算、`bfloat16` 半精度与 CUDA 设备管理；本项目只用到推理路径。

### 7.2 在本项目中的用法

- `src/utils/ocr-processor.ts:29-33`：`AutoTokenizer.from_pretrained(..., trust_remote_code=True)` + `AutoModel.from_pretrained(..., use_safetensors=True, dtype=torch.bfloat16).eval().cuda()`，随后调用模型自定义的 `model.infer()`（远程代码来自 Unlimited-OCR 仓库）；
- `scripts/ocr_prompt_test*.py`、`scripts/dual_path_test.py`：多个 prompt 实验（Free OCR / document parsing / markdown / grounding），用同一加载方式；
- 官方 README 建议的环境：Python 3.12.3 + CUDA 12.9、torch 2.10.0、transformers 4.57.1、pymupdf 1.27.2.2 等，可作为 WSL 环境排障基准。

注意：`trust_remote_code=True` 会执行仓库自带 Python 代码，模型来源需可信（本项目固定本地路径 + ModelScope 官方仓库）。

---

## 8. DeepSeek API —— 经 OMP 提供商层的 LLM 后端

DeepSeek 通过 OMP `pi-ai` 的 OpenAI/Anthropic 兼容实现接入，不是独立本地框架。项目默认模型 `deepseek/deepseek-v4-flash`（`bin/ptl.ts:55,89,147,215-217`），鉴权用 `DEEPSEEK_API_KEY`（`bin/ptl.ts` 环境检查），审查/翻译/美化阶段可分别用 `--review-model` / `--translate-model` / `--beautify-model` 覆盖。OMP 的模型层统一处理流式输出、thinking 级别与 prompt caching（DeepWiki AI Model Integration 页），因此本项目调用侧只需 `modelPattern` 即可。

---

## 9. 框架 → 管线阶段映射

| 管线阶段 | 主要文件 | 使用的框架 |
|---|---|---|
| ① Convert | `src/pipeline/stage-convert.ts` → `src/utils/ocr-processor.ts`（写入 `tmp_ocr.py`） | Unlimited-OCR、Transformers、PyTorch、PyMuPDF、execa（WSL） |
| ② Translate | `src/pipeline/stage-translate.ts`、`src/utils/translation-prompts.ts` | OMP `createAgentSession`、linkedom |
| ③ Review | `src/pipeline/stage-review.ts`、`src/utils/lint.ts`、`src/utils/table-repair.ts` | OMP（Grill + Goal）、linkedom |
| ④ Beautify | `src/pipeline/stage-beautify.ts` | OMP、PyMuPDF、linkedom、execa |
| ⑤ Interact | `src/pipeline/stage-interact.ts` | OMP |
| 环境诊断 | `bin/ptl.ts`（check） | execa、MarkItDown（遗留探测） |
| 子代理定义 | `agents/translator.agent.md` | OMP `discoverAgents` |

---

## 10. 从 DeepWiki 得到的优化启发

### OMP 侧
1. **翻译并发模型**：当前逐块新建 session（隔离但开销大）；OMP `task` 工具支持隔离文件系统的并行子代理，且 hashline 编辑对并发写安全，可评估替代 `asyncPool` + 每块独立 session 的方案。
2. **Goal 模式已经是项目核心资产**：`goalRuntime.createGoal` 的"目标→自主循环→complete"闭环配合严格约束 prompt，是 review 修复阶段的主力；后续可以让 Beautify 阶段也复用同模式（git 历史显示 Beautify 已从 LLM Goal 改为代码注入 CSS，属有意识取舍）。
3. **上下文管理**：OMP 内置 token 阈值压缩与 snapcompact，若未来审查超长文档，可在"每阶段独立 session"之外启用自动压缩策略，减少人为控制成本。
4. **模型路由**：pi-catalog/ModelRegistry 支持动态发现与价格统计，多模型（flash 翻译 + 更强模型审查）已由 CLI 参数支持，可进一步用 OMP settings 固化。

### Unlimited-OCR 侧
1. **多页路径**：官方推荐 `infer_multi` + `ngram_window=1024`；当前逐页 `infer` + `ngram_window=128` 是最大质量提升机会（跨页表格/上下文、长文重复抑制）。
2. **高分辨率模式**：`gundam`（`image_size=640, crop_mode=True`）适合密集小字单页，可针对扫描件启用。
3. **生产后端**：SGLang（定制 wheel + radix attention + 定制 logit processor）或 vLLM（官方已支持）能显著提升吞吐与长上下文稳定性；`infer.py` 自带并发与重试，可替代当前串行推理。
4. **det 标签协议**：官方 OmniDocBench 后处理示例可作为解析器的扩展参考（当前正则只匹配 `\w+ [x,y,x,y]` 形态）。

### 其他
- MarkItDown 保留为无 GPU 环境降级转换器是低成本选项（`ptl check` 已探测）。
- linkedom 默认入口适合频繁 DOM 变更；只读密集的 lint/beautify 可评估 `linkedom/cached`。
- PyMuPDF 版本与 MuPDF 内核绑定、官方 OCR 环境建议固定版本，升级时需回归 300DPI 渲染与 `get_text("dict")` 输出兼容性。

---

## 参考来源

### DeepWiki
- Oh My Pi：https://deepwiki.com/can1357/oh-my-pi（Overview）、/3-session-management（Architecture）、/4-core-components（Agent Sessions）、/5-agent-session（AI Model Integration）、/6-tools（Operational Modes）、/7-extensibility（Tool System）、/8-context-management（File Editing）
- Unlimited-OCR：https://deepwiki.com/baidu/Unlimited-OCR（Overview）、/1.1-project-background-and-motivation、/1.2-repository-structure-and-key-files
- MarkItDown：https://deepwiki.com/microsoft/markitdown
- linkedom：https://deepwiki.com/WebReflection/linkedom
- execa：https://deepwiki.com/sindresorhus/execa
- PyMuPDF：https://deepwiki.com/pymupdf/PyMuPDF
- Transformers：https://deepwiki.com/huggingface/transformers
- PaddlePaddle/Unlimited-OCR 在 DeepWiki 有页面但正文未生成，本项目以 baidu/Unlimited-OCR 页面为准。

### 官方一手来源
- Unlimited-OCR 官方 README：https://github.com/baidu/Unlimited-OCR
- 论文摘要（R-SWA / 恒定 KV Cache）：https://arxiv.org/abs/2606.23050

### 本地来源
- `package.json`（依赖版本）、`CONTEXT.md`（OMP 会话/子代理约定）
- `src/utils/omp-session.ts`、`src/pipeline/stage-translate.ts`、`src/pipeline/stage-review.ts`、`src/pipeline/stage-beautify.ts`、`src/pipeline/orchestrator.ts`
- `src/utils/ocr-processor.ts`、`tmp_ocr.py`、`scripts/*.py`、`scripts/deploy-ocr.sh`
- `src/splitter/html-block-splitter.ts`、`src/utils/translation-prompts.ts`、`src/utils/lint.ts`、`src/utils/table-repair.ts`
- `docs/superpowers/specs/2026-07-23-pdf-translator-design.md`、`docs/superpowers/plans/2026-07-24-html-pipeline-migration.md`、`test/TEST_REPORT.md`
- `node_modules/@oh-my-pi/pi-coding-agent/src/sdk.ts`、`src/session/agent-session.ts`、`src/task/discovery.ts`
