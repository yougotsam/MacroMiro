/**
 * Statement-diff and revision engine (local, no credits). Works on markdown from Firecrawl scrape/parse.
 * Output is EVIDENCE: language changes are never buy/sell signals and never touch probabilities.
 */
import { createHash } from "node:crypto";

export type SentenceChange = { kind: "added" | "removed" | "changed"; before?: string; after?: string; similarity?: number };
export type StatementDiff = { beforeHash: string; afterHash: string; identical: boolean; changes: SentenceChange[]; changedShare: number; note: "language change is evidence, not a trading signal" };

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export function sentences(md: string): string[] {
  return md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>`|]/g, " ")
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 25);
}

function tokens(s: string) {
  return new Set(s.toLowerCase().match(/[a-z0-9.%-]+/g) ?? []);
}
export function similarity(a: string, b: string) {
  const A = tokens(a);
  const B = tokens(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return A.size + B.size === 0 ? 1 : (2 * inter) / (A.size + B.size);
}

export function diffStatements(before: string, after: string): StatementDiff {
  const a = sentences(before);
  const b = sentences(after);
  const aSet = new Set(a);
  const bSet = new Set(b);
  const gone = a.filter((s) => !bSet.has(s));
  const fresh = b.filter((s) => !aSet.has(s));
  const changes: SentenceChange[] = [];
  const used = new Set<number>();
  for (const s of fresh) {
    let best = -1;
    let score = 0;
    gone.forEach((g, i) => {
      if (used.has(i)) return;
      const sim = similarity(g, s);
      if (sim > score) {
        score = sim;
        best = i;
      }
    });
    if (best >= 0 && score >= 0.6) {
      used.add(best);
      changes.push({ kind: "changed", before: gone[best], after: s, similarity: Math.round(score * 100) / 100 });
    } else changes.push({ kind: "added", after: s });
  }
  gone.forEach((g, i) => {
    if (!used.has(i)) changes.push({ kind: "removed", before: g });
  });
  return { beforeHash: hash(before), afterHash: hash(after), identical: hash(before) === hash(after), changes, changedShare: b.length ? changes.length / Math.max(a.length, b.length) : 0, note: "language change is evidence, not a trading signal" };
}

/** Markdown table rows → {label: [cells]}. Used to spot revised numbers between two releases. */
export function tableRows(md: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of md.split("\n")) {
    if (!line.trim().startsWith("|") || /^\|\s*-/.test(line.trim())) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length >= 2 && cells[0]) rows.set(cells[0].toLowerCase(), cells.slice(1));
  }
  return rows;
}

export type Revision = { row: string; column: number; before: string; after: string };
export function detectRevisions(beforeMd: string, afterMd: string): Revision[] {
  const a = tableRows(beforeMd);
  const b = tableRows(afterMd);
  const out: Revision[] = [];
  for (const [row, cells] of b) {
    const old = a.get(row);
    if (!old) continue;
    cells.forEach((c, i) => {
      if (old[i] !== undefined && old[i] !== c && /\d/.test(c) && /\d/.test(old[i])) out.push({ row, column: i, before: old[i], after: c });
    });
  }
  return out;
}
