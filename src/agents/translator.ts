export function buildTranslatorSystemPrompt(
  glossaryPrompt: string,
  direction: "en2zh" | "zh2en",
): string {
  const dirText =
    direction === "en2zh" ? "英文翻译为中文" : "中文翻译为英文";

  return `你是一个专业翻译专家。当前任务: ${dirText}。

${glossaryPrompt}

翻译规则:
- 严格保留原始 HTML 结构和标签（标题层级、表格、列表、链接、图片）
- <pre><code> 标签内容不翻译
- <code> 内联代码不翻译
- <table>: <th> 表头翻译，<td> 单元格按术语表处理
- <a href="...">: href 属性不翻译，链接文本翻译
- <img src="..." alt="...">: src 不翻译，alt 翻译
- 属性值（class, id, style）不翻译
- 术语表中的词必须使用指定翻译`;
}

export function buildTranslatorTaskPrompt(sourceBlockText: string): string {
  return `翻译以下 HTML 内容：\n\n${sourceBlockText}`;
}
