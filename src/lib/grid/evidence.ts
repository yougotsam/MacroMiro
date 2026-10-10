/**
 * Evidence store (local JSONL, separate from Alexandria). Every item keeps raw-evidence hash, source URL, and three
 * timestamps: source publication, Firecrawl detection, local storage. Items are deduped by content hash.
 * Untrusted web text is screened for prompt injection; flagged text is kept as evidence but marked and never fed
 * to Spark/MiroFish as instructions. Nothing here can trade.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DATA_ROOT } from "@/lib/data-root";

export type EvidenceKind = "monitor_change" | "official_release" | "spark_report" | "alexandria_data" | "mirofish_link" | "statement_diff";
export type Evidence = {
  id: string; kind: EvidenceKind; sourceUrl: string | null; title: string;
  publishedAt: string | null; detectedAt: string; storedAt: string;
  hash: string; jobIds: Record<string, string>; related: string[];
  injectionFlag: boolean; stale: boolean; summary: string; payload: unknown;
  note: "research evidence only: cannot place, amend or cancel orders or change probabilities";
};

const FILE = () => `${DATA_ROOT}/research/evidence.jsonl`;

const INJECTION = /(ignore (all |any )?(previous|prior|above) (instructions|prompts)|disregard (the )?(system|previous)|you are now|system prompt|place (an? )?(order|trade)|execute (a )?trade|buy \d+ contracts|override (risk|limits)|api[_ ]?key|reveal (your )?(secrets|credentials))/i;
export function injectionFlag(text: string) {
  return INJECTION.test(text);
}

export function evidenceHash(kind: EvidenceKind, sourceUrl: string | null, body: string) {
  return createHash("sha256").update(`${kind}|${sourceUrl ?? ""}|${body.replace(/\s+/g, " ").trim().toLowerCase()}`).digest("hex").slice(0, 20);
}

export function readEvidence(): Evidence[] {
  try {
    return readFileSync(FILE(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Evidence);
  } catch {
    return [];
  }
}

export function storeEvidence(e: Omit<Evidence, "id" | "hash" | "storedAt" | "injectionFlag" | "stale" | "note"> & { body: string; freshHours?: number }): { stored: boolean; evidence: Evidence } {
  const hash = evidenceHash(e.kind, e.sourceUrl, e.body);
  const existing = readEvidence().find((x) => x.hash === hash);
  if (existing) return { stored: false, evidence: existing };
  const now = Date.now();
  const pub = Date.parse(e.publishedAt ?? "");
  const stale = Number.isFinite(pub) && e.freshHours !== undefined ? now - pub > e.freshHours * 3_600_000 : false;
  const { body, freshHours: _f, ...rest } = e;
  void _f;
  const ev: Evidence = { ...rest, id: `ev-${hash}`, hash, storedAt: new Date(now).toISOString(), injectionFlag: injectionFlag(body), stale, note: "research evidence only: cannot place, amend or cancel orders or change probabilities" };
  mkdirSync(`${DATA_ROOT}/research`, { recursive: true });
  appendFileSync(FILE(), `${JSON.stringify(ev)}\n`);
  return { stored: true, evidence: ev };
}

/** Major official catalysts merit Spark 2; MiroFish only for major scheduled releases/shocks, never for dupes or flagged text. */
export function decideFollowUp(ev: Evidence, opts: { majorKinds?: RegExp } = {}): { spark: boolean; mirofish: boolean; reason: string } {
  if (ev.injectionFlag) return { spark: false, mirofish: false, reason: "possible prompt injection in source text" };
  if (ev.stale) return { spark: false, mirofish: false, reason: "stale" };
  const major = (opts.majorKinds ?? /\b(cpi|consumer price|fomc|federal open market|employment situation|payrolls|pce|gdp|etf (approval|decision)|exchange (outage|halt))\b/i).test(`${ev.title} ${ev.summary}`);
  const official = /\.gov(\/|$)/.test(ev.sourceUrl ?? "");
  if (major && official) return { spark: true, mirofish: true, reason: "major official catalyst" };
  if (official || major) return { spark: true, mirofish: false, reason: official ? "official source, not a major release" : "major topic, non-official source" };
  return { spark: false, mirofish: false, reason: "routine" };
}
