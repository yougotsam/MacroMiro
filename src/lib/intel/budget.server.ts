/** Local Firecrawl credit ledger (per calendar month, UTC). Research only: it can suspend crawls, never trade. */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { DATA_ROOT } from "@/lib/data-root";
import { budgetConfig, budgetVerdict, type BudgetVerdict } from "@/lib/intel/sources";

const LEDGER = () => `${DATA_ROOT}/firecrawl-credits.jsonl`;

/** key (e.g. a Firecrawl job id) makes the write idempotent: the same job is never counted twice. */
export function recordCredits(sourceId: string, credits: number | null | undefined, at = new Date(), key?: string) {
  if (!credits || !Number.isFinite(credits)) return;
  if (key) {
    try {
      if (readFileSync(LEDGER(), "utf8").includes(`"key":${JSON.stringify(key)}`)) return;
    } catch {
      /* no ledger yet */
    }
  }
  mkdirSync(DATA_ROOT, { recursive: true });
  appendFileSync(LEDGER(), `${JSON.stringify({ at: at.toISOString(), sourceId, credits, ...(key ? { key } : {}) })}\n`);
}

export function creditsThisMonth(now = new Date()): number {
  const month = now.toISOString().slice(0, 7);
  let total = 0;
  try {
    for (const line of readFileSync(LEDGER(), "utf8").split("\n")) {
      if (!line) continue;
      const row = JSON.parse(line) as { at?: string; credits?: number };
      if (row.at?.startsWith(month)) total += Number(row.credits) || 0;
    }
  } catch {
    /* no ledger yet */
  }
  return total;
}

export function budgetNow(now = new Date()): BudgetVerdict {
  return budgetVerdict(creditsThisMonth(now), budgetConfig());
}
