import { readCandles, type Bar } from "./bars.ts";
import { readBook, type BookLevel } from "./book.ts";
import type { Feed } from "./feeds.ts";
import { bollinger, emaStack, fibConfluence, rsi, volumeSurprise } from "./ta.ts";

export type BookName = "btc" | "gold";

export type SkillReport = {
  book: BookName;
  experimental: true;
  liveAllowed: false;
  thesis: "momentum" | "meanrev" | "none";
  strategy: string;
  score: number;
  confirms: string[];
  missing: string[];
  veto: string | null;
  reason: string;
  inputs: Record<string, number | string | null>;
};

const NEED = 4;

function sideOf(n: number | null): "up" | "down" | null {
  if (n == null || n === 0) return null;
  return n > 0 ? "up" : "down";
}

export function scoreBook(input: {
  book: BookName;
  bars: Bar[];
  nowSec: number;
  yesBids?: BookLevel[];
  noBids?: BookLevel[];
  feed: Feed;
  beat: number | null;
  volBps: number | null;
  leftSec: number | null;
  newsBlocked: boolean;
  newsKnown: boolean;
}): SkillReport {
  const candles = readCandles(input.bars, input.nowSec);
  const closed = input.bars.filter((b) => b.closed || b.t + 60 <= input.nowSec);
  const closes = closed.map((b) => b.c);
  const last = closes.at(-1) ?? null;
  const rsiV = rsi(closes);
  const bb = bollinger(closes);
  const fib = last != null ? fibConfluence(closes, last) : { zone: "none" as const, dist: null };
  const volX = volumeSurprise(closed);
  const stack = emaStack(closes);
  const book = readBook(input.yesBids, input.noBids);
  const missing = [...candles.missing, ...book.missing];
  if (!input.feed.ok) missing.push(input.feed.missing);
  if (input.beat == null) missing.push("strike");
  if (input.volBps == null) missing.push("volatility");
  if (input.leftSec == null) missing.push("time left");
  if (!input.newsKnown) missing.push("news");

  const distBps =
    input.feed.ok && input.beat ? ((input.feed.value - input.beat) / input.beat) * 10_000 : null;
  const distSide = sideOf(distBps);
  const retSide = sideOf(candles.ret5);
  const bookSide = sideOf(book.imbalance);

  const confirms: string[] = [];
  let veto: string | null = null;
  if (input.newsBlocked) veto = "news";
  if (!input.newsKnown) veto = veto ?? "news unknown";
  if (!input.feed.ok) veto = veto ?? input.feed.missing;

  const mom =
    retSide != null &&
    sideOf(candles.ret1) === retSide &&
    stack === retSide &&
    bookSide === retSide &&
    distSide === retSide &&
    (volX == null || volX >= 1);
  if (mom && retSide) {
    confirms.push("1m", "5m", "ema", "book", "distance");
    if (volX != null && volX >= 1.5) confirms.push("volume");
    if (candles.engulf === retSide || candles.breakRetest === retSide) confirms.push("structure");
  }

  const fadeSide = candles.rejection;
  const rsiExtreme = rsiV != null && (rsiV >= 70 || rsiV <= 30);
  const rsiAgrees = fadeSide === "up" ? rsiV != null && rsiV <= 30 : fadeSide === "down" ? rsiV != null && rsiV >= 70 : false;
  const fibAgrees = fib.zone === "0.236" || fib.zone === "0.382" || fib.zone === "0.618";
  const fade = Boolean(fadeSide && rsiAgrees && fibAgrees && (bookSide == null || bookSide === fadeSide));
  if (fade && fadeSide) confirms.push("wick", "rsi", "fib");

  let thesis: SkillReport["thesis"] = "none";
  if (!veto && mom) thesis = "momentum";
  else if (!veto && fade) thesis = "meanrev";

  const score = Number((confirms.length / NEED).toFixed(2));
  const strategy =
    input.book === "btc"
      ? thesis === "meanrev"
        ? "btc-meanrev"
        : thesis === "momentum"
          ? "btc-momentum"
          : "btc-none"
      : thesis === "meanrev"
        ? "gold-meanrev"
        : thesis === "momentum"
          ? "gold-momentum"
          : "gold-none";

  const ready = thesis !== "none" && confirms.length >= NEED && !veto && missing.length === 0;
  const reason = veto
    ? `veto · ${veto}`
    : ready
      ? `${strategy} · ${confirms.length} confirms · experimental shadow`
      : missing.length
        ? `incomplete · ${missing.slice(0, 3).join(", ")}`
        : `no thesis · rsi ${rsiV ?? "—"} · not a trigger`;

  return {
    book: input.book,
    experimental: true,
    liveAllowed: false,
    thesis: ready ? thesis : "none",
    strategy: ready ? strategy : input.book === "btc" ? "btc-none" : "gold-none",
    score: ready ? score : Number((confirms.length / NEED).toFixed(2)),
    confirms: ready ? confirms : [],
    missing,
    veto,
    reason,
    inputs: {
      rsi: rsiV,
      bbPos: bb?.pos ?? null,
      bbWidth: bb?.width ?? null,
      fib: fib.zone,
      fibDist: fib.dist,
      ema: stack,
      volumeSurprise: volX,
      spread: book.spread,
      yesDepth: book.yesDepth,
      noDepth: book.noDepth,
      imbalance: book.imbalance,
      distBps: distBps == null ? null : Number(distBps.toFixed(2)),
      volBps: input.volBps,
      leftSec: input.leftSec,
      ret1: candles.ret1,
      ret5: candles.ret5,
      bodyRatio: candles.bodyRatio,
      wickRatio: candles.wickRatio,
      engulf: candles.engulf,
      rejection: candles.rejection,
      breakRetest: candles.breakRetest,
      news: input.newsKnown ? (input.newsBlocked ? "veto" : "clear") : "unknown",
      feed: input.feed.ok ? `${input.feed.mode} ${input.feed.value}` : input.feed.missing,
      rsiExtreme: rsiExtreme ? "yes" : "no",
    },
  };
}
