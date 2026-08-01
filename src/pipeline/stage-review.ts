import { readFile, copyFile, writeFile } from "node:fs/promises";
import { createReviewSession } from "../utils/omp-session.js";
import { lintHtml, FIX_HINTS } from "../utils/lint.js";
import { repairTableStructure } from "../utils/table-repair.js";
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

  // Auth loaded from OMP config (agent.db / settings), not env vars

  // Lint phase — fast geometric checks (no LLM needed)
  const htmlContent = await readFile(inputPath, "utf-8");
  const lintIssues = lintHtml(htmlContent);
  if (lintIssues.length > 0) {
    console.log(`  Lint found ${lintIssues.length} geometric issues`);
  }

  // Grill phase — single prompt for all categories
  const grillSession = await createReviewSession(specContent, model);

  const categoryList = categories.map((c) => `${c.index}. ${c.name}`).join("\n");
  const prompt = `按以下规范逐类审查文件 ${inputPath}，仅检查不修复。

规范类别:
${categoryList}

审查完成后，在回复中输出格式如下的问题清单（每行一条），如果没有任何问题则只输出"无问题"：

[severity] category - description

请确保输出中包含完整的 "[severity]" 标记。不要写入文件，直接在回复中输出。`;
  await grillSession.prompt(prompt);
  const grillMsg = grillSession.getLastAssistantMessage();

  // Extract issues from the agent's text reply
  let allIssues = "";
  if (grillMsg) {
    for (const part of grillMsg.content) {
      if (part.type === "text") allIssues += part.text + "\n";
    }
  }

  // Combine lint + grill issues (before dispose, while auth is valid)
  const lintText = lintIssues
    .map((li) => `[${li.severity}] ${li.category} - ${li.description}`)
    .join("\n");
  const combined = [lintText, allIssues].filter(Boolean).join("\n");
  const hasIssues = combined.includes("[");

  // Write report
  await writeFile(reportPath, hasIssues ? combined : "无问题", "utf-8");

  // Fix phase — Goal mode (auto-loop until agent calls complete)
  if (hasIssues) {
    const fixItems = combined.split("\n").filter(l => l.includes("["));
    console.log(`  Fix phase: Goal — ${fixItems.length} issues`);

    // Group lint issues by subType for fix strategy hints
    const typeGroups = new Map<string, string[]>();
    for (const li of lintIssues) {
      const key = li.subType;
      if (!typeGroups.has(key)) typeGroups.set(key, []);
      typeGroups.get(key)!.push(li.description);
    }
    const fixHintsBlock = typeGroups.size > 0
      ? "\n### 重叠类型与修复方案：\n" +
        [...typeGroups.entries()]
          .filter(([k]) => FIX_HINTS[k])
          .map(([k, v]) => `${k}（${v.length} 处）→ ${FIX_HINTS[k]}`)
          .join("\n")
      : "";

    // Pre-Goal element count for integrity check
    const preGoalElemCount = (htmlContent.match(/position:absolute/g) || []).length;

    await grillSession.goalRuntime.createGoal({
      objective: `【高优先级】修复文件 ${inputPath} 中的所有布局问题。

要求（必须严格遵守）：
1. 下面列出的每个问题都是必须修复的 error，不是 warning，不是 info，没有"可接受"的说法
2. 逐一修复，每次 edit 后用 read 验证
3. 不允许在还有问题未修复时调用 complete
4. 只修改目标元素的内联样式或 CSS 规则，不允许替换或删除完整的 <style> 块
5. 修改 CSS 时必须保留所有已存在的规则，只能追加新属性或修改目标属性
6. 严禁删除任何现有 CSS 规则，否则视为破坏性错误
7. 严禁改变元素的 HTML 标签类型（例如 div↔img 转换），只能调样式和位置
8. 严禁在 position:absolute 元素内部再嵌套 position:absolute 元素。每个绝对定位的 div 必须是 .page 的直接子元素，不能嵌套在另一个绝对定位 div 内
9. 严禁合并或删除独立的 position:absolute 元素。每个元素保持独立，不能将其内容合并到另一个元素中，也不能删除任何元素。元素总数不能减少
10. 修复表格溢出时，只通过 max-width 约束宽度或添加 CSS 规则。严禁修改任何表格元素（det-table）的 top、left、width 或 height 值
${fixHintsBlock}
问题清单（${fixItems.length} 项，全部必须修复）：
${fixItems.map(l => l.replace(/^\[.*?\]\s*/, "MUST FIX: ")).join("\n")}`,
    });
    await grillSession.prompt(`开始修复。这 ${fixItems.length} 个问题全是必须修复的高优错误，逐个修完再 complete。`);
    await grillSession.waitForIdle();
    // Count assistant turns (each tool loop cycle = one assistant message)
    const allMsgs = grillSession.agent?.state?.messages ?? [];
    const goalMsgs = allMsgs.filter((m: any) => m.role === "assistant" && m.content?.length > 0).length;
    console.log(`  Goal turns: ${goalMsgs} assistant turns (${allMsgs.length} total messages)`);
    const r = grillSession.getLastAssistantMessage();
    if (r) {
      const tx = r.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("").slice(0, 600);
      console.log(`  Goal: stop=${r.stopReason}`);
      if (tx) console.log(`  ${tx.slice(0, 300)}`);
      if (r.stopReason === "error") console.log(`  Error: ${(r as any).errorMessage}`);
    }
    // Structural repair: un-nest any position:absolute divs that the agent may have nested
    let aft = await readFile(inputPath, "utf-8");
    const structuralIssues = aft.match(/<div[^>]*style="[^"]*position:absolute[^"]*"[^>]*>[\s\S]*?<div[^>]*style="[^"]*position:absolute/g);
    if (structuralIssues) {
      // Use string-based structural repair: move any position:absolute div that is
      // nested inside another position:absolute div up to be a direct child of .page
      const absDivRe = /<div[^>]*style="[^"]*position:absolute[^"]*"[^>]*>/g;
      const absCloseRe = /<\/div>/g;
      // Find pages and fix nesting via simple DOM manipulation
      const { parseHTML } = await import("linkedom");
      const { document: d } = parseHTML(aft);
      const pages = [...d.querySelectorAll(".page")];
      let fixed = false;
      for (const page of pages) {
        const nested = [...page.querySelectorAll("div[style*='position:absolute'] div[style*='position:absolute']")];
        for (const el of nested) {
          const parent = el.parentElement!;
          // Move el before parent's next sibling (or append to page if parent is last child)
          if (parent.nextSibling) {
            parent.parentElement!.insertBefore(el, parent.nextSibling);
          } else {
            page.appendChild(el);
          }
          fixed = true;
        }
      }
      if (fixed) {
        const serialized = d.toString();
        const absAfter = (serialized.match(/position:absolute/g) || []).length;
        const absBefore = (aft.match(/position:absolute/g) || []).length;
        if (absAfter >= absBefore) {
          aft = serialized;
          await writeFile(inputPath, aft, "utf-8");
          console.log(`  Structural repair: un-nested ${fixed} position:absolute elements`);
        }
      }
    }
    // Content integrity check
    const postGoalCount = (aft.match(/position:absolute/g) || []).length;
    if (postGoalCount < preGoalElemCount) {
      console.log(`  WARNING: Element count decreased from ${preGoalElemCount} to ${postGoalCount}! Agent may have deleted elements.`);
    }

    // Table position guard: revert tables accidentally moved by Goal agent
    const origTableTops = [...htmlContent.matchAll(/class="det-table" style="[^"]*top:(\d+)px/g)]
      .map(m => parseInt(m[1]));
    const postTableTops = [...aft.matchAll(/class="det-table" style="[^"]*top:(\d+)px/g)]
      .map(m => parseInt(m[1]));

    let tableFixed = false;
    for (let ti = 0; ti < Math.min(origTableTops.length, postTableTops.length); ti++) {
      if (Math.abs(postTableTops[ti] - origTableTops[ti]) > 10) {
        const newTop = origTableTops[ti];
        let found = 0;
        aft = aft.replace(
          /class="det-table" style="[^"]*top:\d+px/,
          (match) => {
            found++;
            return found === ti + 1
              ? match.replace(/top:\d+px/, `top:${newTop}px`)
              : match;
          }
        );
        tableFixed = true;
      }
    }
    if (tableFixed) {
      await writeFile(inputPath, aft, "utf-8");
      console.log(`  TablePositionGuard: restored original table positions`);
    }
    // Table structure guard: the Goal agent sometimes appends stray empty
    // cells while editing CSS; restore consistent column counts.
    const tableStructure = repairTableStructure(aft);
    if (tableStructure.tablesRepaired > 0) {
      aft = tableStructure.repaired;
      await writeFile(inputPath, aft, "utf-8");
      console.log(
        `  TableStructureGuard: repaired ${tableStructure.tablesRepaired} tables ` +
          `(-${tableStructure.cellsRemoved} stray cells, +${tableStructure.cellsAdded} padding cells)`,
      );
    }
    console.log(`  Changed: ${aft !== htmlContent ? "YES" : "NO"}`);
  } else {
    console.log("  No issues found, skipping fix phase");
  }

  await grillSession.dispose();

  await copyFile(inputPath, outputPath);
  return { stage: "review", success: true, outputPath };
}
