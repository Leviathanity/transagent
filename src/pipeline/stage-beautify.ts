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

/** Generate a layout diff summary for style guide generation */
function generateLayoutSummary(pdfJson: string, htmlJson: string): string {
  const pdfData = JSON.parse(pdfJson);
  const htmlData = JSON.parse(htmlJson);
  const lines: string[] = [];

  lines.push("## Original PDF Layout Characteristics");
  lines.push("");

  // Collect PDF-wide font statistics
  const pdfFonts = new Set<string>();
  const pdfSizes = new Set<number>();
  const pdfColors = new Set<string>();
  const pdfBolds = new Set<string>();

  for (const page of pdfData) {
    for (const el of page.elements) {
      if (el.font) pdfFonts.add(el.font);
      if (el.size) pdfSizes.add(el.size);
      if (el.color && el.color !== "black") pdfColors.add(el.color);
      if (el.bold) pdfBolds.add(el.text.slice(0, 30));
    }
  }

  lines.push(`### Fonts used: ${[...pdfFonts].join(", ")}`);
  lines.push(`### Font sizes: ${[...pdfSizes].sort((a,b)=>b-a).join(", ")}px`);
  lines.push(`### Accent colors: ${[...pdfColors].join(", ")}`);
  lines.push("");

  // Per-page layout observations
  for (const pdfPage of pdfData) {
    const htmlPage = htmlData.find((p: any) => p.page === pdfPage.page);
    if (!htmlPage) continue;

    const diffs: string[] = [];
    for (const pe of pdfPage.elements) {
      let bestMatch: any = null;
      let bestDist = Infinity;
      for (const he of htmlPage.elements) {
        const dist = Math.sqrt((pe.x - he.x) ** 2 + (pe.y - he.y) ** 2);
        if (dist < 50 && dist < bestDist) { bestDist = dist; bestMatch = he; }
      }
      if (bestMatch) {
        if (pe.bold !== bestMatch.bold) diffs.push(`"${pe.text.slice(0,20)}" should be ${pe.bold?"bold":"normal"}`);
        if (!bestMatch.color.includes(pe.color.replace("#","")) && pe.color !== "black") diffs.push(`"${pe.text.slice(0,20)}" should be ${pe.color}`);
      }
    }
    if (diffs.length > 0) lines.push(`### Page ${pdfPage.page}: ${diffs.join("; ")}`);
  }

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
  const reportFile = reportPath ?? htmlPath.replace(/\.html$/, "_beautify_report.md");

  console.log("  Extracting PDF layout metadata...");
  const pdfLayout = await extractPdfLayout(pdfPath);

  console.log("  Parsing HTML layout...");
  const htmlContent = await readFile(htmlPath, "utf-8");
  const htmlLayout = parseHtmlLayout(htmlContent);

  const layoutSummary = generateLayoutSummary(pdfLayout, htmlLayout);
  await writeFile(reportFile, layoutSummary, "utf-8");

  // Determine if user explicitly requests HTML element edits
  const allowHtmlEdit = userPrompt
    ? /移动|调整位置|修改.*元素|改变.*结构|修改.*html|元素.*位置|top|left|width|height/.test(userPrompt.toLowerCase())
    : false;

  // Grill: generate style guide
  const session = await createBeautifySession(model, userPrompt, allowHtmlEdit);

  console.log(`  Grill: generating style guide (html edits: ${allowHtmlEdit ? "allowed" : "forbidden"})...`);

  await session.prompt(
    `你是一名 CSS 设计专家。阅读布局报告 ${reportFile}，对比原始 PDF 和翻译后的 HTML。

## 任务：生成统一风格指南

分析原始 PDF 的设计特征（字体、字号、颜色、表格样式、行间距），生成一套 CSS 规则，应用到翻译后的 HTML 上使其视觉一致性最大化。

要求：
1. 只输出 CSS 规则（<style> 块内的内容），不要包含 HTML 标签修改建议
2. 针对页面级别的样式：body 背景、body 字体、.page 阴影
3. 针对表格：.det-table 的边框颜色、内边距、表头背景色、单元格字体大小
4. 针对图片：.det-image 的最大宽度、对齐方式
5. 保持与原始 PDF 一致的设计语言：字号层级、颜色方案、间距模式
6. 规则要通用，适用于所有页面，不能依赖特定页面的元素

输出格式：只输出纯 CSS 代码块，用 \`\`\`css 包裹，不要任何解释性文字。`,
  );

  const grillMsg = session.getLastAssistantMessage();
  let styleGuide = "";
  if (grillMsg) {
    for (const part of grillMsg.content) {
      if (part.type === "text") {
        // Extract CSS from code block
        const cssMatch = part.text.match(/```css\s*([\s\S]*?)```/);
        if (cssMatch) {
          styleGuide = cssMatch[1].trim();
        } else {
          // Fallback: use the raw text if it looks like CSS
          styleGuide = part.text.trim();
        }
      }
    }
  }

  if (!styleGuide) {
    console.log("  Grill returned no style guide, skipping fix phase");
    await session.dispose();
    await copyFile(htmlPath, outputPath);
    return { stage: "beautify", success: true, outputPath };
  }

  await writeFile(reportFile, layoutSummary + "\n\n## Generated Style Guide\n```css\n" + styleGuide + "\n```", "utf-8");
  console.log(`  Style guide: ${styleGuide.split("\n").length} lines of CSS`);

  // Goal: apply style guide (CSS-only by default)
  const cssEditOnly = !allowHtmlEdit
    ? "\n核心约束（CSS-Only 模式）：你只能修改 <style> 块内的 CSS 规则。严禁修改任何 HTML 元素、标签、position 值或文本内容。如果用户提示涉及 HTML 修改才可例外。"
    : "\n注意：用户提示中提到了 HTML 元素修改需求，你可以在此基础上适当调整 HTML 结构，但必须保持元素独立性和结构完整性。";

  await session.goalRuntime.createGoal({
    objective: `将以下 CSS 风格指南应用到文件 ${htmlPath} 的 <style> 块中，使翻译后的 HTML 视觉效果接近原始 PDF。

## CSS 风格指南
\`\`\`css
${styleGuide}
\`\`\`

要求：
1. 读取目标 HTML 文件的 <style> 块
2. 对比风格指南，逐条检查 CSS 规则是否需要修改或新增
3. 只修改 <style> 块内的 CSS 规则，保留所有已存在的样式值
4. 新增规则追加到文件末尾，修改规则只改目标属性
5. 修改后用 read 验证
6. 全部完成后调用 complete${cssEditOnly}`,
  });

  await session.prompt("开始应用 CSS 风格指南。只修改 <style> 块，不触碰 HTML 元素。");
  await session.waitForIdle();

  // Post-Goal structural safety
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

  const changed = aft !== htmlContent;
  if (changed) await writeFile(htmlPath, aft, "utf-8");
  console.log(`  Changed: ${changed ? "YES" : "NO"}`);

  await session.dispose();
  await copyFile(htmlPath, outputPath);
  return { stage: "beautify", success: true, outputPath };
}

async function createBeautifySession(model: string, userPrompt?: string, allowHtmlEdit?: boolean) {
  const userSection = userPrompt
    ? `\n## 用户意见\n${userPrompt}\n`
    : "";

  const htmlDisclaimer = !allowHtmlEdit
    ? "\n注意：默认情况下你只能生成 CSS 规则。不要建议修改 HTML 结构、元素位置或标签类型。"
    : "\n用户已授权 HTML 元素修改，你可以适当建议结构调整，但要保持元素独立性。";

  const { session } = await (await import("@oh-my-pi/pi-coding-agent")).createAgentSession({
    modelPattern: model,
    systemPrompt: `你是一个 CSS 设计专家。你的任务是根据原始 PDF 的设计特征，为翻译后的 HTML 生成统一的 CSS 风格指南。

## 设计原则
- 从 PDF 中提取字体族、字号层级、颜色方案
- 保持表格边框样式（颜色、宽度、内边距）与 PDF 一致
- 确保所有页面视觉一致——同类元素使用相同样式
- 只输出 CSS 规则，不修改 HTML 结构
${htmlDisclaimer}
${userSection}
## 输出要求
- 只输出纯 CSS 代码，用 \`\`\`css 包裹
- 不要包含 HTML 修改建议或解释文字
- 规则要通用，适用于所有页面`,
  });
  return session;
}
