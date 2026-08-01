const CJK_RE =
  /[\u2e80-\u2eff\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/** Character width in em units: CJK glyphs are full-width, Latin ~0.65em. */
export function charWidthEm(ch: string, bold?: boolean): number {
  if (CJK_RE.test(ch)) return 1;
  return bold ? 0.7 : 0.65;
}

/** Estimated pixel width of one logical line. */
export function lineTextWidth(text: string, size: number, bold?: boolean): number {
  const fs = size || 12;
  let w = 0;
  for (const ch of text) w += fs * charWidthEm(ch, bold);
  return w;
}

/** Widest logical line (split on \n) in pixels. */
export function maxLineTextWidth(text: string, size: number, bold?: boolean): number {
  let m = 0;
  for (const line of text.split("\n")) m = Math.max(m, lineTextWidth(line, size, bold));
  return m;
}

/** Number of rendered lines given an effective wrapping width. */
export function estimateLineCount(
  text: string,
  effWidth: number,
  size: number,
  bold?: boolean,
): number {
  const w = Math.max(1, effWidth);
  let n = 0;
  for (const line of text.split("\n")) {
    n += Math.max(1, Math.ceil(lineTextWidth(line, size, bold) / w));
  }
  return n;
}
