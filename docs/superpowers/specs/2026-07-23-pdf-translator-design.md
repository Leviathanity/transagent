# pdf-translator Design Spec

> 基于 Oh My Pi SDK 的 PDF 中英文自动翻译/排版 npm CLI 工具

## 1. 项目概述

| 属性 | 值 |
|------|-----|
| npm 包名 | `pdf-translator` |
| 命令入口 | `ptl translate <file.pdf> [options]` |
| 运行时 | Bun / Node.js 18+ |
| 核心依赖 | `@oh-my-pi/pi-coding-agent`, `execa` |
| 外部依赖 | Python 3.10+ + `markitdown[all]` |
| LLM | DeepSeek API (Anthropic 兼容模式) |

**核心能力**：
- PDF 中英文双向翻译
- 五阶段管线：转换 → 审查修复 → 并发翻译 → 排版审查 → 交互修改
- JSON 术语表 + regex 匹配
- 终端问答式人工微调

**v1 范围外**：
- 中英以外的语言对
- 扫描版 PDF（OCR）— 依赖 MarkItDown 自身能力
- Web UI / GUI
- 实时协作

---

## 2. 项目结构

```
pdf-translator/
├── package.json
├── tsconfig.json
├── CONTEXT.md                    # 领域术语表 (Glossary)
├── bin/
│   └── ptl.ts                    # CLI 入口
├── src/
│   ├── pipeline/
│   │   ├── orchestrator.ts       # 五阶段编排器
│   │   ├── stage-convert.ts      # ① MarkItDown 子进程调用
│   │   ├── stage-review.ts       # ②/④ 审查 (grill+goal)
│   │   ├── stage-translate.ts    # ③ 并发翻译 (task batch)
│   │   └── stage-interact.ts     # ⑤ 终端问答交互
│   ├── agents/
│   │   ├── reviewer.ts           # 审查 prompt 模板
│   │   └── translator.ts         # 翻译 prompt 模板
│   ├── glossary/
│   │   ├── loader.ts             # JSON 术语表加载
│   │   └── matcher.ts            # 术语表格式化为 LLM prompt 片段
│   ├── splitter/
│   │   └── source-block-splitter.ts  # MD → SourceBlock[] + 切口信息
│   ├── utils/
│   │   ├── omp-session.ts        # OMP Session 工厂
│   │   └── file-manager.ts       # workdir/ 产物管理
│   └── types/
│       ├── glossary.ts           # GlossaryEntry, MatchRule
│       ├── pipeline.ts           # StageResult, ReviewReport
│       └── source-block.ts       # SourceBlock, SeparatedBlock, TranslationUnit
├── specs/
│   ├── review-conversion.md      # 转换质量审查规范
│   └── review-formatting.md      # 排版审查规范
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-07-23-pdf-translator-design.md
└── workdir/                      # 运行时中间产物 (gitignored)
    ├── 01_original.md
    ├── 02_reviewed.md
    ├── 02_review_report.md
    ├── 03_translated.md
    ├── 04_formatted.md
    ├── 04_format_report.md
    └── result/
```

### 模块职责

| 模块 | 单一职责 |
|------|---------|
| `orchestrator.ts` | 串联五阶段，传递中间产物路径，处理阶段失败 |
| `stage-convert.ts` | 检测 Python/MarkItDown 可用性，执行转换并捕获错误 |
| `stage-review.ts` | Grill（逐类多轮检查→输出问题清单）+ Goal（逐项修复→验证），两次审查复用 |
| `stage-translate.ts` | 拆分 SourceBlock → 加载术语表 → Task batch 并发翻译 → 拼合 |
| `stage-interact.ts` | 逐段展示原文/译文 → 收集用户指令 → 最终输出 |
| `omp-session.ts` | 封装 `createAgentSession()` 配置，DeepSeek 模型注册 |

---

## 3. 管线数据流

```
PDF 文件
  │
  ▼ stage-convert (execa markitdown)
01_original.md
  │
  ▼ stage-review: grill (spec: review-conversion.md) → goal (fix)
02_reviewed.md + 02_review_report.md
  │
  ▼ splitter (按 H2/H3+切口保留+表格隔离)
SeparatedBlock[]
  │
  ▼ stage-translate (translator prompt + glossary prompt注入 + Task batch并发)
TranslationUnit[]
  │
  ▼ 拼合 (separatorBefore + translated)
03_translated.md
  │
  ▼ stage-review: grill (spec: review-formatting.md) → goal (fix)
04_formatted.md + 04_format_report.md
  │
  ▼ stage-interact (or --skip-interact)
<output>.md
```

---

## 4. 核心类型

### SourceBlock — 翻译输入单元

```typescript
interface SourceBlock {
  id: string;           // "sb_01_02" (headingLevel_index)
  level: number;        // 0=正文, 1=H1, 2=H2...
  text: string;         // 原始 Markdown 文本
}
```

### SeparatedBlock — 带切口信息的拆分单元

```typescript
interface SeparatedBlock {
  block: SourceBlock;
  separatorBefore: string;  // 该块之前的原始分隔符（空行/缩进等）
}
```

### TranslationUnit — 翻译输出单元

```typescript
interface TranslationUnit {
  sourceBlock: SourceBlock;
  translated: string;
  subagentId: string;
}
```

### 术语表

```typescript
interface GlossaryEntry {
  source: string;
  target: string;
  context?: string;
  regex?: boolean;
  caseSensitive?: boolean;
}
```

### 审查

```typescript
interface ReviewIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  category: string;
  location: string;
  description: string;
  fixed: boolean;
}

interface ReviewReport {
  stage: 'conversion' | 'formatting';
  issues: ReviewIssue[];
  fixCount: number;
}
```

---

## 5. OMP SDK 集成

### Session 生命周期

每个管线阶段独立创建和销毁 OMP AgentSession，不跨阶段复用。每阶段注入不同的 system prompt：

| 阶段 | Session 用途 | 模型 | System Prompt 注入 |
|------|-------------|------|-------------------|
| ② Grill | 逐类检查生成问题清单 | `--review-model` (默认 pro) | 审查规范文件内容 |
| ② Goal | 按问题清单逐项修复 | `--review-model` (默认 pro) | 修复指令 + 问题清单 |
| ③ Translate | Task batch 并发翻译 | `--translate-model` (默认 flash) | 术语表 + 翻译规则 |
| ④ Grill | 逐类检查排版问题 | `--review-model` (默认 pro) | 排版规范文件内容 |
| ④ Goal | 按问题清单逐项修复 | `--review-model` (默认 pro) | 修复指令 + 问题清单 |
| ⑤ Interact* | 用户逐段确认修改 | `--translate-model` (默认 flash) | 单段修改/重译 prompt |

*仅当用户执行修改/重译操作时创建，纯确认不需要。

### 审查阶段 — 两段式 (Grill + Goal)

**阶段 ② 和 ④ 共用此流程，仅规范文件不同。**

#### Grill 子阶段

参照 grill-with-docs 的"决策树逐节点遍历"模式：按规范文件类别逐类检查，每类一次 LLM 调用，积累到问题清单文件。

```
创建审查 session（注入规范文件内容为 system prompt）
  │
  ▼ for each 规范类别 (e.g. 编码, 标题, 表格, ...):
session.prompt("按规范第 N 类 [类别名] 检查项审查 02_reviewed.md，
                仅检查不修复，将发现的问题追加到 02_review_report.md")
  │
  ▼ 全部类别遍历完毕
读取 02_review_report.md → 解析为 ReviewIssue[]
  │
  ▼ if issues.length === 0:
    跳过 Goal，直接进入下一阶段
  │
  ▼ else:
    销毁 Grill session → 进入 Goal 子阶段
```

**关键约束**：Grill 只做检查，不做修复。每个类别一次独立的 LLM 调用，确保聚焦高质量检查。

#### Goal 子阶段

```
创建审查 session（注入问题清单为 prompt 上下文）
  │
  ▼ session.goalRuntime.createGoal({
      objective: "按问题清单逐项修复 workdir/XX.md，全部修复后标记 complete"
    })
  │
  ▼ Agent 逐项修复 → 写回文件 → 验证修复
  │
  ▼ 全部完成 → completeGoal → 销毁 session
```

### 翻译阶段 — Task Batch 并发

```
1. 拆分
   02_reviewed.md → splitter → SeparatedBlock[]

2. 术语表格式化
   glossary.json → loader → matcher.formatForPrompt() → glossaryPrompt 字符串

3. 并发翻译
   TaskTool batch mode:
   {
     context: `翻译方向: ${direction}
术语表:
${glossaryPrompt}

翻译规则:
- 保留原始 Markdown 格式
- 术语表中的词必须使用指定翻译
- 代码块不翻译
- 表格：表头翻译，单元格按术语表处理`,
     tasks: separatedBlocks.map(sb => ({
       name: `tr_${sb.block.id}`,
       agent: "translator",
       task: sb.block.text
     }))
   }
   → TaskTool batch execute (maxConcurrency: 默认3)

4. 拼合
   按原始顺序: sb.separatorBefore + translated → 03_translated.md
```

### 翻译子代理定义

独立的 `.agent.md` 文件，由 OMP `discoverAgents` 从项目 `agents/` 目录自动发现。核心规则：
- 术语优先：术语表中的词必须使用指定翻译
- 格式保留：严格保留 Markdown 格式
- 代码块不翻译
- 表格：表头翻译，单元格按术语表处理

---

## 6. 审查规范文件

审查规范文件独立存放于 `specs/` 目录，在 Grill 阶段被加载并注入 AgentSession 的 system prompt。

| 文件 | 路径 | 用途 | 检查类别数 |
|------|------|------|-----------|
| 转换质量规范 | `specs/review-conversion.md` | ② 转换后审查 | 8 类 |
| 排版规范 | `specs/review-formatting.md` | ④ 翻译后审查 | 11 类 |

每个规范文件定义检查项 checklist 和审查输出格式 `[严重度] 类别 - 位置`（严重度: error / warning / info）。

规范文件内容详见对应文件。

---

## 7. 交互修改与 CLI

### 交互流程

1. 展示翻译摘要（SourceBlock 数、潜在问题数）
2. 逐段展示原文/译文
3. 用户操作：`[y]` 通过 / `[n]` 修改 / `[r]` 重译该段 / `[e]` 编辑 / `[s]` 跳过剩余 / `[q]` 退出
4. 收集所有修改 → 最终输出

### CLI 命令

```
ptl translate doc.pdf                                # 自动检测方向并确认
ptl translate doc.pdf --direction zh2en              # 强制方向
ptl translate doc.pdf --glossary medical.json        # 指定术语表
ptl translate doc.pdf --review-model deepseek-v4-pro # 审查模型 (默认)
ptl translate doc.pdf --translate-model deepseek-v4-flash  # 翻译模型 (默认)
ptl translate doc.pdf --concurrency 5                # 翻译并发数 (默认3)
ptl translate doc.pdf --skip-interact                # 跳过交互 (CI模式)
ptl translate doc.pdf --output ./result.md           # 输出路径 (默认 ./<原名>_translated.md)
ptl check                                            # 环境检测
```

### 方向自动检测

未指定 `--direction` 时，抽取 MD 前 500 字符，按 CJK 字符占比判定：
- CJK 字符 >30% → 判定原文为中文 → 方向 `zh2en`
- 否则 → 方向 `en2zh`
- 向用户展示检测结果并确认后才执行

---

## 8. 错误处理

### 各阶段失败处理

| 阶段 | 失败场景 | 处理方式 |
|------|---------|---------|
| ① Convert | MarkItDown 未安装 | 提示 `pip install 'markitdown[all]'` |
| ① Convert | PDF 无法读取 | 报错退出 |
| ②/④ Grill | 某类别检查失败 | 记录到报告，继续下一类别 |
| ②/④ Goal | 某问题无法修复 | 标记为 `fixed: false`，输出到报告 |
| ③ Translate | 部分子代理失败 | 重试 ×1，仍失败则原文包裹 `<!-- TRANSLATION_FAILED -->` 标记 |
| ③ Translate | API 限流 | 指数退避等待重试 |
| ⑤ Interact | 用户中途退出 | 已确认内容保存，未确认保留译文 |

### 幂等性

- 重复运行全量覆盖同名产物

---

## 9. 术语表 (JSON)

```json
{
  "version": "1.0",
  "direction": "en2zh",
  "entries": [
    {
      "source": "machine learning",
      "target": "机器学习",
      "context": "AI/计算机科学",
      "regex": false,
      "caseSensitive": false
    },
    {
      "source": "(\\d+\\.?\\d*)\\s*(ms|s|min|h)",
      "target": "$1 $2",
      "context": "时间单位：保持原文数字+单位格式",
      "regex": true,
      "caseSensitive": true
    }
  ]
}
```

regex 模式支持捕获组引用 `$1` `$2`。术语表通过 `matcher.ts` 格式化为 LLM prompt 片段注入翻译子代理，不做原文预处理替换。

---

## 10. 测试策略

| 层 | 范围 | 工具 |
|----|------|------|
| 单元测试 | splitter, glossary loader/matcher, file-manager | `bun test` |
| 集成测试 | stage-convert (mock MarkItDown), stage-review (mock session), stage-translate (mock session) | `bun test` + mock |
| E2E | 完整管线（短 PDF，指定术语表） | `bun test` 或 CI 脚本 |

---

## 11. 术语表 (Glossary)

详见 `CONTEXT.md`。核心概念：

| 术语 | 含义 |
|------|------|
| **SourceBlock** | 按 H2/H3 分割、内部正文合并的语义完整 Markdown 块，翻译最小输入单元 |
| **SeparatedBlock** | SourceBlock + 块前原始分隔符，用于拼合时精确还原布局 |
| **TranslationUnit** | SourceBlock + 译文的一对一映射 |
| **Grill 阶段** | 按规范文件类别逐类多轮 prompt 检查，生成完整问题清单 |
| **Goal 阶段** | 以问题清单为目标，逐项修复并验证 |
| **Per-Stage Session** | 每阶段独立创建销毁 OMP AgentSession，不跨阶段复用 |
| **切口保留** | splitter 记录每个 SourceBlock 前的原始分隔符，拼合时还原 |
