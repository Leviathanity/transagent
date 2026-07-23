import { readFile, copyFile } from "node:fs/promises";
import { createReviewSession, createGoalFixSession } from "../utils/omp-session.js";
import type { StageResult } from "../types/pipeline.js";

interface ReviewCategory {
  index: number;
  name: string;
}

function parseCategories(specContent: string): ReviewCategory[] {
  const categories: ReviewCategory[] = [];
  const headerRegex = /^## (\d+)\. (.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(specContent)) !== null) {
    categories.push({ index: parseInt(match[1]), name: match[2] });
  }
  return categories;
}

export async function stageReview(
  specPath: string,
  inputPath: string,
  reportPath: string,
  outputPath: string,
  model: string,
): Promise<StageResult> {
  const specContent = await readFile(specPath, "utf-8");
  const categories = parseCategories(specContent);

  if (categories.length === 0) {
    return { stage: "review", success: false, error: `No review categories found in spec: ${specPath}` };
  }

  // Grill phase — per category multi-prompt
  const grillSession = await createReviewSession(specContent, model);

  for (const cat of categories) {
    const prompt = `按规范第${cat.index}类「${cat.name}」检查项审查文件 ${inputPath}。仅检查不修复。将发现的问题追加写入 ${reportPath}。如果没有问题，写入"无问题"。`;
    await grillSession.prompt(prompt);
  }

  let allIssues = "";
  try {
    allIssues = await readFile(reportPath, "utf-8");
  } catch {
    allIssues = "";
  }

  await grillSession.dispose();

  if (!allIssues || !allIssues.includes("[")) {
    await copyFile(inputPath, outputPath);
    return { stage: "review", success: true, outputPath };
  }

  // Goal phase — fix all issues
  const goalSession = await createGoalFixSession(allIssues, inputPath, model);
  await goalSession.goalRuntime.createGoal({
    objective: `修复文件 ${inputPath} 中的所有问题。全部修复后标记 complete。`,
  });
  await goalSession.prompt("开始逐项修复。");
  await goalSession.dispose();

  await copyFile(inputPath, outputPath);
  return { stage: "review", success: true, outputPath };
}
