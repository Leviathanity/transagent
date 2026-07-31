# 以 Document IR + Converter 作为管线中间契约

**Status**: accepted

管线内部不再用 HTML 字符串作为中间传输格式，而是统一为 Document IR：`Document { pages }` → `Page { width, height, blocks }`，Block 是判别联合（heading / paragraph / table / image / list / toc / other），几何（bbox）可选；table 块携带 headerRows/rows/列宽行高/单元格内嵌图片引用，image 块携带 src/alt/几何。HTML 只在出入口由渲染器序列化。PDF（或任意输入）到 IR 的转换由 Converter 适配器承担，契约为 `convert(input, options?) → Promise<DocumentIR>`；OCR 引擎细节（det 标签、坐标系、字体匹配、WSL/Python/模型路径）封装在适配器内部，不泄漏到下游。`SourceBlock` 术语保留，重定义为"Document IR 中的块"，H2/H3 分割降级为语义 HTML 渲染器的实现约定。

## Considered Options

- **HTML 字符串作为 IR**（否决）：导致格式嗅探（`class="page"`）、双 splitter、interact 阶段只支持其中一种格式、lint/beautify 各自重复解析 HTML；换 OCR 引擎等于重写 stage-convert。
- **扁平 `Block[]` 不引入 Page**（否决）：几何只有在页面坐标系里才有意义；beautify 的参考布局与 review 的页面级检查会丢失容器信息。
- **流式/分页 Converter 契约**（否决）：当前管线是整文档操作，async iterable 的复杂度收益不成比例；未来需要时可在同一契约上加 `iterPages` 变体。
- **保留 `agents/*.agent.md` 子代理机制**（否决）：代码实际使用 `src/agents/*.ts` 的 systemPrompt，子代理定义是死文件，已删除。

## Consequences

- 新 OCR 引擎 = 新增 Converter 适配器，不再触碰翻译/审查/美化阶段。
- 双格式问题收敛为"渲染器"问题：语义 HTML 与像素级 HTML 各是一个 IR→HTML 纯函数。
- 内容阶段（转换、翻译）以 IR 为契约；视觉阶段（审查、美化、交互）消费渲染后的 HTML——OMP Goal 代理编辑的是文件，CSS/几何调整属于渲染空间，因此不再反向解析 HTML 回 IR。
- 转换器实现层的 Python 脚本外置、环境配置化、OMP 会话按 worker 复用等配套策略（2026-07-31 架构访谈确认）是可逆的实现细节，不单列 ADR。
