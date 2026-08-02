#!/usr/bin/env bun
// Usage: bun run scripts/serve-results.ts [--port 8080] [--root <dir>]
import { parseArgs } from "node:util";
import { startResultServer } from "../src/utils/result-server.js";

const { values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    port: { type: "string" },
    root: { type: "string" },
  },
  strict: false,
});

await startResultServer({
  port: values.port ? parseInt(values.port, 10) : undefined,
  root: values.root as string | undefined,
});

// Keep the process alive; Bun.serve holds the event loop open.
await new Promise(() => {});
