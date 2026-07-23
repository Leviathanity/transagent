import type { GlossaryEntry } from "../types/glossary.js";

export function formatForPrompt(entries: GlossaryEntry[]): string {
  if (entries.length === 0) return "";

  const lines: string[] = ["## 术语表 (Glossary)", ""];

  for (const entry of entries) {
    const flag = entry.regex ? " [regex]" : "";
    const ctx = entry.context ? ` — ${entry.context}` : "";
    lines.push(`- \`${entry.source}\`${flag} → **${entry.target}**${ctx}`);
  }

  lines.push("");
  lines.push("遇到上述术语时，必须使用术语表中的指定翻译。");
  return lines.join("\n");
}
