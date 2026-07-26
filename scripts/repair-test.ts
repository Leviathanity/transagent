import { readFile, writeFile } from "node:fs/promises";
import { repairTables } from "../src/utils/table-repair.js";

const inputPath = process.argv[2] || "workdir/T3_v016.md";
const outputPath = process.argv[3] || inputPath.replace(/\.md$/, "_repaired.md");

const content = await readFile(inputPath, "utf-8");
const result = repairTables(content);

await writeFile(outputPath, result.repaired, "utf-8");
console.log(JSON.stringify(result.stats, null, 2));
console.log(`Output: ${outputPath}`);

const origLines = content.split("\n").length;
const newLines = result.repaired.split("\n").length;
console.log(`Lines: ${origLines} → ${newLines}`);

const origTables = (content.match(/^\|/gm) || []).length;
const newTables = (result.repaired.match(/^\|/gm) || []).length;
console.log(`Table rows: ${origTables} → ${newTables}`);
