# Loop engineering (Loop Engineering PDF primitives → MacroMiro), paper/demo only

Source: `/workspace/loop-eng.txt` (6-page PDF) and huddle digests `LOOP-PDF-DIGEST-{DESK,BOTBOSS}.md`, `LOOP-PDF-CROSSREVIEW-DESK.md`.
Nothing here can place a real order. `CALIBRATED_MODEL_APPROVED` stays `false`; switch files are only read.

| PDF primitive | Where | Notes |
|---|---|---|
| STATE.md loop memory | `src/lib/loop/state.ts` → `$DATA_ROOT/loop/STATE.md` (+ `state.json`) | Rendered from JSON; holds last run, active/pending lessons, incidents. |
| Lessons + pending queue | `lessons.jsonl`, `pending-lessons.jsonl` | Seeded by `scripts/loop/seed-lessons.ts` (POSTMORTEM-20261008 + 21-day replay). Retro rules go to PENDING; only checker/owner can activate (`decideLesson`; maker is refused). |
| Run start/end | `beginRun()` loads active lessons; `endRun()` writes the outcome | Used by `scripts/loop/ab-replay.ts`. |
| Per-trade retros | `writeRetro()` one line each, maker + checker | Checker line is outcome-only. |
| Independent checker | `src/lib/loop/checker.ts` | Blind (`blindTrades` keeps only t/netUsd/oos). Gates: OOS ≥ 200, mean > 0, Newey–West t > 2, max DD ≤ 50%, Sharpe ≥ 0.05/trade; PSR/DSR reported. Verdicts PASS / NEEDS_MORE_EVIDENCE / REJECT (Monte-Neo vocabulary). Decisions logged → rejection-rate tracker. |
| Approval lock | `proposeCalibratedApproval()`, `scripts/loop/propose-approval.ts` | Can only write a *proposal* after a PASS. Never edits config. |
| Verdict bundle | `verdictBundle()` → `$DATA_ROOT/loop/verdict-bundle-<run>.json` | Trade log + gate + method. No reasoning. Not sent anywhere. |
| Risk watchdog (own process) | `scripts/loop/watchdog.ts` + `src/lib/loop/watchdog{,-poll}.ts` | Own PID, polls 60 s, heartbeat `loop/watchdog-heartbeat.json`. Reads paper files only. Kalshi −$15 → `paper-kill.json` + flatten; perps DD ≥ limit → `PerpsOms.killAndFlatten` on a paper exchange. Incidents → STATE.md. |
| Fail-closed | `RiskEngine.check` (Kalshi), `PerpsOms.submit` (perps entries), `scripts/paper/run.ts` (paper entries) | Stale/missing heartbeat (> 3 min) → new entries refused. Exits/flattens still allowed. |
| Hard drawdown | `DEFAULT_DD_LIMIT_PCT = 50` (**PENDING OWNER DECISION**) | = top existing warning. `WATCHDOG_DD_LIMIT_PCT` overrides for paper. |
| Kalshi stop flattens | `src/lib/paper/portfolio.ts replay(entries, mark)` | At −$15 realized, open paper positions close at our-side bid − 1¢. |
| Verification-rot | `scripts/loop/recalibrate.ts` | Precision/recall of gate approvals vs outcomes, per week. |
| Stop conditions + budget | `src/lib/loop/budget.ts LoopGuard` | Iterations, USD, tokens, wall clock, consecutive errors, no-progress. |
| Curiosity budget | `scripts/loop/weekly-report.ts` | Plain-English weekly “what changed and why”. Not scheduled. |
| Schemas | `src/lib/loop/schema.ts` | Lesson, Retro, Incident (SRE), RunOutcome, SkillFile (goal/rules/lessons/regime). Example: `docs/skills/perps-scalper.skill.md`. |
| Worktrees | `scripts/loop/worktrees.sh add all` | `../MacroMiro-wt/{research,backtest,risk}` on branches `wt/*`. Same repo. Research edits research code, backtest runs sims, risk owns watchdog/risk changes; merge via PR only. |
| AI maker | `src/lib/loop/maker.ts` (CodeMaker, LlmMaker, StubMaker), `src/lib/perps/sim.ts` `select` hook | LLM maker reuses `brain.server.ts askBrain`; real token cost charged against P&L; capped by LoopGuard. A/B: `bun scripts/loop/ab-replay.ts --cap 3`. |

## Commands
```
bun scripts/loop/seed-lessons.ts
nohup bun scripts/loop/watchdog.ts > $DATA_ROOT/loop/watchdog.log 2>&1 &   # paper; heartbeat every 60 s
bun scripts/loop/ab-replay.ts --cap 3 [--stub]
bun scripts/loop/recalibrate.ts
bun scripts/loop/weekly-report.ts
bun scripts/loop/propose-approval.ts perps-ab/code    # exits 2 unless the gate PASSED
scripts/loop/worktrees.sh add all
```

## Web references (patterns borrowed)
- Addy Osmani, “Loop Engineering” — https://addyosmani.com/blog/loop-engineering/ (five primitives: automations, worktrees, skills, connectors, sub-agents; `/goal` = a separate model checks the stop condition so the writer doesn’t grade itself). Borrowed: separate checker, verifiable stop condition.
- Cobus Greyling, cobusgreyling/loop-engineering — https://github.com/cobusgreyling/loop-engineering (skill → STATE.md → worktree → implementer → verifier → human gate; `loop-budget.md` token caps; `loop-run-log.md`; report-only first week). Borrowed: STATE.md + run log + budget file + human gate.
- Monte-Neo — https://neozork.github.io/Monte-Neo/ (independent verifier verdicts PASS / PASS_WITH_WARNINGS / NEEDS_MORE_EVIDENCE / REJECT). Borrowed: verdict vocabulary.
- Bailey & López de Prado DSR / Newey–West auto lag floor(4(T/100)^(2/9)) — via https://github.com/Aliipou/backtest-audit and https://ml4trading.io/docs/diagnostic/methods/hac-ic/ . Borrowed: NW lag rule, DSR with n_trials.
Unverified: star counts and any claimed production results in those pages.
