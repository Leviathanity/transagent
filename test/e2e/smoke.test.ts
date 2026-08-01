import { describe, it, expect } from "bun:test";
import { spawn } from "bun";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

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

  it("ptl interact edits a block from piped stdin", { timeout: 30000 }, async () => {
    const dir = await mkdtemp(`${tmpdir()}/ptl-interact-`);
    const src = `${dir}/in.html`;
    const out = `${dir}/out.html`;
    await Bun.write(
      src,
      '<!doctype html><html><head><style>.x{color:red}</style></head><body><div class="a">AAA</div><div class="b">BBB</div></body></html>',
    );
    // Bun's FileSink stdin pipe does not deliver buffered writes on this runtime
    // (write+end sends nothing), so feed answers through a real shell pipe.
    const shellCmd = `printf 'e\\nINTERACT-MARKER\\ns\\n' | ${JSON.stringify(process.execPath)} run bin/ptl.ts interact ${JSON.stringify(src)} --output ${JSON.stringify(out)}`;
    const proc = spawn(["bash", "-c", shellCmd]);
    await new Response(proc.stdout).text();
    await new Response(proc.stderr).text();
    const code = await proc.exited;
    expect(code).toBe(0);
    const html = await Bun.file(out).text();
    expect(html).toContain("INTERACT-MARKER");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain(".x{color:red}");
    expect(html).toContain('<div class="b">BBB</div>');
  });
});
