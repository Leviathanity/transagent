import { readFile, writeFile } from "node:fs/promises";
import { splitHtmlToBlocks, assembleHtmlBlocks } from "../splitter/html-block-splitter.js";
import type { StageResult } from "../types/pipeline.js";

export async function stageInteract(
  inputPath: string,
  outputPath: string,
): Promise<StageResult> {
  const content = await readFile(inputPath, "utf-8");
  const bodyOpen = content.match(/<body[^>]*>/i);
  const bodyClose = content.match(/<\/body>/i);
  const blocks = splitHtmlToBlocks(content);

  console.log(`\n文件: ${inputPath} 共 ${blocks.length} 个 SourceBlock。`);
  console.log("逐段确认: [y]通过 [n]修改 [r]重译 [e]编辑 [s]跳过 [q]退出\n");

  const modifications = new Map<string, string>();
  const lineQueue: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  let inputBuffer = "";
  let inputClosed = false;

  function deliverLine(line: string): void {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else lineQueue.push(line);
  }

  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk: string) => {
    inputBuffer += chunk;
    let nl = inputBuffer.indexOf("\n");
    while (nl >= 0) {
      deliverLine(inputBuffer.slice(0, nl).replace(/\r$/, ""));
      inputBuffer = inputBuffer.slice(nl + 1);
      nl = inputBuffer.indexOf("\n");
    }
  });
  process.stdin.on("end", () => {
    if (inputBuffer.length > 0) deliverLine(inputBuffer);
    inputClosed = true;
    for (const waiter of waiters.splice(0)) waiter("s");
  });

  function ask(question: string): Promise<string> {
    process.stdout.write(`${question} `);
    const queued = lineQueue.shift();
    if (queued !== undefined) return Promise.resolve(queued.trim());
    if (inputClosed) return Promise.resolve("s");
    return new Promise((resolve) => waiters.push(resolve));
  }

  let skipped = false;

  for (let i = 0; i < blocks.length && !skipped; i++) {
    const block = blocks[i].block;
    console.log(`─── [${i + 1}/${blocks.length}] Level ${block.level} ───`);
    const displayText = block.text
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .slice(0, 300);
    console.log(displayText + (block.text.length > 300 ? "\n..." : ""));

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
      case "q":
        process.stdin.removeAllListeners("data");
        process.stdin.removeAllListeners("end");
        process.stdin.pause();
        return { stage: "interact", success: false, error: "User quit" };
    }
  }

  const final = assembleHtmlBlocks(blocks, (block) => modifications.get(block.id) ?? block.text);
  const shelled =
    bodyOpen?.index !== undefined &&
    bodyClose?.index !== undefined &&
    bodyClose.index > bodyOpen.index
      ? content.slice(0, bodyOpen.index + bodyOpen[0].length) +
        final +
        content.slice(bodyClose.index)
      : final;
  process.stdin.removeAllListeners("data");
  process.stdin.removeAllListeners("end");
  process.stdin.pause();
  await writeFile(outputPath, shelled, "utf-8");
  console.log(`\n输出: ${outputPath}`);
  return { stage: "interact", success: true, outputPath };
}
