export function detectDirection(sample: string): "en2zh" | "zh2en" {
  const cjkCount = (sample.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length;
  const ratio = cjkCount / Math.max(sample.length, 1);
  return ratio > 0.3 ? "zh2en" : "en2zh";
}
