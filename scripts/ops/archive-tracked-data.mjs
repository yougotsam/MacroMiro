#!/usr/bin/env node
/**
 * Safe Macro Miro data audit / archive. Never deletes or untracks anything.
 *
 * node scripts/ops/archive-tracked-data.mjs
 * node scripts/ops/archive-tracked-data.mjs --archive=/absolute/private/storage/unique-backup-dir
 *
 * Explicit archive mode requires a NEW directory OUTSIDE the repository.
 * Use the generated manifest only after verifying restore and retention.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const root = git("rev-parse", "--show-toplevel").trim();
const commit = git("rev-parse", "HEAD").trim();
const args = process.argv.slice(2);
if (args.some((a) => a !== "--plan" && !a.startsWith("--archive=")) || args.filter((a) => a.startsWith("--archive=")).length > 1) {
  throw new Error("Usage: node scripts/ops/archive-tracked-data.mjs [--plan | --archive=/absolute/new/dir]");
}
const destArg = args.find((a) => a.startsWith("--archive="))?.slice("--archive=".length);
const destination = destArg ? resolve(destArg) : null;
if (destArg) {
  if (!isAbsolute(destArg)) throw new Error("Archive destination must be an absolute private path");
  if (destination === root || destination.startsWith(root + sep)) {
    throw new Error("Archive destination cannot be inside Git repository");
  }
  if (existsSync(destination)) throw new Error("Archive destination must be a new, empty path");
}
const files = git("ls-files", "-z", "--", "data").split("\0").filter(Boolean);
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const rows = [];
for (const path of files) {
  const src = resolve(root, path);
  if (!src.startsWith(root + sep) || !existsSync(src)) {
    throw new Error("Missing or invalid tracked data path: " + path);
  }
  const st = lstatSync(src);
  if (!st.isFile() || st.isSymbolicLink()) throw new Error("Nonregular data path: " + path);
  rows.push({ path, bytes: st.size });
}
rows.sort((a, b) => b.bytes - a.bytes);
const totalBytes = rows.reduce((a, b) => a + b.bytes, 0);
if (!destination) {
  console.log(JSON.stringify({
    mode: "PLAN_ONLY", sourceCommit: commit, trackedFiles: rows.length, totalBytes,
    topFiles: rows.slice(0, 15),
    next: "Archive to a private external directory, verify the manifest, then review untracking in a separate PR",
  }, null, 2));
  process.exit(0);
}
mkdirSync(destination, { recursive: true, mode: 0o700 });
const manifest = [];
for (const entry of rows) {
  const src = resolve(root, entry.path);
  const out = join(destination, entry.path);
  mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
  copyFileSync(src, out);
  const before = sha256(src), after = sha256(out);
  if (before !== after) throw new Error("Archive checksum mismatch: " + entry.path);
  manifest.push({ ...entry, sha256: before });
}
writeFileSync(join(destination, "manifest.json"), JSON.stringify({
  sourceRepository: "yougotsam/MacroMiro",
  sourceCommit: commit, createdAt: new Date().toISOString(),
  trackedFiles: rows.length, totalBytes, files: manifest,
}, null, 2), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({
  mode: "ARCHIVED_AND_VERIFIED", destination, sourceCommit: commit,
  trackedFiles: rows.length, totalBytes, deletedFiles: 0,
  next: "Independently test a restore before removing anything from Git",
}, null, 2));
