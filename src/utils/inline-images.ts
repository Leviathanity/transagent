import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DocumentIR } from "../types/document-ir.js";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

function isExternal(src: string): boolean {
  return src.startsWith("data:") || /^[a-z][a-z0-9+.-]*:\/\//i.test(src);
}

/**
 * Replace a relative image reference with an inline data URI.
 * Missing/unreadable files keep the original reference so rendering never
 * fails; callers that need a hard guarantee can lint for residual refs.
 */
export async function inlineImageSrc(src: string, imageDir?: string): Promise<string> {
  if (!src || !imageDir || isExternal(src)) return src;
  const ext = src.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME_BY_EXT[ext];
  if (!mime) return src;
  try {
    const data = await readFile(resolve(imageDir, src));
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch {
    return src;
  }
}

/** Return a copy of the IR with every image src inlined as a data URI. */
export async function inlineDocumentImages(
  ir: DocumentIR,
  imageDir?: string,
): Promise<DocumentIR> {
  if (!imageDir) return ir;
  const copy = structuredClone(ir);
  for (const page of copy.pages) {
    for (const block of page.blocks) {
      if (block.type === "image") {
        block.src = await inlineImageSrc(block.src, imageDir);
      } else if (block.type === "table" && block.cellImages?.length) {
        block.cellImages = await Promise.all(
          block.cellImages.map(async (img) => ({
            ...img,
            src: await inlineImageSrc(img.src, imageDir),
          })),
        );
      }
    }
  }
  return copy;
}

/** Inline every relative image reference in an existing HTML document. */
export async function inlineHtmlImages(html: string, imageDir?: string): Promise<string> {
  if (!imageDir) return html;
  const srcRe = /src="([^"]+)"/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = srcRe.exec(html))) {
    if (!isExternal(m[1])) seen.add(m[1]);
  }
  const resolved = new Map<string, string>();
  for (const src of seen) {
    const embedded = await inlineImageSrc(src, imageDir);
    if (embedded !== src) resolved.set(src, embedded);
  }
  if (resolved.size === 0) return html;
  let out = html;
  for (const [from, to] of resolved) {
    out = out.replaceAll(`src="${from}"`, `src="${to}"`);
  }
  return out;
}
