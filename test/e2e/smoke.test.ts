import { describe, it, expect } from "bun:test";
import { spawn } from "bun";

describe("CLI smoke tests", () => {
  it("ptl check exits 0", { timeout: 30000 }, async () => {
    const proc = spawn([process.execPath, "run", "bin/ptl.ts", "check"]);
    await new Response(proc.stdout).text();
    await new Response(proc.stderr).text();
    const code = await proc.exited;
    expect(code).toBe(0);
  });

  it("ptl without args shows usage", { timeout: 30000 }, async () => {
    const proc = spawn([process.execPath, "run", "bin/ptl.ts"]);
    const output = await new Response(proc.stdout).text();
    await new Response(proc.stderr).text();
    expect(output).toContain("Usage");
  });
});
