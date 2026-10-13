/**
 * Seed loop memory from evidence already on disk: POSTMORTEM-20261008.md (Kalshi 15m) and the 21-day perps causal
 * replay finding (LOOP-PDF-DIGEST-DESK.md). Idempotent. Seeds are ACTIVE (approvedBy "seed") because they come from
 * owner-reviewed post-mortem/replay reports; new rules from retros go to the pending queue instead.
 *   bun scripts/loop/seed-lessons.ts
 */
import { addSeedLesson, readState, writeState } from "../../src/lib/loop/state";
const at = "2026-10-13T00:00:00.000Z";
const PM = "huddle/POSTMORTEM-20261008.md";
const seeds = [
  { id: "pm1008-correlated-crypto", scope: "kalshi15m", regime: ["any"], rule: "Treat BTC/ETH/SOL/XRP as one bet: one crypto direction per window, ≤ $3 total across the four.", evidence: `${PM} #1: 3 all-same-direction windows lost −$36.15` },
  { id: "pm1008-features-cannot-create", scope: "kalshi15m", regime: ["any"], rule: "The settlement model alone must clear the full maker floor; indicators may only block or shrink a trade.", evidence: `${PM} #2: 22 fills existed only because of the shift, −$22.02` },
  { id: "pm1008-no-edge-cushion", scope: "kalshi15m", regime: ["any"], rule: "Uncertainty cushion ≥ 4–6¢ and shadow-only until replay shows the model beating the market per coin and TTE bucket.", evidence: `${PM} #3: market Brier beat model (0.2301 vs 0.2366); 39/46 fills −$19.17` },
  { id: "pm1008-no-early-window", scope: "kalshi15m", regime: ["high_vol"], rule: "No new orders with more than 600 s left in the window (sigma too small by 25–33% there).", evidence: `${PM} #4: 26 fills posted with 13–15 min left lost −$15.88` },
  { id: "pm1008-ticker-cap", scope: "kalshi15m", regime: ["any"], rule: "Cap filled + resting cost per ticker per window at $3 (no stacking).", evidence: `${PM} #5: stacking lost −$11.42 beyond $3` },
  { id: "pm1008-no-reset-after-stop", scope: "kalshi15m", regime: ["any"], rule: "No mid-day risk reset after the −$15 stop; a stop is final for the ET day.", evidence: `${PM}: the 04:15 PT reset allowed another −$14.00` },
  { id: "replay21d-no-edge", scope: "perps", regime: ["any"], rule: "The 21-day perps causal replay was negative after costs on every market: no config may be proposed for live without a PASS from the strategy gate.", evidence: "huddle/LOOP-PDF-DIGEST-DESK.md: 21d replay, all markets negative after costs" },
  { id: "fees-coinbase-spot", scope: "all", regime: ["any"], rule: "Coinbase intro fees (0.5% maker / 0.9% taker) make spot scalping non-viable; Coinbase stays read-only.", evidence: "Desk venue notes (VENUE_MATRIX.md)" },
] as const;
let n = 0;
for (const s of seeds) if (addSeedLesson({ ...s, regime: [...s.regime], at, source: "seed" })) n++;
const st = readState(); writeState(st);
console.log(JSON.stringify({ seeded: n, total: seeds.length }));
