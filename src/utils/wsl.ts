import { existsSync, readFileSync } from "node:fs";

/** Detect a WSL environment robustly (binfmt marker, kernel string, /mnt/c). */
export function isRunningInWsl(): boolean {
  try {
    if (existsSync("/proc/sys/fs/binfmt_misc/WSLInterop")) return true;
    if (/microsoft/i.test(readFileSync("/proc/version", "utf-8"))) return true;
    if (existsSync("/mnt/c")) return true;
    return false;
  } catch {
    return false;
  }
}
