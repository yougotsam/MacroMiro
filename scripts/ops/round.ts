/**
 * Explicit, capped, one-off research round (manual operator action; not a recurring job).
 *   bun scripts/ops/round.ts open <id> <budget> "<reason>"   records Firecrawl's balance at start
 *   bun scripts/ops/round.ts status                          logged spend vs authoritative balance drop
 *   bun scripts/ops/round.ts close
 */
import { openRound, closeRound, currentRound, reconcileRound } from "../../src/lib/grid/fc.server";

const KEY = (process.env.FIRECRAWL_API_KEY ?? "").trim();
async function remaining(): Promise<number | null> {
  const r = await fetch("https://api.firecrawl.dev/v2/team/credit-usage", { headers: { Authorization: `Bearer ${KEY}` } }).catch(() => null);
  const j = (await r?.json().catch(() => null)) as { data?: { remainingCredits?: number } } | null;
  return j?.data?.remainingCredits ?? null;
}
const [cmd, id, budget, ...why] = process.argv.slice(2);
if (cmd === "open") {
  const b = Number(budget);
  if (!id || !(b > 0) || b > 5000) throw new Error("usage: open <id> <budget 1..5000> <reason>");
  console.log(openRound(id, b, why.join(" ") || "operator round", await remaining()));
} else if (cmd === "close") {
  const now = await remaining();
  console.log(now === null ? null : reconcileRound(now));
  closeRound();
  console.log("closed");
} else {
  const now = await remaining();
  console.log({ round: currentRound(), remainingNow: now, reconcile: now === null ? null : reconcileRound(now) });
}
