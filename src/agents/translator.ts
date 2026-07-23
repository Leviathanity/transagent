export function buildTranslatorSystemPrompt(
  glossaryPrompt: string,
  direction: "en2zh" | "zh2en",
): string {
  const dirText =
    direction === "en2zh" ? "英文翻译为中文" : "中文翻译为英文";

  return `你是一个专业翻译专家。当前任务: ${dirText}。

${glossaryPrompt}

翻译规则:
- 严格保留原始 Markdown 格式
- 代码块内容不翻译
- 表格: 表头翻译，单元格按术语表处理
- 术语表中的词必须使用指定翻译`;
}

export function buildTranslatorTaskPrompt(sourceBlockText: string): string {
  return `翻译以下 Markdown 内容：\n\n${sourceBlockText}`;
}
