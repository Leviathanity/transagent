import { describe, it, expect } from "bun:test";
import { spawn } from "bun";

describe("CLI smoke tests", () => {
  it("ptl check exits 0", async () => {
    const proc = spawn(["bun", "run", "bin/ptl.ts", "check"]);
    const code = await proc.exited;
    expect(code).toBe(0);
  });

  it("ptl without args shows usage", async () => {
    const proc = spawn(["bun", "run", "bin/ptl.ts"]);
    const output = await new Response(proc.stdout).text();
    expect(output).toContain("Usage");
  });
});
