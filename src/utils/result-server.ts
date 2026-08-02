import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { execa } from "execa";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".ico": "image/x-icon",
};

/** Resolve a URL pathname inside root; returns null for traversal attempts. */
export function resolveWithinRoot(root: string, pathname: string): string | null {
  const rel = pathname === "/" ? "." : pathname.replace(/^\/+/, "");
  const target = resolve(root, rel);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function renderIndex(
  root: string,
  pathname: string,
  target: string,
): Promise<string> {
  const entries = await readdir(target, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const base = pathname === "/" ? "/" : pathname.endsWith("/") ? pathname : `${pathname}/`;
  const rows = await Promise.all(
    entries.map(async (e) => {
      const href = `${base}${encodeURIComponent(e.name)}${e.isDirectory() ? "/" : ""}`;
      let size = "—";
      if (e.isFile()) {
        try {
          size = formatSize((await stat(join(target, e.name))).size);
        } catch {
          size = "?";
        }
      }
      return `<tr><td><a href="${escapeHtml(href)}">${escapeHtml(e.name)}${e.isDirectory() ? "/" : ""}</a></td><td style="text-align:right;color:#888">${size}</td></tr>`;
    }),
  );

  const up =
    pathname === "/"
      ? ""
      : `<p><a href="${escapeHtml(base.slice(0, base.lastIndexOf("/", base.length - 2) + 1))}">← 上级目录</a></p>`;

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(pathname)} — ptl 测试结果</title>
<style>
body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#222;}
h1{font-size:1.2rem;border-bottom:1px solid #ddd;padding-bottom:.5rem;}
table{border-collapse:collapse;width:100%;font-size:.95rem;}
td{padding:.35rem .5rem;border-bottom:1px solid #eee;}
a{color:#0b57d0;text-decoration:none;} a:hover{text-decoration:underline;}
code{background:#f4f4f4;padding:.1rem .35rem;border-radius:4px;}
</style></head><body>
<h1>📄 ${escapeHtml(pathname === "/" ? "测试结果归档" : pathname)}</h1>
${up}
<table>${rows.join("\n")}</table>
<p style="color:#888;font-size:.85rem">服务目录：<code>${escapeHtml(root)}</code> · .md 文件浏览器可直接查看原文</p>
</body></html>`;
}

export interface ResultServerOptions {
  port?: number;
  root?: string;
  hostname?: string;
}

/** First non-internal IPv4 address, for LAN access hints. */
export function getLanAddresses(): string[] {
  const out: string[] = [];
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal) out.push(info.address);
    }
  }
  return [...new Set(out)];
}

/** True for IPs that look like a physical LAN adapter (not loopback/APIPA/WSL NAT). */
export function isHostLanCandidate(ip: string): boolean {
  if (ip.startsWith("127.") || ip.startsWith("169.254.")) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false; // typical WSL/Hyper-V NAT range
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);
}

/**
 * Best-effort Windows host LAN IP detection (WSL only). Returns [] when
 * interop is unavailable or the parse fails.
 */
export async function detectWindowsLanIp(): Promise<string[]> {
  if (!existsSync("/proc/sys/fs/binfmt_misc/WSLInterop")) return [];
  try {
    const { stdout } = await execa("/mnt/c/Windows/System32/ipconfig.exe", [], {
      timeout: 8000,
    });
    const ips: string[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(
        /(?:IPv4[^\d]*|IPv4 地址[^\d]*|IP[- ]Address[^\d]*)(\d{1,3}(?:\.\d{1,3}){3})/i,
      );
      if (m && isHostLanCandidate(m[1])) ips.push(m[1]);
    }
    return [...new Set(ips)];
  } catch {
    return [];
  }
}

export async function startResultServer(options: ResultServerOptions = {}) {
  const root = resolve(
    options.root ?? join(process.cwd(), "workdir", "ir-e2e-final-2026-08-01-v2"),
  );
  const port = options.port ?? 8080;
  const hostname = options.hostname ?? "0.0.0.0";

  const server = Bun.serve({
    port,
    hostname,
    async fetch(req) {
      const url = new URL(req.url);
      let pathname = "/";
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return new Response("Bad request", { status: 400 });
      }
      const target = resolveWithinRoot(root, pathname);
      if (!target) return new Response("Forbidden", { status: 403 });

      try {
        const info = await stat(target);
        if (info.isDirectory()) {
          return new Response(await renderIndex(root, pathname, target), {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        const data = await readFile(target);
        const type = MIME[extname(target).toLowerCase()] ?? "application/octet-stream";
        return new Response(data, {
          headers: { "content-type": type, "content-length": String(data.byteLength) },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  });

  const urls =
    hostname === "0.0.0.0" || hostname === "::"
      ? [`http://localhost:${server.port}/`, `http://127.0.0.1:${server.port}/`]
      : [`http://${hostname}:${server.port}/`];
  console.log(`ptl serve 已启动`);
  console.log(`  根目录: ${root}`);
  console.log(`  地址:   ${urls.join("  /  ")}`);
  if (hostname === "0.0.0.0" || hostname === "::") {
    const lan = getLanAddresses();
    if (lan.length > 0) {
      console.log(`  局域网: ${lan.map((ip) => `http://${ip}:${server.port}/`).join("  /  ")}`);
    }
    if (existsSync("/proc/sys/fs/binfmt_misc/WSLInterop")) {
      const hostIps = await detectWindowsLanIp();
      if (hostIps.length > 0) {
        console.log(
          `  宿主机: ${hostIps.map((ip) => `http://${ip}:${server.port}/`).join("  /  ")}（局域网设备访问此地址）`,
        );
      }
      if (lan.length > 0) {
        console.log(
          `  提示: WSL2 NAT 模式下，请先在 Windows 管理员终端执行端口转发与防火墙放行，` +
            `局域网设备才能通过宿主机 IP 访问:\n` +
            `    netsh interface portproxy add v4tov4 listenport=${server.port} listenaddress=0.0.0.0 connectport=${server.port} connectaddress=${lan[0]}\n` +
            `    netsh advfirewall firewall add rule name="ptl-serve-${server.port}" dir=in action=allow protocol=TCP localport=${server.port}`,
        );
      }
    }
  }
  return server;
}
