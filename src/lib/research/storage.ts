/** Local research storage. A stranded lock requires operator inspection, never age-based deletion. */
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function atomicResearchWrite(path: string, text: string) {
  const tmp = `${path}.${process.pid}.tmp`;
  const fd = openSync(tmp, "w");
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
  const dir = openSync(dirname(path), "r");
  try { fsyncSync(dir); } finally { closeSync(dir); }
}

export function researchLock(path: string): () => void {
  const fd = openSync(path, "wx");
  try { writeFileSync(fd, String(process.pid)); fsyncSync(fd); } finally { closeSync(fd); }
  return () => unlinkSync(path);
}
