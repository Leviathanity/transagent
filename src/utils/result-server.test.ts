import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startResultServer,
  resolveWithinRoot,
  isHostLanCandidate,
} from "./result-server.js";

// The exec sandbox blocks listen(2) entirely; probe once so the server tests
// are skipped there and run normally on a real machine.
let canListen = false;
try {
  const probe = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("probe"),
  });
  canListen = true;
  probe.stop(true);
} catch {
  canListen = false;
}

describe("resolveWithinRoot", () => {
  it("resolves inside the root and rejects traversal", () => {
    const root = "/tmp/ptl-root";
    expect(resolveWithinRoot(root, "/a.html")).toBe("/tmp/ptl-root/a.html");
    expect(resolveWithinRoot(root, "/")).toBe("/tmp/ptl-root");
    expect(resolveWithinRoot(root, "/../secret")).toBeNull();
    expect(resolveWithinRoot(root, "/sub/../../secret")).toBeNull();
  });
});

describe("isHostLanCandidate", () => {
  it("accepts physical LAN IPs and rejects loopback/APIPA/WSL NAT", () => {
    expect(isHostLanCandidate("192.168.2.118")).toBe(true);
    expect(isHostLanCandidate("10.0.0.5")).toBe(true);
    expect(isHostLanCandidate("127.0.0.1")).toBe(false);
    expect(isHostLanCandidate("169.254.1.1")).toBe(false);
    expect(isHostLanCandidate("172.22.164.215")).toBe(false);
    expect(isHostLanCandidate("not-an-ip")).toBe(false);
  });
});

describe.skipIf(!canListen)("startResultServer", () => {
  let dir = "";
  let server: ReturnType<typeof Bun.serve> | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ptl-serve-"));
    await writeFile(join(dir, "index.html"), "<h1>final output</h1>", "utf-8");
    await writeFile(join(dir, "REPORT.md"), "# 测试报告", "utf-8");
    await writeFile(join(dir, "data.ir.json"), '{"pages":[]}', "utf-8");
    await Bun.$`mkdir -p ${join(dir, "v1")}`.quiet();
    await writeFile(join(dir, "v1", "README.md"), "v1 archive", "utf-8");
    server = await startResultServer({ port: 0, root: dir, hostname: "127.0.0.1" });
  });

  afterAll(() => {
    server?.stop(true);
  });

  it("serves a directory index with links", async () => {
    const res = await fetch(`http://127.0.0.1:${server!.port}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("index.html");
    expect(text).toContain("REPORT.md");
    expect(text).toContain("v1/");
    expect((res.headers.get("content-type") ?? "").startsWith("text/html")).toBe(true);
  });

  it("serves files with correct content types", async () => {
    const html = await fetch(`http://127.0.0.1:${server!.port}/index.html`);
    expect(await html.text()).toContain("final output");
    expect(html.headers.get("content-type")).toContain("text/html");

    const json = await fetch(`http://127.0.0.1:${server!.port}/data.ir.json`);
    expect(json.headers.get("content-type")).toContain("application/json");
    expect(await json.text()).toBe('{"pages":[]}');
  });

  it("serves nested directories and returns 404 for missing files", async () => {
    const nested = await fetch(`http://127.0.0.1:${server!.port}/v1/README.md`);
    expect(nested.status).toBe(200);
    expect(await nested.text()).toContain("v1 archive");

    const missing = await fetch(`http://127.0.0.1:${server!.port}/nope.html`);
    expect(missing.status).toBe(404);
  });
});
