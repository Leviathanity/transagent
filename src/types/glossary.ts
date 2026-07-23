export interface GlossaryEntry {
  source: string;
  target: string;
  context?: string;
  regex?: boolean;
  caseSensitive?: boolean;
}

export interface GlossaryFile {
  version: string;
  direction: "en2zh" | "zh2en";
  entries: GlossaryEntry[];
}
