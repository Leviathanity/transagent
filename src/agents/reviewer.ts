export const GRILL_PROMPT_PREFIX = "按规范第";

export function buildGrillPrompt(
  categoryIndex: number,
  categoryName: string,
  targetPath: string,
  reportPath: string,
): string {
  return `${GRILL_PROMPT_PREFIX}${categoryIndex}类「${categoryName}」检查项审查文件 ${targetPath}。仅检查不修复。将发现的问题追加写入 ${reportPath}。`;
}

export function buildGoalPrompt(
  issueList: string,
  targetPath: string,
): string {
  return `根据以下问题清单逐项修复文件 ${targetPath}：

${issueList}

全部修复完成后标记为 complete。`;
}
