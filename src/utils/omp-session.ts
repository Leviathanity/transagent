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

