import { readFile, copyFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { lintHtml } from "../utils/lint.js";
import { execa } from "execa";
import { parseHTML } from "linkedom";
import type { StageResult } from "../types/pipeline.js";

const WSL_PYTHON = "/root/ptl-ocr-env/bin/python3";

function wslPath(winPath: string): string {
  return winPath
    .replace(/^([A-Za-z]):\\/, (_m: string, d: string) => `/mnt/${d.toLowerCase()}/`)
    .replace(/\\/g, "/");
}

/** Extract PDF text blocks with font info for layout comparison */
async function extractPdfLayout(pdfPath: string): Promise<string> {
  const wslPdf = wslPath(resolve(pdfPath));
  const script = `
import fitz, json, sys, os
doc = fitz.open("${wslPdf}")
max_pages = min(len(doc), 5)
PDF_TO_PAGE = 300 / 72
PAGE_W = 1024
MODEL_SIZE = 1024
PDF_PT_W = doc[0].rect.width
PDF_PT_H = doc[0].rect.height
page_w = int(PDF_PT_W * 300 / 72)
page_h = int(PDF_PT_H * 300 / 72)
PAGE_H = int(PAGE_W * (page_h / page_w))

results = []
for i in range(max_pages):
    page = doc[i]
    blocks = page.get_text("dict")["blocks"]
    page_data = {"page": i+1, "w": page_w, "h": page_h, "elements": []}
    for b in blocks:
        if b["type"] != 0:
            continue
        for line in b["lines"]:
            for sp in line["spans"]:
                t = sp["text"].strip()
                if not t:
                    continue
                bx1 = sp["bbox"][0] * PDF_TO_PAGE / (page_w / MODEL_SIZE)
                by1 = sp["bbox"][1] * PDF_TO_PAGE / (page_h / MODEL_SIZE)
                bx2 = sp["bbox"][2] * PDF_TO_PAGE / (page_w / MODEL_SIZE)
                by2 = sp["bbox"][3] * PDF_TO_PAGE / (page_h / MODEL_SIZE)
                sx = int(bx1 / MODEL_SIZE * PAGE_W)
                sy = int(by1 / MODEL_SIZE * PAGE_H)
                sw = int((bx2 - bx1) / MODEL_SIZE * PAGE_W)
                sh = int((by2 - by1) / MODEL_SIZE * PAGE_H)
                page_data["elements"].append({
                    "text": t[:80],
                    "x": sx, "y": sy, "w": sw, "h": sh,
                    "font": sp["font"],
                    "size": round(sp["size"] * (PAGE_W / PDF_PT_W), 1),
                    "bold": bool(sp["flags"] & 32),
                    "italic": bool(sp["flags"] & 2),
                    "color": f"#{sp['color']:06x}" if sp["color"] else "black",
                })
    results.append(page_data)
doc.close()
print(json.dumps(results))
`;
  const result = await execa("wsl", [WSL_PYTHON, "-c", script], { timeout: 60000, stdout: "pipe", stderr: "inherit" });
  return result.stdout;
}

/** Parse HTML elements with position & font info */
function parseHtmlLayout(html: string): string {
  const { document } = parseHTML(html);
  const pages = [...document.querySelectorAll(".page")];
  const results: any[] = [];

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const els = [...page.querySelectorAll("div[style*='position:absolute']")];
    const pageData: any = { page: pi + 1, elements: [] };

    for (const el of els) {
      const s = el.getAttribute("style") || "";
      const text = (el.textContent || "").trim();
      if (!text || text.length < 2) continue;

      const left = parseFloat((s.match(/left:([\d.]+)px/) || [])[1] || "0");
      const top = parseFloat((s.match(/top:([\d.]+)px/) || [])[1] || "0");
      const width = parseFloat((s.match(/width:([\d.]+)px/) || [])[1] || "0");
      const height = parseFloat((s.match(/height:([\d.]+)px/) || [])[1] || "0");
      const fontSize = parseFloat((s.match(/font-size:([\d.]+)px/) || [])[1] || "0");
      const fontFamily = (s.match(/font-family:([^;]+)/) || [])[1] || "";
      const isBold = s.includes("font-weight:bold");
      const isItalic = s.includes("font-style:italic");
      const color = (s.match(/color:([^;]+)/) || [])[1] || "black";
      const cls = el.className || "";

      pageData.elements.push({
        text: text.slice(0, 80),
        x: Math.round(left), y: Math.round(top),
        w: Math.round(width), h: Math.round(height),
        fontSize: Math.round(fontSize * 10) / 10,
        fontFamily: fontFamily.trim(),
        bold: isBold, italic: isItalic,
        color, cls,
      });
    }
    results.push(pageData);
  }
  return JSON.stringify(results, null, 2);
}

/** Generate layout comparison report for LLM consumption */
function generateDiffReport(pdfJson: string, htmlJson: string, userPrompt?: string): string {
  const pdfData = JSON.parse(pdfJson);
  const htmlData = JSON.parse(htmlJson);

  const lines: string[] = [];
  lines.push("## Layout Comparison Report: Translated HTML vs Original PDF");
  lines.push("");

  if (userPrompt) {
    lines.push("### User Guidance");
    lines.push(userPrompt);
    lines.push("");
  }

  let totalFontMismatches = 0;
  let totalSizeMismatches = 0;
  let totalBoldMismatches = 0;

  for (const pdfPage of pdfData) {
    const htmlPage = htmlData.find((p: any) => p.page === pdfPage.page);
    if (!htmlPage) continue;

    const pdfEls = pdfPage.elements;
    const htmlEls = htmlPage.elements;

    // Match PDF elements to HTML elements by position proximity
    for (const pe of pdfEls) {
      let bestMatch: any = null;
      let bestDist = Infinity;
      for (const he of htmlEls) {
        const dx = pe.x - he.x;
        const dy = pe.y - he.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 50 && dist < bestDist) {
          bestDist = dist;
          bestMatch = he;
        }
      }

      if (bestMatch) {
        const diffs: string[] = [];
        if (pe.bold !== bestMatch.bold) {
          diffs.push(`font-weight: ${pe.bold ? "bold" : "normal"} (pdf) vs ${bestMatch.bold ? "bold" : "normal"} (html)`);
          totalBoldMismatches++;
        }
        if (Math.abs(pe.size - bestMatch.fontSize) > 1) {
          diffs.push(`font-size: ${pe.size}px (pdf) vs ${bestMatch.fontSize}px (html)`);
          totalSizeMismatches++;
        }
        if (pe.font && bestMatch.fontFamily && !bestMatch.fontFamily.includes(pe.font.split(",")[0])) {
          diffs.push(`font: ${pe.font} (pdf) vs ${bestMatch.fontFamily} (html)`);
          totalFontMismatches++;
        }
        if (diffs.length > 0) {
          lines.push(`- P${pdfPage.page} "${pe.text}" → ${diffs.join(", ")}`);
        }
      }
    }

    // Check for significant gaps/overlaps between consecutive elements
    const sorted = [...htmlEls].sort((a: any, b: any) => a.y - b.y || a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const gap = curr.y - (prev.y + prev.h);
      if (gap > 30 && prev.h < 30 && curr.h < 30 && prev.x < curr.x + curr.w && prev.x + prev.w > curr.x) {
        lines.push(`- P${pdfPage.page} gap: "${prev.text}" → "${curr.text}" gap=${gap}px`);
      }
    }
  }

  lines.push("");
  lines.push("### Summary");
  lines.push(`- Font mismatches: ${totalFontMismatches}`);
  lines.push(`- Size mismatches: ${totalSizeMismatches}`);
  lines.push(`- Bold/weight mismatches: ${totalBoldMismatches}`);
  lines.push("");

  return lines.join("\n");
}

export async function stageBeautify(
  specPath: string,
  htmlPath: string,
  pdfPath: string,
  outputPath: string,
  model: string,
  userPrompt?: string,
  reportPath?: string,
): Promise<StageResult> {
  const specContent = await readFile(specPath, "utf-8");
  const reportFile = reportPath ?? htmlPath.replace(/\.html$/, "_beautify_report.md");

  console.log("  Extracting PDF layout metadata...");
  const pdfLayout = await extractPdfLayout(pdfPath);

  console.log("  Parsing HTML layout...");
  const htmlContent = await readFile(htmlPath, "utf-8");
  const htmlLayout = parseHtmlLayout(htmlContent);

  // Lint phase
  const lintIssues = lintHtml(htmlContent);
  console.log(`  Lint: ${lintIssues.length} geometric issues`);

  // Diff report
  const diffReport = generateDiffReport(pdfLayout, htmlLayout, userPrompt);

  // Combine lint issues + diff report
  const lintText = lintIssues
    .map((li) => `[${li.severity}] ${li.category} - ${li.description}`)
    .join("\n");

  const combined = [diffReport, lintText ? "\n### Lint Issues\n" + lintText : ""].filter(Boolean).join("\n");
  await writeFile(reportFile, combined, "utf-8");

  // Grill phase
  const session = await createBeautifySession(specContent, model, userPrompt);
  const categoryList = "1. Font consistency\n2. Text fitting & wrapping\n3. Spacing & alignment\n4. Table styling\n5. Color & contrast\n6. Image quality\n7. Overall polish";

  await session.prompt(
    `按以下规范审查文件 ${htmlPath}。布局对比报告见 ${reportFile}，你可以 read 查看。

规范类别:
${categoryList}

审查完成后，在回复中输出格式如下的问题清单（每行一条），如果没有任何问题则只输出"无问题"：

[severity] category - description`,
  );
  const grillMsg = session.getLastAssistantMessage();

  let allIssues = diffReport + "\n";
  if (grillMsg) {
    for (const part of grillMsg.content) {
      if (part.type === "text") allIssues += part.text + "\n";
    }
  }

  const hasIssues = allIssues.includes("[");
  await writeFile(reportFile, allIssues, "utf-8");

  // Goal fix phase
  if (hasIssues) {
    const fixItems = allIssues.split("\n").filter(l => l.includes("["));
    console.log(`  Fix: ${fixItems.length} issues`);

    const preGoalCount = (htmlContent.match(/position:absolute/g) || []).length;

    await session.goalRuntime.createGoal({
      objective: `对文件 ${htmlPath} 进行布局美化，参考原 PDF 的布局元数据使 HTML 视觉效果尽可能接近原文件。

要求（必须严格遵守）：
1. 参考布局对比报告中的元素级差异（font/size/bold/color）
2. 逐一修复，每次 edit 后用 read 验证
3. 不允许在还有问题未修复时调用 complete
4. 只修改目标元素的内联样式或 CSS 规则，不允许替换或删除完整 <style> 块
5. 修改 CSS 时保留已有规则，只能追加或修改目标属性
6. 严禁删除现有 CSS 规则
7. 严禁改变 HTML 标签类型
8. 严禁在 position:absolute 内嵌套 position:absolute
9. 严禁合并或删除独立元素${userPrompt ? `\n\n用户美化意见（优先遵循）：\n${userPrompt}` : ""}

问题清单（${fixItems.length} 项，全部修复）：
${fixItems.map(l => l.replace(/^\[.*?\]\s*/, "MUST FIX: ")).join("\n")}`,
    });

    await session.prompt(`开始美化。共 ${fixItems.length} 个问题，逐项修完再 complete。`);
    await session.waitForIdle();

    // Structural repair
    let aft = await readFile(htmlPath, "utf-8");
    const structuralIssues = aft.match(/<div[^>]*style="[^"]*position:absolute[^"]*"[^>]*>[\s\S]*?<div[^>]*style="[^"]*position:absolute/g);
    if (structuralIssues) {
      const { document: d } = parseHTML(aft);
      const pages = [...d.querySelectorAll(".page")];
      for (const page of pages) {
        const nested = [...page.querySelectorAll("div[style*='position:absolute'] div[style*='position:absolute']")];
        for (const el of nested) {
          const parent = el.parentElement!;
          if (parent.nextSibling) {
            parent.parentElement!.insertBefore(el, parent.nextSibling);
          } else {
            page.appendChild(el);
          }
        }
      }
      aft = d.toString();
    }

    const postGoalCount = (aft.match(/position:absolute/g) || []).length;
    if (postGoalCount < preGoalCount) {
      console.log(`  WARNING: Elements lost (${preGoalCount}→${postGoalCount})`);
    }

    const changed = aft !== htmlContent;
    if (changed) await writeFile(htmlPath, aft, "utf-8");
    console.log(`  Changed: ${changed ? "YES" : "NO"}`);
  }

  await session.dispose();
  await copyFile(htmlPath, outputPath);
  return { stage: "beautify", success: true, outputPath };
}

async function createBeautifySession(specContent: string, model: string, userPrompt?: string) {
  const userSection = userPrompt
    ? `\n## 用户美化意见\n用户提供了以下美化偏好，请优先考虑：\n${userPrompt}\n`
    : "";

  const { session } = await (await import("@oh-my-pi/pi-coding-agent")).createAgentSession({
    modelPattern: model,
    systemPrompt: `你是一个文档美化专家。你需要对比翻译后的 HTML 和原始 PDF 的布局元数据，修正视觉差异。

## 审查规范
${specContent}

${userSection}
## 工作方式
1. 先用 read 读取布局对比报告（保存在 --report 指定的文件中）
2. 按规范逐类检查差异
3. 只记录问题，不要修改文件
4. 每个发现的差异记录为：[severity] category - description

严重度: error（必须修复）/ warning（建议修复）/ info（可忽略）`,
  });
  return session;
}
