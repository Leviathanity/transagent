export interface ReviewIssue {
  id: string;
  severity: "error" | "warning" | "info";
  category: string;
  location: string;
  description: string;
  fixed: boolean;
}

export interface ReviewReport {
  stage: "conversion" | "formatting";
  issues: ReviewIssue[];
  fixCount: number;
}

export interface PipelineConfig {
  inputPath: string;
  outputPath: string;
  direction: "en2zh" | "zh2en";
  glossaryPath?: string;
  reviewModel: string;
  translateModel: string;
  concurrency: number;
  skipInteract: boolean;
  workDir: string;
}

export interface StageResult {
  stage: string;
  success: boolean;
  outputPath?: string;
  output?: string;
  error?: string;
}
