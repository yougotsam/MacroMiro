/** Dynamic discovery of the collector's day files (no hard-coded dates) and safe directory creation. */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";

export function dayFiles(dir: string, prefix: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".jsonl")).sort().map((f) => `${dir}/${f}`);
}

export function readJsonlFiles<T>(files: string[], keep?: (line: string) => boolean): T[] {
  const out: T[] = [];
  for (const f of files) {
    let text = "";
    try { text = readFileSync(f, "utf8"); } catch { continue; }
    for (const l of text.split("\n")) {
      if (!l || (keep && !keep(l))) continue;
      try { out.push(JSON.parse(l) as T); } catch { /* partial line */ }
    }
  }
  return out;
}

export function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
  return dir;
}
