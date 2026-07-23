# Glossary

## 管线概念

- **SourceBlock**: 翻译的最小输入单元 — 一个按 H2（主）和 H3（辅助）分割、内部连续正文段落合并的语义完整 Markdown 块。替代原 `Paragraph` 概念。
- **TranslationUnit**: 翻译的输出单元 — 包含原始 SourceBlock 和译文的一对一映射。
- **翻译单元 (Semantic Block)**: SourceBlock 的同义泛称，指管线中一次翻译操作的输入粒度。

## 审查概念

- **审查规范文件**: 预定义的 Markdown checklist 文件，在审查阶段注入 AgentSession 的 system prompt，定义检查项和严重度分级。
- **审查轮次**: Goal 模式下一次"扫描→发现问题→修复→重新扫描"的完整循环。

## 翻译概念

- **术语表驱动一致性**: 翻译一致性**仅**通过术语表强制执行 — 术语表中已定义的词必须使用指定翻译。术语表未覆盖的术语不保证跨 SourceBlock 一致，不一致问题由阶段④审查检出，阶段⑤人工确认。

## 会话管理

- **Per-Stage Session**: 每个管线阶段独立创建和销毁 OMP AgentSession。不跨阶段复用 session，避免上下文污染和 token 浪费。每个阶段注入不同的 system prompt（审查规范/术语表+翻译规则）。

## 审查机制

- **规范注入方式**: 审查规范文件内容通过 session 创建时的 system prompt 注入；待审查文件仅通过路径引用传入。Agent 使用内建 `read` 工具自行读取文件内容，避免大文件嵌入 prompt。
- **两段式审查流程**: ① Grill 阶段 — 按规范文件类别逐类进行多轮 prompt（每类一次 LLM 调用），聚焦检查并逐类追加问题到报告文件，遍历完所有类别生成完整问题清单；② Goal 阶段 — 以问题清单为目标，逐项修复并验证，全部修复完成即退出。
- **Grill 不修复**: Grill 阶段只检查并输出问题清单，不做任何文件修改。

## 代理定义

- **Agent Prompt 文件**: `src/agents/` 下的 `.ts` 文件导出 system prompt 和 task prompt 模板常量，供各阶段 stage 使用。不是 OMP 子代理定义（`.agent.md`）。子代理定义由 OMP 的 `discoverAgents` 从项目根目录 `agents/` 自动发现。

## 拆分与拼合

- **切口保留 (Separator Preservation)**: splitter 不仅切分 SourceBlock，还记录每个块之前的原始分隔符。拼合时通过 `separatorBefore + translated` 精确还原原文件布局。
- **表格隔离**: 表格（含表头和分隔行）始终作为独立 SourceBlock 拆分，不与其他正文合并。保证翻译子代理可以将表格作为整体处理，维持列对齐和结构完整性。

## 翻译控制

- **方向自动检测**: 未指定 `--direction` 时，通过字符集启发式检测（CJK 字符占比 >30% → zh2en），并向用户确认后再执行。指定方向时跳过检测。
- **术语表注入方式**: 术语表不用于预处理替换原文，而是格式化为文本片段注入翻译子代理的 prompt。`matcher.ts` 的职责是将 JSON 术语表格式化为 LLM 可读的 prompt 上下文，不做原文修改。

## 错误处理

- **翻译失败标记**: 子代理翻译失败（重试后仍失败）的 SourceBlock，保留原文并包裹在 `<!-- TRANSLATION_FAILED: 原因 -->` 和 `<!-- /TRANSLATION_FAILED -->` HTML 注释中。不影响文件结构，用户可在阶段⑤发现并手动处理。
