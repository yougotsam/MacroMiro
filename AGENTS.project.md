# Macro Miro project-specific engineering rules

GitHub `yougotsam/MacroMiro` is the only canonical source repository. `main` is the release line; make changes on short-lived review branches and merge reviewed PRs back into `main`. Never start a competing trading application or rewrite working components merely to simplify the tree.

## Separate the three kinds of "rules"
1. **Strategy rules**: signal quality, setups, entry direction, timeframes and experimental indicator/news weights. Implement in `src/lib/signal/`, `src/lib/desk/` and `src/lib/perps/` with explicit strategy versions and scenario tests. A high confluence score is not a measured win probability. Do not invent results.
2. **Risk and order rules**: account balance, position ownership, max exposure, stop/target, exchange readiness, durable fill protection, emergency reduce-only exits. These belong at the order-manager boundary. No strategy code or AI narrative may bypass them. Kalshi 15-minute binary and perps require separate product-specific outcome definitions.
3. **Agent/workspace rules**: this file, `AGENTS.md`, and `.grok/skills/` guide developers. They are NOT executable trading policies or a dumping ground for strategy tweaks.

The actual status and next engineering steps live in `README.md` and `docs/operations/REPO_CLEANUP.md`. Read `README.md` first.

## Work discipline
- Inspect current `main` and relevant tests before editing. One repair branch, one focused PR. Avoid competing Grok/ChatGPT copies of the same work.
- Preserve entry/exit invariants; do not suppress failures, bypass protective exits or enable real orders while diagnosing a broken pipeline. No live send or account funding without a separate written operator release approval.
- The current `/api/live/perp-fire` endpoint is hard-locked. A successful Vercel preview is not evidence of a running trading worker.
- Market caches, journals, print streams and raw data are evidence, not garbage. Classify and archive recoverably before untracking; never blindly delete or rewrite repository history.
- Existing historical research must not be relabeled as settled/fill-verified profit. Backtests, correctness tests and data leakage checks can be run without funding an account.
- Keep changes small and explain exactly which code changed, which tests ran, which results are unverified, and what remains blocked.
