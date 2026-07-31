# Glossary

## 管线概念

- **Document IR（文档中间表示）**: 转换阶段产出的规范化文档模型 — `Document { pages }` → `Page { width, height, blocks }` 的层次结构；Block 是判别联合（heading / paragraph / table / image / list / toc / other），几何字段（bbox）仅在像素级定位时存在；table 块载荷为 headerRows/rows + 可选列宽行高 + 单元格内嵌图片引用，image 块载荷为 src/alt + 几何。HTML 只是它的序列化形式之一，不是管线内部的传输格式。*（2026-07-31 架构访谈确认：Q1 选型 + Q2 形态 + Q3 载荷）*
- **Converter（转换器）**: 将 PDF（或任意输入文档）转换为 Document IR 的适配器，契约形态为 `convert(input, options?) → Promise<DocumentIR>`。OCR 引擎细节（det 标签、坐标系、字体匹配）被封装在 Converter 内部，不泄漏到下游阶段。*（2026-07-31 架构访谈确认：Q1 选型 + Q4 契约）*
- **Renderer（渲染器）**: 将 Document IR 序列化为 HTML 的纯函数。语义 HTML 与像素级 HTML 是两种渲染器：前者用于无几何/降级路径，后者用于 OCR 默认路径；渲染产物是审查/美化/交互等视觉阶段的输入。*（2026-07-31 架构访谈确认：Q10 渲染策略）*
- **SourceBlock**: 翻译的最小输入单元 — Document IR 中的块，判别联合（heading / paragraph / table / image / list / toc / other），可携带可选几何（bbox）。"按 H2/H3 分割、连续正文段落合并"是语义 HTML 拆分/渲染的实现约定，不是定义本身。*（2026-07-31 架构访谈确认：Q7 术语裁决）*
- **TranslationUnit**: 翻译的输出单元 — 包含原始 SourceBlock 和译文的一对一映射。
- **翻译单元 (Semantic Block)**: SourceBlock 的同义泛称，指管线中一次翻译操作的输入粒度。

## 审查概念

- **审查规范文件**: 预定义的 Markdown checklist 文件，在审查阶段注入 AgentSession 的 system prompt，定义检查项和严重度分级。
- **审查轮次**: Goal 模式下一次"扫描→发现问题→修复→重新扫描"的完整循环。

## 翻译概念

- **术语表驱动一致性**: 翻译一致性**仅**通过术语表强制执行 — 术语表中已定义的词必须使用指定翻译。术语表未覆盖的术语不保证跨 SourceBlock 一致，不一致问题由阶段④审查检出，阶段⑤人工确认。

## 会话管理

- **Per-Stage Session**: 每个管线阶段独立创建和销毁 OMP AgentSession，不跨阶段复用，避免上下文污染。翻译阶段按并发 worker 复用会话（每 N 块轮换），把初始化开销从 O(块数) 降到 O(并发数)。每个阶段注入不同的 system prompt（审查规范/术语表+翻译规则）。*（2026-07-31 架构访谈确认：Q6 会话策略）*

## 审查机制

- **规范注入方式**: 审查规范文件内容通过 session 创建时的 system prompt 注入；待审查文件仅通过路径引用传入。Agent 使用内建 `read` 工具自行读取文件内容，避免大文件嵌入 prompt。
- **两段式审查流程**: ① Grill 阶段 — 按规范文件类别逐类进行多轮 prompt（每类一次 LLM 调用），聚焦检查并逐类追加问题到报告文件，遍历完所有类别生成完整问题清单；② Goal 阶段 — 以问题清单为目标，逐项修复并验证，全部修复完成即退出。
- **Grill 不修复**: Grill 阶段只检查并输出问题清单，不做任何文件修改。

## 代理定义

- **Agent Prompt 文件**: `src/agents/` 下的 `.ts` 文件导出 system prompt 和 task prompt 模板常量，供各阶段 stage 使用。当前管线不使用 OMP 子代理定义（`.agent.md`），`agents/` 目录已移除。*（2026-07-31 架构访谈确认：Q8 死文件清理）*

## 拆分与拼合

- **切口保留 (Separator Preservation)**: splitter 不仅切分 SourceBlock，还记录每个块之前的原始分隔符。拼合时通过 `separatorBefore + translated` 精确还原原文件布局。
- **表格隔离**: 表格（含表头和分隔行）始终作为独立 SourceBlock 拆分，不与其他正文合并。保证翻译子代理可以将表格作为整体处理，维持列对齐和结构完整性。

## 翻译控制

- **方向自动检测**: 未指定 `--direction` 时，通过字符集启发式检测（CJK 字符占比 >30% → zh2en），并向用户确认后再执行。指定方向时跳过检测。
- **术语表注入方式**: 术语表不用于预处理替换原文，而是格式化为文本片段注入翻译子代理的 prompt。`matcher.ts` 的职责是将 JSON 术语表格式化为 LLM 可读的 prompt 上下文，不做原文修改。

## 错误处理

- **翻译失败标记**: 子代理翻译失败（重试后仍失败）的 SourceBlock，保留原文并包裹在 `<!-- TRANSLATION_FAILED: 原因 -->` 和 `<!-- /TRANSLATION_FAILED -->` HTML 注释中。不影响文件结构，用户可在阶段⑤发现并手动处理。
