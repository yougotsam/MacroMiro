/**
 * Keeps each asset's closed 15-minute bars current for the live checklist. Starts from the file on disk and
 * pulls the newest 300 bars from Coinbase's public candles (no key, no cost) at most once per bar. Gold comes from
 * OKX's public XAU-USDT-SWAP candles (tracks spot gold; Coinbase has no gold, and PAXG is a token, not gold).
 * A failed pull keeps the old bars; the checklist's freshness step then refuses the ticket.
 */
import { readBars, PRODUCT_OF } from "./store";
import type { Bar } from "./ta";

const BAR = 15 * 60_000;
const KEEP = 1200;

export class LiveBars {
  private bars = new Map<string, Bar[]>();
  private pulledFor = new Map<string, number>();
  private inflight = new Map<string, Promise<void>>();
  constructor(private fetcher: typeof fetch = fetch) {}

  get(asset: string): Bar[] {
    if (!this.bars.has(asset)) this.bars.set(asset, readBars(asset).slice(-KEEP));
    return this.bars.get(asset) ?? [];
  }

  private async coinbase(asset: string): Promise<Bar[] | null> {
    const r = await this.fetcher(`https://api.exchange.coinbase.com/products/${PRODUCT_OF[asset]}/candles?granularity=900`, { headers: { "user-agent": "macromiro-signal" } });
    if (!r.ok) return null;
    return ((await r.json()) as number[][]).map(([t, l, h, o, c, v]) => ({ t: t * 1000, o, h, l, c, v }));
  }

  /** OKX candles: [ts, o, h, l, c, vol, volCcy, volQuote, confirm]; only confirmed (closed) bars. */
  private async okxGold(): Promise<Bar[] | null> {
    const r = await this.fetcher("https://www.okx.com/api/v5/market/candles?instId=XAU-USDT-SWAP&bar=15m&limit=300", { headers: { "user-agent": "macromiro-signal" } });
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: string[][] };
    return (j.data ?? []).filter((c) => c[8] === "1").map((c) => ({ t: Number(c[0]), o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[6] }));
  }

  /** Pull once per closed bar (5 s after the close). Never throws. */
  refresh(asset: string, now = Date.now()): Promise<void> {
    const due = Math.floor((now - 5_000) / BAR) * BAR;
    if ((this.pulledFor.get(asset) ?? 0) >= due) return Promise.resolve();
    const running = this.inflight.get(asset);
    if (running) return running;
    const p = (async () => {
      try {
        const rows = asset === "GOLD" ? await this.okxGold() : await this.coinbase(asset);
        if (!rows) return;
        const merged = new Map(this.get(asset).map((b) => [b.t, b]));
        for (const b of rows) if (b.t + BAR <= now) merged.set(b.t, b); // closed bars only
        this.bars.set(asset, [...merged.values()].sort((a, b) => a.t - b.t).slice(-KEEP));
        this.pulledFor.set(asset, due);
      } catch {
        /* keep old bars */
      } finally {
        this.inflight.delete(asset);
      }
    })();
    this.inflight.set(asset, p);
    return p;
  }
}
