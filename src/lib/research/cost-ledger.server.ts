/** Reading local usage must not initialize network clients or require their credentials. */
import { existsSync, readFileSync } from "node:fs";
import type { LedgerEntry } from "./llm-meter";

export function meterSpent(ledger = "/workspace/data/research/llm-usage.jsonl") {
  return (jobId: string) => {
    if (!existsSync(ledger)) return null;
    const rows = readFileSync(ledger, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LedgerEntry).filter((e) => e.tag === jobId);
    if (rows.some(e => !Number.isFinite(e.costUsd) || e.costUsd < 0)) throw new Error("invalid cost ledger row");
    return rows.length ? Number(rows.reduce((a, e) => a + e.costUsd, 0).toFixed(4)) : null;
  };
}
