/**
 * Deterministic stop conditions + token/USD budget guard for any loop (PDF: "loops need a stop rule and a budget").
 * A loop calls `guard.check()` before every iteration and `guard.charge()` after every LLM call; it must stop when
 * `check()` returns a reason. No randomness, no wall-clock-only logic without a cap.
 */
export type StopCfg = { maxIterations: number; maxUsd: number; maxTokens: number; maxWallMs: number; maxConsecutiveErrors: number; maxNoProgress: number };
export const DEFAULT_STOP: StopCfg = { maxIterations: 500, maxUsd: 3, maxTokens: 2_000_000, maxWallMs: 30 * 60_000, maxConsecutiveErrors: 3, maxNoProgress: 50 };
export class LoopGuard {
  iterations = 0; usd = 0; tokens = 0; errors = 0; noProgress = 0; startedAt: number; stopped: string | null = null;
  constructor(public cfg: StopCfg = DEFAULT_STOP, private now = () => Date.now()) { this.startedAt = now(); }
  /** Would this projected spend breach the cap? Call BEFORE an LLM call. */
  canSpend(projectedUsd: number, projectedTokens = 0) { return this.usd + projectedUsd <= this.cfg.maxUsd + 1e-12 && this.tokens + projectedTokens <= this.cfg.maxTokens; }
  charge(usd: number, tokens: number) { this.usd += usd; this.tokens += tokens; }
  tick(progress: boolean, error = false) { this.iterations++; this.errors = error ? this.errors + 1 : 0; this.noProgress = progress ? 0 : this.noProgress + 1; }
  check(): string | null {
    if (this.stopped) return this.stopped;
    const c = this.cfg;
    const r = this.iterations >= c.maxIterations ? `max iterations ${c.maxIterations}` : this.usd >= c.maxUsd ? `budget $${c.maxUsd} spent` : this.tokens >= c.maxTokens ? `token cap ${c.maxTokens}` :
      this.now() - this.startedAt >= c.maxWallMs ? `wall clock ${c.maxWallMs} ms` : this.errors >= c.maxConsecutiveErrors ? `${this.errors} consecutive errors` : this.noProgress >= c.maxNoProgress ? `${this.noProgress} iterations without progress` : null;
    if (r) this.stopped = r; return r;
  }
  snapshot() { return { iterations: this.iterations, usd: +this.usd.toFixed(6), tokens: this.tokens, stopped: this.stopped }; }
}
