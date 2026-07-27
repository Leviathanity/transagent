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

  // Page-edge proximity analysis
  const rightEdgeElements: string[] = [];
  const topEdgeElements: string[] = [];
  for (const pdfPage of pdfData) {
    const htmlPage = htmlData.find((p: any) => p.page === pdfPage.page);
    if (!htmlPage) continue;

    for (const he of htmlPage.elements) {
      const fromRight = 1024 - (he.x + he.w);
      const fromTop = he.y;
      if (fromRight < 150 && fromRight > 0 && he.text.length > 2) {
        rightEdgeElements.push(`P${pdfPage.page} "${he.text.slice(0,25)}" right=${fromRight}px from edge, left=${he.x} w=${he.w}`);
      }
      if (fromTop < 30 && fromTop > 0 && he.text.length > 2) {
        topEdgeElements.push(`P${pdfPage.page} "${he.text.slice(0,25)}" top=${fromTop}px from edge`);
      }
    }
  }

  if (rightEdgeElements.length > 0) {
    lines.push(`### Right-edge proximity (${rightEdgeElements.length} elements within 150px of right border):`);
    lines.push("These elements need padding-right or margin-right to breathe. Use CSS selector `.near-right` to target them.");
    for (const e of rightEdgeElements.slice(0, 10)) lines.push(`- ${e}`);
    if (rightEdgeElements.length > 10) lines.push(`- ... and ${rightEdgeElements.length - 10} more`);
    lines.push("");
  }

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
  let htmlContent = await readFile(htmlPath, "utf-8");
  const htmlLayout = parseHtmlLayout(htmlContent);

  // Pre-process: add .near-right class
  // Pass 1: elements with explicit left+width indicating right-edge position
  htmlContent = htmlContent.replace(
    /(<div )style="([^"]*left:(\d+)px[^"]*top:(\d+)px[^"]*width:(\d+)px[^"]*)"/g,
    (match, prefix, styleContent, leftStr, topStr, widthStr) => {
      const left = parseInt(leftStr);
      const width = parseInt(widthStr);
      if (left + width > 870 && left + width < 1024 && !match.includes('near-right')) {
        return `${prefix}class="near-right" style="${styleContent}"`;
      }
      return match;
    }
  );

  // Pass 2: ALL det-table elements always get near-right (tables are wide)
  htmlContent = htmlContent.replace(/<div class="det-table" style="/g, '<div class="det-table near-right" style="');

  // Pass 3: absolutely-positioned divs without explicit width (body text fills to edge)
  // Add near-right class AND max-width to constrain text from touching page border
  htmlContent = htmlContent.replace(
    /(<div )style="(position:absolute;[^"]*left:(\d+)px;[^"]*)"/g,
    (match, prefix, styleContent, leftStr) => {
      if (styleContent.includes("width:") || styleContent.includes("max-width:")) return match;
      if (match.includes('class="') || match.includes("det-table") || match.includes("det-image")) return match;
      const left = parseInt(leftStr);
      const maxW = 1024 - left - 30; // 30px right margin
      if (maxW > 400 && maxW < 1024) {
        return `${prefix}class="near-right" style="${styleContent};max-width:${maxW}px"`;
      }
      return `${prefix}class="near-right" style="${styleContent}"`;
    }
  );

  const added = (htmlContent.match(/near-right/g) || []).length;
  if (added > 0) {
    await writeFile(htmlPath, htmlContent, "utf-8");
    console.log(`  Added .near-right class to ${added} right-edge elements`);
  }

  const layoutSummary = generateLayoutSummary(pdfLayout, htmlLayout);
  await writeFile(reportFile, layoutSummary, "utf-8");

  // Determine if user explicitly requests HTML element edits
  const allowHtmlEdit = userPrompt
    ? /移动|调整位置|修改.*元素|改变.*结构|修改.*html|元素.*位置|top|left|width|height/.test(userPrompt.toLowerCase())
    : false;

  // Grill: generate style guide
  const session = await createBeautifySession(model, userPrompt);

  console.log(`  Grill: generating style guide...`);

  const grillPrompt = [
    "你是一名 CSS 设计专家。阅读布局报告 " + reportFile + "，对比原始 PDF 和翻译后的 HTML。",
    "",
    "## 任务：生成统一风格指南",
    "",
    "分析原始 PDF 的设计特征，生成一套 CSS 规则，应用到翻译后的 HTML 上使其视觉一致性最大化。",
    "",
    "### 必须覆盖的规范：",
    "1. **字体层级**：从 PDF 提取主要字体族、字号、粗细，生成 body 和各语义类的 CSS font-family/font-size/font-weight 规则",
    "2. **颜色方案**：提取 PDF 中的强调色（如 green 注释、blue 链接），定义 CSS 颜色类",
    "3. **表格样式**：边框颜色/宽度、单元格内边距、表头背景色、字体大小，与 PDF 一致",
    "4. **图片样式**：最大宽度、对齐方式、响应式行为",
    '5. **页面留白**：HTML 中靠近右边界的元素已加 class="near-right"。检查报告中的 "Right-edge proximity" 数据，为 .near-right 类生成足够的 padding-right（至少 10px）',
    "6. **行距与段距**：提取 PDF 的 line-height 模式，确保正文、标题、注释的行距层级分明",
    "",
    "### 要求：",
    "- 只输出 CSS 规则（<style> 块内的内容），不要包含 HTML 标签修改建议",
    "- 规则要通用，适用于所有页面，不能依赖特定页面的元素",
    "- 中文字体必须有适当的退化栈（如 'Times New Roman', 'Noto Serif CJK SC', serif）",
    "",
    "输出格式：只输出纯 CSS 代码块，用 ```css 包裹，不要任何解释性文字。",
  ].join("\n");

  await session.prompt(grillPrompt);

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

  // ── CODE: inject Grill's CSS directly into <style> block ──
  let aft = await readFile(htmlPath, "utf-8");
  const headMatch = aft.match(/(<style>)([\s\S]*?)(<\/style>)/i);
  if (headMatch) {
    // Append new rules after existing ones, preserve originals
    aft = aft.replace(headMatch[0], headMatch[1] + headMatch[2] + "\n" + styleGuide + "\n" + headMatch[3]);
  } else {
    // No <style> block: inject one before the page content
    const headEnd = aft.indexOf("</head>");
    if (headEnd > 0) {
      aft = aft.slice(0, headEnd) + "<style>\n" + styleGuide + "\n</style>\n" + aft.slice(headEnd);
    } else {
      aft = "<style>\n" + styleGuide + "\n</style>\n" + aft;
    }
  }
  await writeFile(htmlPath, aft, "utf-8");
  console.log("  Applied style guide to <style> block (code injection)");

  await session.dispose();

  // ── Post-process: right-edge adjustment (when user requested HTML edits) ──
  if (allowHtmlEdit) {
    let moved = 0;
    aft = aft.replace(
      /(<div class="[^"]*near-right[^"]*)" style="([^"]*left:)(\d+)(px[^"]*")/g,
      (match, prefix, beforeLeft, leftStr, suffix) => {
        const left = parseInt(leftStr);
        if (left >= 100) {           moved++;
          return `${prefix}" style="${beforeLeft}${left - 16}${suffix}`; }
        return match;
      }
    );
    if (moved > 0) {
      await writeFile(htmlPath, aft, "utf-8");
      console.log(`  RightEdgeAdjust: moved ${moved} elements 16px left`);
    }
  }

  // ── Structural safety check ──
  const structuralIssues = aft.match(/<div[^>]*style="[^"]*position:absolute[^"]*"[^>]*>[\s\S]*?<div[^>]*style="[^"]*position:absolute/g);
  if (structuralIssues) {
    const { document: d } = parseHTML(aft);
    const pages = [...d.querySelectorAll(".page")];
    for (const page of pages) {
      const nested = [...page.querySelectorAll("div[style*='position:absolute'] div[style*='position:absolute']")];
      for (const el of nested) {
        const parent = el.parentElement!;
        if (parent.nextSibling) { parent.parentElement!.insertBefore(el, parent.nextSibling); }
        else { page.appendChild(el); }
      }
    }
    aft = d.toString();
  }

  const changed = aft !== htmlContent;
  if (changed) await writeFile(htmlPath, aft, "utf-8");
  console.log(`  Changed: ${changed ? "YES" : "NO"}`);

  await copyFile(htmlPath, outputPath);
  return { stage: "beautify", success: true, outputPath };
}

async function createBeautifySession(model: string, userPrompt?: string) {
  const userSection = userPrompt
    ? `\n## 用户意见\n${userPrompt}\n`
    : "";

  const { session } = await (await import("@oh-my-pi/pi-coding-agent")).createAgentSession({
    modelPattern: model,
    systemPrompt: `你是一个 CSS 设计专家。你的任务是根据原始 PDF 的设计特征，为翻译后的 HTML 生成统一的 CSS 风格指南。

## 设计原则
- 从 PDF 中提取字体族、字号层级、颜色方案
- 保持表格边框样式（颜色、宽度、内边距）与 PDF 一致
- 确保所有页面视觉一致——同类元素使用相同样式
- 只输出 CSS 规则，不修改 HTML 结构
${userSection}
## 输出要求
- 只输出纯 CSS 代码，用 \`\`\`css 包裹
- 不要包含 HTML 修改建议或解释文字
- 规则要通用，适用于所有页面`,
  });
  return session;
}
