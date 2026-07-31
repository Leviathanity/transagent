import { createAgentSession } from "@oh-my-pi/pi-coding-agent";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent";

export async function createReviewSession(
  specContent: string,
  model: string,
): Promise<AgentSession> {
  const { session } = await createAgentSession({
    modelPattern: model,
    systemPrompt: `你是一个文档格式审查专家。以下是你需要遵循的审查规范：

${specContent}

审查时请：
1. 使用 read 工具读取待审查文件
2. 按照规范逐类检查
3. 只记录问题，不要修改文件
4. 每个发现的问题记录为：[严重度] 类别 - 位置

严重度: error（必须修复）/ warning（建议修复）/ info（可忽略）`,
  });
  return session;
}

export async function createGoalFixSession(
  issueList: string,
  targetPath: string,
  model: string,
): Promise<AgentSession> {
  const { session } = await createAgentSession({
    modelPattern: model,
    systemPrompt: `你是一个文档修复专家。请使用 edit 工具修复以下文件中的所有问题。

待修复文件: ${targetPath}

问题清单:
${issueList}

逐项修复每个问题，修复后用 read 验证。全部修复完成后使用 goalTool 标记 complete。`,
  });
  return session;
}

export async function createTranslateSession(
  glossaryPrompt: string,
  direction: "en2zh" | "zh2en",
  model: string,
): Promise<AgentSession> {
  const directionText =
    direction === "en2zh" ? "英文翻译为中文" : "中文翻译为英文";

  const { session } = await createAgentSession({
    modelPattern: model,
    systemPrompt: `你是一个专业翻译专家。当前任务: ${directionText}。

${glossaryPrompt}

 翻译规则:
- 严格保留原始 HTML 结构和标签（标题、段落、表格、代码块、链接、图片）
- <pre><code> 标签内容不翻译
- 表格: <th> 表头翻译，<td> 单元格按术语表处理
- 术语表中的词必须使用指定翻译`,
  });
  return session;
}
