# AURIX-X round 3 — change cards (strategy-change-gate)

Bot stays OFF throughout: `CALIBRATED_MODEL_APPROVED = false`, switch files untouched, no engine run. Every change below
is shadow/report-only until its card's stages are completed and the owner signs off. Sizes are research limits.

## Card 1 — research risk limits (owner-approved by Sameer, 2026-10-09)
```
Change:      Day stop −$15 (replaces −$5, as written by the owner); total open worst-case $9; $3 per ticker (all orders on
             one contract); $4 combined same-direction correlated crypto (BTC/ETH/SOL/XRP up, or down, any window);
             per-order $3 unchanged. Optional %-of-account mode, always capped by the USD ceilings. Overrides stay disabled.
Why:         Owner decision for the research phase; per-ticker / correlated limits close the gap where four 15-min crypto
             contracts in the same direction are one bet (see edge-math: correlated bets are not independent).
Hypothesis:  No order can exceed $3 on a ticker or $4 same-direction crypto; daily loss latches at −$15.
Metric:      RiskEngine refusals in tests + OMS harness; live: worst-case exposure in the snapshot never above a limit.
Sample:      Deterministic (unit/regression tests); live: every snapshot.
Pass rule:   0 breaches in tests and in any shadow/live snapshot.
Kill rule:   any breach → stop sending (fail closed) and revert.
Rollback:    src/lib/desk/config.ts RISK_LIMITS (one frozen object); git revert 0f2f931. Owner flips.
Touches:     config.ts, exposure.ts, risk.ts, kalshi-read.ts (+tests). Missing per-ticker/correlated maps → refusal.
```
Note: −$15 LOOSENS the old −$5 stop. It is applied only because the owner approved it explicitly.

## Card 2 — approval requires calibrated probability + conservative EV (flag `APPROVAL_POLICY_ENFORCED`)
```
Change:      A candidate is approvable only with an owner-approved calibrator for the exact model version (Platt, OOS
             Brier < market mid Brier) and EV = P_cal(side) − cushion(0.03) − ask − fee/contract − bucket extra > 0.
             The 13-point confluence score is kept and logged but is not sufficient on its own.
Why:         Historical OOS Brier of desk-v1.0+guard-1 is WORSE than the Kalshi mid (0.1162 vs 0.1130, skill −0.029,
             95 % cluster CI [−0.068, +0.005]); raw model probabilities are not a basis for taking prices.
Hypothesis:  With the rule, shadow approvals have mean net P/L per trade ≥ 0 after fees at executable prices.
Metric:      desk-analyze.ts live-shadow `approval_rule` P/L, clustered by close window.
Sample:      ≥ 200 independent close windows with ≥ 1 approval (CI half-width ≈ 2×SE; chosen so a 5¢/trade edge is
             distinguishable from 0 at the observed ~$0.07–0.08 SE per window-level trade).
Pass rule:   mean − 1.96·clustered SE > 0 AND OOS Brier skill vs mid > 0 with CI lower bound > 0.
Kill rule:   mean + 1.96·clustered SE < 0 after ≥ 100 windows, or calibrator Brier ≥ mid Brier on new data.
Rollback:    config.ts APPROVAL_POLICY_ENFORCED = false (exact old gate behaviour). Owner flips.
Touches:     approval.ts, evaluator.ts, config.ts (APPROVAL_*, calibratorPath).
```
Current state: no calibrator file exists → every candidate fails `G3_approval_no_calibrated_probability` (fail closed).

## Card 3 — time-to-expiry policy (`TIMING_POLICY`)
```
Change:      Timing rules become a named policy by bucket. "current" = old behaviour (only <3 s blocked).
             "final10_proposal" (PROPOSAL, not active): >10 min blocked; 5–10 min normal; 1–5 min +1¢ extra edge;
             final 60 s taker-only, 5¢ price floor, +2¢ extra edge; <3 s blocked.
Why:         Historical OOS skill by bucket: >10m −0.054 (CI [−0.099, −0.006], the only bucket significantly worse than
             the market); 5–10m −0.000; 1–5m −0.037; final-60s −0.056 (CI [−0.37, +0.05]).
Hypothesis:  Blocking >10 min and requiring extra edge late removes the worst-calibrated entries without losing skill.
Metric:      Same-moment comparison in the collector: decisions under "current" vs "final10_proposal" on identical rows.
Sample:      ≥ 200 close windows of shadow data per policy (same moments, so paired).
Pass rule:   proposal's paired P/L difference ≥ 0 with CI lower bound > −1¢/trade, and no bucket with negative OOS skill
             whose CI excludes 0 is allowed.
Kill rule:   proposal's paired P/L difference CI entirely < 0.
Rollback:    config.ts TIMING_POLICY = "current". Owner flips.
Touches:     approval.ts (TIMING_POLICIES, bucketFor), evaluator.ts, config.ts.
```

## Card 4 — research context off the order path (no flag: invariant)
MiroFish / Firecrawl / Spark2 / Alexandria / news are loaded by `research-context.ts` as sourced, timestamped text.
Probabilities are dropped; undated items are dropped. `research-context.test.ts` walks the import graph and fails if any
order-path module (settlement, gate, approval, risk, oms, evaluator, engine, sizing, calibration, desk-engine script)
can reach research-context / intelligence / lib/live / lib/intel / lib/kb.
