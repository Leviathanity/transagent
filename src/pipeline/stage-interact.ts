import { createInterface } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";
import { splitToSeparatedBlocks, assembleFromSeparatedBlocks } from "../splitter/source-block-splitter.js";
import type { StageResult } from "../types/pipeline.js";

export async function stageInteract(
  inputPath: string,
  outputPath: string,
): Promise<StageResult> {
  const content = await readFile(inputPath, "utf-8");
  const blocks = splitToSeparatedBlocks(content);

  console.log(`\n文件: ${inputPath} 共 ${blocks.length} 个 SourceBlock。`);
  console.log("逐段确认: [y]通过 [n]修改 [r]重译 [e]编辑 [s]跳过 [q]退出\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const modifications = new Map<string, string>();

  function ask(question: string): Promise<string> {
    return new Promise((resolve) => rl.question(question, resolve));
  }

  let skipped = false;

  for (let i = 0; i < blocks.length && !skipped; i++) {
    const block = blocks[i].block;
    console.log(`─── [${i + 1}/${blocks.length}] Level ${block.level} ───`);
    console.log(block.text.slice(0, 300) + (block.text.length > 300 ? "\n..." : ""));

    const answer = await ask("[y/n/r/e/s/q]: ");
    switch (answer.toLowerCase()) {
      case "y": break;
      case "n":
        const mod = await ask("修改指令: ");
        console.log(`  [指令]: ${mod}`);
        modifications.set(block.id, block.text);
        break;
      case "r":
        const req = await ask("重译要求: ");
        console.log(`  [重译要求]: ${req}`);
        modifications.set(block.id, block.text);
        break;
      case "e":
        const edit = await ask("直接编辑: ");
        modifications.set(block.id, edit);
        break;
      case "s": skipped = true; break;
      case "q": rl.close(); return { stage: "interact", success: false, error: "User quit" };
    }
  }

  rl.close();

  const final = assembleFromSeparatedBlocks(blocks, (block) => modifications.get(block.id) ?? block.text);
  await writeFile(outputPath, final, "utf-8");
  console.log(`\n输出: ${outputPath}`);
  return { stage: "interact", success: true, outputPath };
}
