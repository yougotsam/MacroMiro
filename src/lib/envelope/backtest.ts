import { DEFAULT_TAPE, readTape, type TapeSettings } from "@/lib/live/indicators";
import type { BookId, Tape } from "@/lib/live/types";
import { deflatedSharpe } from "@/lib/envelope/dsr";
import { FROZEN_N } from "@/lib/envelope/clip";

export type RailId = "stack" | "fade" | "stretch";

export type BackTrade = {
  rail: RailId;
  side: "long" | "short";
  entry: number;
  exit: number;
  pnl: number;
  barsHeld: number;
  thesis: string;
  opened: string;
  closed: string;
  fold: number;
};

export type BacktestResult = {
  book: BookId;
  symbol: string;
  venue: string;
  asOf: string;
  startCash: number;
  endCash: number;
  trades: BackTrade[];
  equity: { t: number; v: number }[];
  winN: number;
  loseN: number;
  bleed: BackTrade[];
  note: string;
  rail?: RailId;
  folds?: { fold: number; pnl: number; n: number }[];
  worstFold?: number | null;
};

export type DeskWalk = {
  book: BookId;
  symbol: string;
  venue: string;
  asOf: string;
  nTrials: number;
  rails: BacktestResult[];
  dsr: ReturnType<typeof deflatedSharpe>;
  worstFold: number | null;
  polyLive: { strike: number; yes: number; fair: number; gap: number; question: string } | null;
  note: string;
};

const RAILS: { id: RailId; label: string }[] = [
  { id: "stack", label: "momentum stack" },
  { id: "fade", label: "RSI fade" },
  { id: "stretch", label: "VWAP stretch" },
];

function costBps(book: BookId): number {
  return book === "btc" ? 4 : 2;
}

function signal(
  rail: RailId,
  t: Tape,
): { side: "long" | "short"; thesis: string } | null {
  const rsi = t.rsi;
  if (rail === "stack") {
    const exhaust = rsi != null && ((t.stacked === "long" && rsi >= 72) || (t.stacked === "short" && rsi <= 28));
    if (t.stacked === "chop" || exhaust) return null;
    return { side: t.stacked, thesis: `stack ${t.stacked} · rsi ${rsi == null ? "—" : rsi.toFixed(0)}` };
  }
  if (rail === "fade") {
    if (rsi == null) return null;
    if (t.stacked === "long" && rsi >= 72) return { side: "short", thesis: `fade long exhaust rsi ${rsi.toFixed(0)}` };
    if (t.stacked === "short" && rsi <= 28) return { side: "long", thesis: `fade short exhaust rsi ${rsi.toFixed(0)}` };
    return null;
  }
  if (t.stretchPct > 0.35) return { side: "short", thesis: `stretch ${t.stretchPct.toFixed(2)}% fade VWAP` };
  if (t.stretchPct < -0.35) return { side: "long", thesis: `stretch ${t.stretchPct.toFixed(2)}% fade VWAP` };
  return null;
}

function shouldExit(rail: RailId, t: Tape, pos: { side: "long" | "short"; i: number }, i: number): boolean {
  const held = i - pos.i;
  if (held >= 8) return true;
  const rsi = t.rsi;
  if (rail === "stack") {
    const flip = t.stacked !== "chop" && t.stacked !== pos.side;
    const exhaust = rsi != null && ((pos.side === "long" && rsi >= 72) || (pos.side === "short" && rsi <= 28));
    return flip || exhaust;
  }
  if (rail === "fade") {
    if (rsi == null) return held >= 4;
    if (pos.side === "short" && rsi < 55) return true;
    if (pos.side === "long" && rsi > 45) return true;
    return held >= 5;
  }
  if (pos.side === "short" && t.stretchPct < 0.1) return true;
  if (pos.side === "long" && t.stretchPct > -0.1) return true;
  return held >= 6;
}

export function walkRail(
  tape: Tape,
  rail: RailId,
  settings: TapeSettings = DEFAULT_TAPE,
  startCash = 300,
): BacktestResult {
  const bars = tape.bars;
  const trades: BackTrade[] = [];
  const equity: { t: number; v: number }[] = [];
  let cash = startCash;
  const bps = costBps(tape.book);
  const walkable = Math.max(0, bars.length - 23);
  const foldSize = Math.max(1, Math.floor(walkable / 3));
  let pos: { side: "long" | "short"; entry: number; size: number; i: number; thesis: string } | null = null;
  let pending: { side: "long" | "short"; size: number; thesis: string; signalI: number } | null = null;
  let pendingExit = false;

  for (let i = 22; i < bars.length; i++) {
    const slice = bars.slice(0, i + 1);
    const last = slice[i].c;
    const t = readTape(
      tape.book,
      tape.symbol,
      tape.venue,
      slice,
      last,
      null,
      new Date(slice[i].t).toISOString(),
      settings,
    );

    if (pending && i === pending.signalI + 1) {
      pos = {
        side: pending.side,
        entry: last,
        size: pending.size,
        i,
        thesis: pending.thesis,
      };
      pending = null;
    }

    if (pos && pendingExit) {
      const raw = ((pos.side === "long" ? 1 : -1) * (last - pos.entry) / pos.entry) * pos.size;
      const cost = pos.size * ((bps * 2) / 10_000);
      const pnl = Number((raw - cost).toFixed(2));
      cash = Number((cash + pnl).toFixed(2));
      const fold = Math.min(2, Math.floor(Math.max(0, pos.i - 22) / foldSize));
      trades.push({
        rail,
        side: pos.side,
        entry: pos.entry,
        exit: last,
        pnl,
        barsHeld: i - pos.i,
        thesis: pos.thesis,
        opened: new Date(bars[pos.i].t).toISOString(),
        closed: new Date(slice[i].t).toISOString(),
        fold,
      });
      pos = null;
      pendingExit = false;
    }

    const mtm = pos
      ? cash + ((pos.side === "long" ? 1 : -1) * (last - pos.entry) / pos.entry) * pos.size
      : cash;
    equity.push({ t: slice[i].t, v: Number(mtm.toFixed(2)) });

    if (pos && !pendingExit && shouldExit(rail, t, pos, i)) pendingExit = true;

    if (!pos && !pending && cash > 50 && i < bars.length - 2) {
      const s = signal(rail, t);
      if (s) {
        const size = Math.min(35, cash * 0.12);
        if (size >= 8) pending = { side: s.side, size, thesis: s.thesis, signalI: i };
      }
    }
  }

  const lose = trades.filter((x) => x.pnl < 0);
  const folds = [0, 1, 2].map((fold) => {
    const rows = trades.filter((x) => x.fold === fold);
    return { fold, pnl: Number(rows.reduce((a, b) => a + b.pnl, 0).toFixed(2)), n: rows.length };
  });
  const worst = folds.reduce((a, b) => (b.pnl < a.pnl ? b : a), folds[0]);

  return {
    book: tape.book,
    symbol: tape.symbol,
    venue: tape.venue,
    asOf: tape.asOf,
    startCash,
    endCash: cash,
    trades,
    equity,
    winN: trades.filter((x) => x.pnl > 0).length,
    loseN: lose.length,
    bleed: lose.slice(-8),
    rail,
    folds,
    worstFold: worst?.pnl ?? null,
    note: `${RAILS.find((r) => r.id === rail)?.label}. shift(1) fill. ${bps}bps×2 costs. Kill 8 bars / cash 50.`,
  };
}

export function walkPaper(tape: Tape, settings: TapeSettings = DEFAULT_TAPE, startCash = 300): BacktestResult {
  return walkRail(tape, "stack", settings, startCash);
}

export function walkDesk(
  tape: Tape,
  settings: TapeSettings = DEFAULT_TAPE,
  polyLive: DeskWalk["polyLive"] = null,
): DeskWalk {
  const rails = RAILS.map((r) => walkRail(tape, r.id, settings, 300));
  const allPnls = rails.flatMap((r) => r.trades.map((t) => t.pnl));
  const dsr = deflatedSharpe(allPnls, FROZEN_N);
  const worstFold = rails.reduce((min, r) => {
    const w = r.worstFold ?? 0;
    return w < min ? w : min;
  }, 0);
  return {
    book: tape.book,
    symbol: tape.symbol,
    venue: tape.venue,
    asOf: tape.asOf,
    nTrials: FROZEN_N,
    rails,
    dsr,
    worstFold,
    polyLive,
    note: `Three isolated $300 books. N frozen at ${FROZEN_N} (every family we already touched). DSR is a probability. Bar 0.95. Poly gap is live overlay — no Gamma history.`,
  };
}
