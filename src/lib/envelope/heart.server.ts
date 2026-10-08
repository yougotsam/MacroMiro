import { appendFileSync } from "node:fs";
import { type UpDownRound, scanLines } from "@/lib/scan/updown";
import { contractCount, kalshiPnl, kalshiResult, loadKalshiBooks } from "@/lib/scan/kalshi";
import { DAILY_STOP_USD, START_CASH } from "./clip";
import { probeKalshi } from "@/lib/scan/kalshi-auth";
import type { PaperPos } from "./paper";
import { loadHeart, saveHeart, type HeartState, type RestingBid } from "./store.server";
import { BOOK_LABEL, type BookScan } from "./board";
import type { BookId } from "@/lib/live/types";
import { DAILY_LOSS_CAP, liveFlagOn, markStale, readKill, recordPnl, setArmedKill } from "./kill.server";
import { appendLedger } from "./ledger.server";
import { switchState } from "@/lib/desk/risk";
import { volAlert } from "@/lib/scan/blackout";
import { logShadow } from "@/lib/scan/kalshi-shadow";
import { ensurePerpSocket } from "@/lib/skill/perp-socket.server";
import { DATA_ROOT } from "@/lib/data-root";

function etNow() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" });
}

function isBinary(pos: PaperPos) {
  return pos.venue === "kalshi15m";
}

function boardFrom(rounds: UpDownRound[], positions: PaperPos[]): BookScan[] {
  return rounds.filter((r) => r.book).map((r) => ({
    book: r.book as BookId,
    last: r.spot,
    stacked: r.leg === "down" ? "short" : r.leg === "up" ? "long" : "chop",
    rsi: null,
    stretch: r.moveBps,
    n: r.leftSec,
    action: r.take ? "scalp" : "sit",
    auto: r.take,
    reason: r.reason,
    open: positions.some((p) => p.book === r.book && isBinary(p)),
  }));
}

function flattenSpotJunk(state: HeartState, pos: PaperPos) {
  if (pos.venue && pos.venue !== "kalshi15m" && pos.venue !== "poly5m") {
    state.positions = state.positions.filter((p) => p !== pos);
  }
}

async function settleClosed(state: HeartState, rounds: UpDownRound[]) {
  const keep: PaperPos[] = [];
  for (const pos of state.positions) {
    if (!isBinary(pos) || !pos.ticker || !pos.leg) {
      keep.push(pos);
      continue;
    }
    const round = rounds.find((r) => (r.ticker || r.slug) === pos.ticker);
    const ended = pos.slotEnd ? Date.now() / 1000 >= pos.slotEnd : Boolean(round && round.leftSec <= 0);
    if (!ended) {
      keep.push(pos);
      continue;
    }
    const result = await kalshiResult(pos.ticker);
    if (!result) {
      keep.push(pos);
      continue;
    }
    const won = pos.leg === "up" ? result === "yes" : result === "no";
    const settlePx = won ? 1 : 0;
    const entry = pos.yes || pos.entry;
    const contracts = pos.count && pos.count > 0 ? pos.count : contractCount(pos.sizeUsd, entry);
    const delta = kalshiPnl(pos.sizeUsd, entry, settlePx, contracts);
    recordPnl(delta);
    state.cash = Number((state.cash + pos.sizeUsd + delta).toFixed(2));
    state.ledger.unshift({
      id: `${Date.now()}-${pos.ticker}`,
      ts: etNow(),
      play: "scalp",
      note: `RESOLVE ${pos.leg.toUpperCase()} ${won ? "WIN" : "LOSS"} · ${contracts} contracts · pays $${(contracts * settlePx).toFixed(2)} · entry ${entry.toFixed(3)} · ${pos.ticker}`,
      delta,
    });
    appendLedger({ kind: "settle", note: state.ledger[0].note, market_ticker: pos.ticker, realized_pnl: delta, mode: pos.mode === "live" ? "live" : "paper", settlement_result: result });
    state.lastNote = `settled ${pos.book} ${won ? "win" : "loss"} ${delta.toFixed(2)}`;
  }
  state.positions = keep;
  state.ledger = state.ledger.slice(0, 200);
}

function logDesk(line: string | string[]) {
  const text = Array.isArray(line) ? line.join("\n") : line;
  console.log(text);
  try {
    appendFileSync(`${DATA_ROOT}/scan.log`, text.endsWith("\n") ? text : `${text}\n`);
  } catch {
    /* the terminal line already printed */
  }
}

function emitScan(rounds: UpDownRound[]) {
  for (const round of rounds) {
    if (round.book !== "btc" && round.book !== "eth" && round.book !== "sol" && round.book !== "gold") continue;
    logDesk(scanLines(round));
  }
}

/** Scan + display state only. Orders are placed exclusively by the desk engine process (src/lib/desk/oms.ts). */
async function tickHeartInner(): Promise<HeartState> {
  const rounds = await loadKalshiBooks(true);
  emitScan(rounds);
  const btc = rounds.find((r) => r.book === "btc") ?? rounds[0];
  const state = loadHeart();
  const sw = switchState();
  state.live = sw.live && sw.begin && sw.arm;
  if (state.live) {
    const p = await probeKalshi();
    const shard2 = p.shards?.find((s) => s.index === 2)?.usd ?? 0;
    state.cash = shard2;
  }
  state.ticks += 1;
  state.lastTick = new Date().toISOString();
  state.round = btc;
  state.book = "btc";

  for (const pos of [...state.positions]) {
    if (pos.venue !== "kalshi15m") flattenSpotJunk(state, pos);
  }
  await settleClosed(state, rounds);

  state.board = boardFrom(rounds, state.positions);
  const dayLoss = readKill().dailyLossUsd;
  const stopped = liveFlagOn()
    ? state.cash <= 8 || dayLoss >= DAILY_LOSS_CAP
    : state.cash <= START_CASH - DAILY_STOP_USD;
  if (stopped) {
    state.lastNote = liveFlagOn() ? `day down $${dayLoss.toFixed(2)} · sit` : "paper stop · sit";
    saveHeart(state, true);
    return state;
  }

  state.armed = Boolean(state.live);
  const tradable = rounds.filter((r) => r.book === "btc" || r.book === "gold" || r.book === "eth" || r.book === "sol" || r.book === "xrp");
  const newsDown = tradable.some((r) => r.reason.includes("news feed down") || r.reason.includes("news unknown"));
  if (newsDown) markStale(true, "news feed down");
  else markStale(false, "feeds ok");
  const opened: string[] = [];

  if (!state.lastNote || opened.length === 0) {
    state.lastNote = tradable.map((r) => `${BOOK_LABEL[r.book ?? "btc"]} ${r.leftSec}s ${r.take ? "TAKE" : "sit"}`).join(" · ") || state.lastNote;
  }
  const ping = volAlert(Date.now());
  if (ping) state.lastNote = `${state.lastNote} · vol ${ping}`.slice(0, 280);
  saveHeart(state, true);
  void logShadow(rounds).catch(() => null);
  return state;
}

export async function tickHeart() {
  return tickHeartInner();
}

export async function readHeart() {
  return loadHeart();
}

export function heartStatus() {
  return loadHeart();
}

export function ensureHeart() {
  const g = globalThis as typeof globalThis & { __heartClock?: boolean };
  if (g.__heartClock) return;
  g.__heartClock = true;
  ensurePerpSocket();
  setInterval(() => {
    void tickHeartInner().catch(() => null);
  }, 15_000);
}

export function setArmed(armed: boolean, clipUsd?: number) {
  const state = loadHeart();
  state.armed = armed;
  if (clipUsd) state.clipUsd = clipUsd;
  setArmedKill(armed, armed ? "armed" : "off");
  saveHeart(state, true);
  return state;
}

export async function flattenBook(book: BookId) {
  const state = loadHeart();
  state.positions = state.positions.filter((p) => p.book !== book);
  state.lastNote = `${BOOK_LABEL[book]} held to the clock. No mid-window sell.`;
  saveHeart(state, true);
  return state;
}
