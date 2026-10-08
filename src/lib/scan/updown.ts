import type { BookId } from "@/lib/live/types";

export type UpDownLeg = "up" | "down";
export type UpDownChip = "late-window" | "mom-gap" | "settle-ta";

export type UpDownRound = {
  slug: string;
  question: string;
  url: string;
  start: number;
  end: number;
  leftSec: number;
  beat: number;
  spot: number;
  moveBps: number;
  up: number;
  down: number;
  yesBid?: number;
  winner: UpDownLeg | "tie";
  decided: boolean;
  take: boolean;
  leg: UpDownLeg | null;
  chip: UpDownChip | null;
  reason: string;
  confirms?: number;
  missing?: string | null;
  venue: "binance" | "kalshi";
  ticker?: string;
  result?: "yes" | "no" | null;
  book?: BookId;
  series?: string;
  /** Index already through the line. Pay the ask. Quiet books rest. */
  cross?: boolean;
  /** Calendar shock. Same 4¢–75¢ band. Does not raise the $5 cap. */
  catalyst?: boolean;
  /** 1 when the 30-minute lean matches the print. 0.5 when that lean is flat, opposed, or the tape is the perp mark. */
  clipScale?: number;
  volBps1m?: number | null;
  bias30?: "up" | "down" | "flat" | null;
  /** Shard on the open market. The order sends this number first. */
  exchangeIndex?: number;
};

export function markYes(sizeUsd: number, entry: number, now: number, _fee = 0.02) {
  if (!entry) return 0;
  const contracts = sizeUsd / entry;
  return Number((contracts * (now - entry)).toFixed(2));
}

/** Global Polymarket 5m — US cannot trade this. Watch stub only. */
export async function loadRound(_force = false): Promise<UpDownRound> {
  const now = Math.floor(Date.now() / 1000);
  const start = Math.floor(now / 300) * 300;
  return {
    slug: "poly-global-5m",
    question: "Polymarket Global 5m — not this account",
    url: "https://polymarket.com",
    start,
    end: start + 300,
    leftSec: Math.max(0, start + 300 - now),
    beat: 0,
    spot: 0,
    moveBps: 0,
    up: 0.5,
    down: 0.5,
    winner: "tie",
    decided: false,
    take: false,
    leg: null,
    chip: null,
    reason: "Global 5m · US cannot trade · sit",
    venue: "binance",
  };
}

function cash(n: number) {
  return `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** One heart pass, four lines. A sit names the gate. Volume and the 30-minute lean are not gates. */
export function scanLines(r: UpDownRound): string[] {
  const ticker = r.ticker || r.series || r.slug;
  const delta = r.spot - r.beat;
  const noise = r.volBps1m != null && r.volBps1m > 0 && r.beat > 0 ? (r.volBps1m / 10_000) * r.beat : null;
  const half = noise != null ? noise * 0.5 : null;
  const ratio = half != null && half > 0 ? Math.abs(delta) / half : null;
  const push = ratio == null ? "UNREADABLE" : ratio > 1 ? `CLEAR (+${ratio.toFixed(2)}x)` : `UNDER (${ratio.toFixed(2)}x)`;
  const yesAsk = r.up;
  const yesBid = r.yesBid;
  const sideDown = (r.leg ?? (delta < 0 ? "down" : "up")) === "down";
  const bookName = sideDown ? "NO" : "YES";
  const bidPx = sideDown ? (yesAsk > 0 ? 1 - yesAsk : 0) : yesBid ?? 0;
  const askPx = sideDown ? (yesBid != null && yesBid > 0 ? 1 - yesBid : 0) : yesAsk;
  const bid = bidPx > 0 ? `${Math.round(bidPx * 100)}¢` : "no bid";
  const ask = askPx > 0 ? `${Math.round(askPx * 100)}¢` : "no ask";
  const spreadC = yesBid != null && yesBid > 0 && yesAsk > 0 ? Math.round((yesAsk - yesBid) * 100) : null;
  const print: "up" | "down" = delta > 0 ? "up" : "down";
  const lean = (r.bias30 ?? "none").toUpperCase();
  const clip = r.clipScale === 0.5 ? "0.5x" : "1.0x";
  const leanNote =
    r.bias30 === "up" || r.bias30 === "down"
      ? r.bias30 === print
        ? `Match -> ${clip} Clip`
        : `Oppose -> 0.5x Clip`
      : `Flat -> 0.5x Clip`;
  const text = `${r.reason} ${r.missing ?? ""}`;
  let status = "[STATUS] -> QUALIFIED";
  if (r.take) {
    const code = text.match(/(?:YES|NO): [a-z0-9_]+/);
    if (code) status = `[STATUS] -> QUALIFIED ${code[0]}`;
  } else if (!r.take) {
    if (/outside entry window/.test(text)) status = "[STATUS] -> SIT: window_boundary";
    else if (/too close to the line|not clearing the line/.test(text)) {
      const target = /too close to the line/.test(text) ? noise : half;
      const cmp = target != null && Math.abs(delta) < target ? ` (${cash(delta)} < ${cash(target)})` : "";
      status = `[STATUS] -> SIT: delta_under_noise${cmp}`;
    } else if (/rsi_exhaustion/.test(text)) status = "[STATUS] -> SIT: rsi_exhaustion";
    else if (/counter_trend_ema/.test(text)) status = "[STATUS] -> SIT: counter_trend_ema";
    else if (/momentum_against/.test(text)) status = "[STATUS] -> SIT: momentum_against";
    else if (/payout not worth it/.test(text)) {
      const ticket = text.match(/ticket (\d+)¢/);
      status = `[STATUS] -> SIT: price_band${ticket ? ` (${ticket[1]}¢ outside 4¢–75¢)` : ""}`;
    }
    else if (/no quote/.test(text)) status = "[STATUS] -> SIT: no_quote";
    else if (/volatility extreme/.test(text)) status = "[STATUS] -> SIT: volatility_extreme (>200bps)";
    else if (/stale tape|wiggle unreadable|spot /.test(text)) status = "[STATUS] -> SIT: stale_tape";
    else if (/no market|no KX/.test(text)) status = "[STATUS] -> SIT: no_market";
    else status = "[STATUS] -> SIT: other";
  }
  return [
    `[SCAN] ${ticker} | Spot: ${r.spot.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Strike: ${r.beat.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Delta: ${delta > 0 ? "+" : delta < 0 ? "-" : ""}${cash(delta)}`,
    `[SCAN] Noise(1m): ${noise == null ? "n/a" : cash(noise)} | Threshold: ${half == null ? "n/a" : cash(half)} | Push: ${push}`,
    `[SCAN] Book: ${bookName} ${bid} bid / ${ask} ask (Spread: ${spreadC == null ? "n/a" : `${spreadC}¢`}) | Lean(30m): ${lean} (${leanNote})`,
    status,
  ];
}
