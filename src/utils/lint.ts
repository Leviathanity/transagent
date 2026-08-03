import { parseHTML } from "linkedom";
import { maxLineTextWidth, estimateLineCount } from "./text-metrics.js";
import { DEFAULT_CONFIG } from "./config.js";

export interface LintIssue {
  severity: "error" | "warning" | "info";
  category: string;
  subType: string;
  description: string;
}

function parsePx(val: string): number {
  return parseFloat(val.replace("px", ""));
}

type ElemType = "title" | "header" | "footer" | "page_number" | "table" | "text" | "image";

function classifyElem(fontSize: number, text: string, top: number, left: number, pageH: number, cls: string, nowrap: boolean, pageW: number): ElemType {
  if (cls.includes("det-table")) return "table";
  if (cls.includes("det-image")) return "image";
  if (nowrap && fontSize <= 11 && top < pageH * 0.05) return "header";
  if (nowrap && fontSize <= 11 && top > pageH * 0.9) return "footer";
  if (nowrap && fontSize <= 11 && /^\d+$/.test(text.trim())) return "page_number";
  if (fontSize >= 20) return "title";
  if (nowrap && fontSize <= 16 && text.length < 30) return "header";
  return "text";
}

function overlapType(ta: ElemType, tb: ElemType): string {
  const order = (a: ElemType, b: ElemType) => [a, b].sort().join("-");
  const both = order(ta, tb);
  const titleRelated = both.includes("title");
  const headerRelated = ta === "header" || tb === "header" || ta === "footer" || tb === "footer" || ta === "page_number" || tb === "page_number";
  const imageRelated = ta === "image" || tb === "image";
  if (imageRelated) return "image-content";
  if (titleRelated && headerRelated) return "title-header";
  if (titleRelated) return "title-content";
  if (both === "text-text") return "text-text";
  if (both.includes("table")) return "table-content";
  if (headerRelated) return "content-header";
  return "content-content";
}

const FIX_HINTS: Record<string, string> = {
  "image-content": "图片与内容重叠 → 调整图片或相邻元素的 top 值，至少留出 5px 间距",
  "title-header": "标题与右侧页眉重叠 → 如果标题已有 pre-line 则不改变其 white-space，只调整 max-height 值；如果标题是 white-space:nowrap 才可添加 overflow:hidden+max-height",
  "title-content": "标题与正文重叠 → 增大标题的 margin-bottom 或下移下一元素的 top",
  "text-text": "连续正文 OCR 间距不足 → 下移下方的元素（增加 top 值）使间距>=5px",
  "table-content": "表格与附近内容重叠 → 缩小表格宽度（max-width）或调整附近元素位置",
  "content-header": "正文与页眉/页码重叠 → 调整页眉/页码位置或下移正文",
  "content-content": "内容元素重叠 → 调整其中一个元素的 top 或 left 避免碰撞",
};

export function lintHtml(
  html: string,
  opts?: { minOverlapY?: number },
): LintIssue[] {
  const minOverlapY = opts?.minOverlapY ?? DEFAULT_CONFIG.lint.minOverlapY;
  const issues: LintIssue[] = [];
  const { document } = parseHTML(html);
  const pages = [...document.querySelectorAll(".page")] as Element[];

  // Table CSS max-width rules (added by review/beautify): a generic
  // `.det-table table` cap plus per-position caps selected by the div's left.
  const styleText = [...document.querySelectorAll("style")]
    .map((s) => s.textContent || "")
    .join("\n");
  const tableMaxByLeft = new Map<number, number>();
  let tableMax: number | undefined;
  const tableRuleRe =
    /\.det-table(?:\[style\*="left:(-?\d+)px"\])?\s*table\s*\{([^}]*)\}/g;
  for (const m of styleText.matchAll(tableRuleRe)) {
    const maxW = parseFloat(
      (m[2].match(/max-width:([\d.]+)px/) || [])[1] ?? "NaN",
    );
    if (!Number.isFinite(maxW)) continue;
    if (m[1] !== undefined) tableMaxByLeft.set(parseFloat(m[1]), maxW);
    else tableMax = maxW;
  }

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const ps = page.getAttribute("style") || "";
    const pageW = parsePx((ps.match(/width:([\d.]+)px/) || [])[1] || "0");
    const pageH = parsePx((ps.match(/height:([\d.]+)px/) || [])[1] || "0");

    const els = [...page.querySelectorAll("div[style*='position:absolute']")] as Element[];

    const boxes: { left: number; top: number; right: number; bottom: number; width: number; text: string; cls: string; fsize: number; nowrap: boolean; etype: ElemType }[] = [];

    for (const el of els) {
      const s = el.getAttribute("style") || "";
      const left = parsePx((s.match(/left:([\d.]+)px/) || [])[1] || "0");
      const top = parsePx((s.match(/top:([\d.]+)px/) || [])[1] || "0");
      // Only match the width property, not max-width/min-width
      const widthMatches = [...s.matchAll(/(?:^|;)width:([\d.]+)px/g)];
      const width = widthMatches.length
        ? parsePx(widthMatches[widthMatches.length - 1][1])
        : 0;
      const maxWidthMatches = [...s.matchAll(/(?:^|;)max-width:([\d.]+)px/g)];
      const maxWidth = maxWidthMatches.length
        ? parsePx(maxWidthMatches[maxWidthMatches.length - 1][1])
        : 0;
      const height = parsePx((s.match(/height:([\d.]+)px/) || [])[1] || "0");
      const nowrap = s.includes("white-space:nowrap");
      let text = (el.textContent || "").trim();
      const cls = el.className || "";
      const imgKind = el.getAttribute("data-kind");
      // Icons/decorations are not content-level elements; never lint them
      if (imgKind === "icon" || imgKind === "decor") continue;
      // linkedom ignores <img> alt in textContent — extract manually
      if (!text && cls.includes("det-image")) {
        const img = el.querySelector("img");
        text = (img?.getAttribute("alt") || "IMAGE").trim();
      }
      if (!text) continue;
      const fontSize = parsePx((s.match(/font-size:([\d.]+)px/) || [])[1] || "12");
      const bold = s.includes("font-weight:bold");
      const lhMatch = s.match(/line-height:([\d.]+)(px)?/);
      const lh = lhMatch
        ? lhMatch[2]
          ? parsePx(lhMatch[1])
          : fontSize * parseFloat(lhMatch[1])
        : fontSize * 1.5;
      const etype = classifyElem(fontSize, text, top, left, pageH, cls, nowrap, pageW);

      let renderW: number;
      if (cls.includes("det-table")) {
        renderW = text.length * fontSize * 0.55;
      } else if (nowrap) {
        renderW = maxLineTextWidth(text, fontSize, bold);
      } else if (width > 0) {
        renderW = width;
      } else {
        renderW = pageW - left;
      }

      const effW = cls.includes("det-table")
        ? width ||
          (maxWidth
            ? Math.min(maxWidth, renderW)
            : (tableMaxByLeft.get(left) ?? tableMax) !== undefined
              ? Math.min(tableMaxByLeft.get(left) ?? tableMax!, renderW)
              : renderW)
        : nowrap && width > 0
          ? Math.max(width, renderW)
          : width || renderW;
      const lines = cls.includes("det-table")
        ? Math.max(1, Math.ceil((text.length * fontSize * 0.55) / effW))
        : nowrap
          ? 1
          : estimateLineCount(text, effW, fontSize, bold);
      // Use explicit height for images (their textContent is just alt text)
      const renderH = (height > 0 && etype === "image") ? height : lines * lh;

      // Tables whose semantic content is offset inside a code-path grid
      // (contentOffset) render at the inner table's position, not the div's.
      let boxLeft = left;
      let boxTop = top;
      if (cls.includes("det-table")) {
        const innerTable = el.querySelector("table");
        if (innerTable) {
          const ts = innerTable.getAttribute("style") || "";
          const tl = parseFloat(
            (ts.match(/left:(-?[\d.]+)px/) || [])[1] ?? "NaN",
          );
          const tt = parseFloat(
            (ts.match(/top:(-?[\d.]+)px/) || [])[1] ?? "NaN",
          );
          if (Number.isFinite(tl)) boxLeft = left + tl;
          if (Number.isFinite(tt)) boxTop = top + tt;
        }
      }

      boxes.push({ left: boxLeft, top: boxTop, right: boxLeft + effW, bottom: boxTop + renderH, width: effW, text: text.slice(0, 60), cls, fsize: fontSize, nowrap, etype });
    }

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        // Skip same-text overlaps (OCR multi-detection, not real collisions)
        if (a.text.slice(0, 20) === b.text.slice(0, 20)) continue;
        const xOverlap = a.left < b.right && a.right > b.left;
        const yOverlap = a.top < b.bottom && a.bottom > b.top;
        if (xOverlap && yOverlap) {
          // Grid-driven tables span the full PDF frame; page furniture
          // (header/footer/page number) legitimately floats inside the frame
          // top in IMDS-style layouts. That is not a content collision.
          const isTable = a.etype === "table" || b.etype === "table";
          const isFurniture =
            a.etype === "header" || b.etype === "header" ||
            a.etype === "footer" || b.etype === "footer" ||
            a.etype === "page_number" || b.etype === "page_number";
          if (isTable && isFurniture) continue;
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapY > minOverlapY) {
            const st = overlapType(a.etype, b.etype);
            issues.push({
              severity: "error",
              category: "Element overlap",
              subType: st,
              description: `Page ${pi + 1}: "${a.text}" ↔ "${b.text}" overlap ${Math.round(overlapY)}px at y≈${Math.round(a.top)}`,
            });
          }
        }
      }
    }

    for (const b of boxes) {
      if (b.right > pageW + 5 && (b.cls.includes("det-table") || (b.width > 0 && !b.text.includes(" ")))) {
        issues.push({
          severity: "warning",
          category: "Page overflow",
          subType: "overflow",
          description: `Page ${pi + 1}: "${b.text}" right edge ${Math.round(b.right)}px exceeds page ${Math.round(pageW)}px`,
        });
      }
    }

    // Table structure: rows must agree on the column count, otherwise cells
    // (and their borders) are silently missing.
    for (const table of page.querySelectorAll(".det-table table")) {
      const colCounts = [...table.querySelectorAll("tr")].map(
        (tr) =>
          [...tr.querySelectorAll("td,th")].reduce(
            (n, c) => n + parseInt(c.getAttribute("colspan") || "1", 10),
            0,
          ),
      );
      const max = Math.max(0, ...colCounts);
      colCounts.forEach((count, ri) => {
        if (count !== max) {
          issues.push({
            severity: "warning",
            category: "Table structure",
            subType: "table-column-mismatch",
            description: `Page ${pi + 1}: table row ${ri + 1} has ${count} cells, expected ${max}`,
          });
        }
      });
    }
  }

  return issues;
}

export { FIX_HINTS };
