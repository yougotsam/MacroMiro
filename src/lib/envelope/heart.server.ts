import { type UpDownRound } from "@/lib/scan/updown";
import { kalshiPnl, kalshiResult, loadKalshiBooks } from "@/lib/scan/kalshi";
import { submitBinary } from "./exec";
import { sendTelegram, telegramReady } from "@/lib/scan/telegram";
import { CLIP_USD, DAILY_STOP_USD, START_CASH, clampClip, sniperClip } from "./clip";
import { liveReadyNow, watchRest } from "@/lib/scan/kalshi-order";
import { probeKalshi } from "@/lib/scan/kalshi-auth";
import type { PaperPos } from "./paper";
import { loadHeart, saveHeart, type HeartState, type RestingBid } from "./store.server";
import { BOOK_LABEL, type BookScan } from "./board";
import type { BookId } from "@/lib/live/types";
import { DAILY_LOSS_CAP, killBlocksTrade, liveExecutionAllowed, liveFlagOn, markStale, readKill, recordPnl, setArmedKill } from "./kill.server";
import { appendLedger } from "./ledger.server";
import { volAlert } from "@/lib/scan/blackout";
import { logShadow } from "@/lib/scan/kalshi-shadow";
import { runPerpScan } from "@/lib/scan/perp-run.server";
import { ensurePerpSocket } from "@/lib/skill/perp-socket.server";

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
    const delta = kalshiPnl(pos.sizeUsd, entry, settlePx);
    recordPnl(delta);
    state.cash = Number((state.cash + pos.sizeUsd + delta).toFixed(2));
    state.ledger.unshift({
      id: `${Date.now()}-${pos.ticker}`,
      ts: etNow(),
      play: "scalp",
      note: `RESOLVE ${pos.leg.toUpperCase()} ${won ? "WIN" : "LOSS"} · settle ${settlePx.toFixed(2)} vs ${entry.toFixed(3)} · window close · ${pos.ticker}`,
      delta,
    });
    appendLedger({ kind: "settle", note: state.ledger[0].note, market_ticker: pos.ticker, realized_pnl: delta, mode: pos.mode === "live" ? "live" : "paper", settlement_result: result });
    state.lastNote = `settled ${pos.book} ${won ? "win" : "loss"} ${delta.toFixed(2)}`;
  }
  state.positions = keep;
  state.ledger = state.ledger.slice(0, 200);
}

async function tickHeartInner(execute: boolean): Promise<HeartState> {
  const rounds = await loadKalshiBooks(true);
  const btc = rounds.find((r) => r.book === "btc") ?? rounds[0];
  const state = loadHeart();
  const liveGate = await liveReadyNow();
  state.live = liveGate.ok;
  if (liveGate.ok) {
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

  const clipWanted = clampClip(state.clipUsd || CLIP_USD);
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

  if (liveExecutionAllowed() && !state.armed) {
    state.armed = true;
    setArmedKill(true, "begin file on");
  }
  if (!state.armed) {
    state.lastNote = rounds.map((r) => `${BOOK_LABEL[r.book ?? "btc"]} ${r.leftSec}s ${r.take ? "TAKE" : "sit"}`).join(" · ");
    saveHeart(state, true);
    return state;
  }

  const opened: string[] = [];
  const canExecute = execute && liveExecutionAllowed();
  const blocked = killBlocksTrade(state.positions.filter((p) => p.venue === "kalshi15m").reduce((a, p) => a + p.sizeUsd, 0));
  const tradable = rounds.filter((r) => r.book === "btc" || r.book === "gold" || r.book === "eth" || r.book === "sol");
  const newsDown = tradable.some((r) => r.reason.includes("news feed down") || r.reason.includes("news unknown"));
  if (newsDown) markStale(true, "news feed down");
  else markStale(false, "feeds ok");

  if (canExecute && blocked.ok) {
    const kept: RestingBid[] = [];
    for (const bid of state.resting ?? []) {
      const round = rounds.find((r) => (r.ticker || r.slug) === bid.ticker);
      const cancel = !round || round.leftSec < 90;
      try {
        const seen = await watchRest(bid.orderId, bid.ticker, cancel);
        if (seen.kind === "fill") {
          const yesPaid = bid.leg === "up" ? seen.avg || bid.yes : 1 - (seen.avg || bid.yes);
          state.positions.push({
            book: bid.book,
            side: bid.leg === "down" ? "short" : "long",
            entry: yesPaid,
            sizeUsd: bid.sizeUsd,
            opened: new Date().toISOString(),
            play: "scalp",
            venue: "kalshi15m",
            leg: bid.leg,
            ticker: bid.ticker,
            beat: bid.beat,
            slotEnd: bid.slotEnd,
            chip: bid.chip,
            yes: yesPaid,
            mode: "live",
            count: seen.fill,
          });
          state.fills += 1;
          state.lastNote = `filled ${bid.book} ${bid.leg} ${yesPaid.toFixed(3)}`;
          opened.push(bid.ticker);
        } else if (seen.kind === "open") kept.push(bid);
      } catch {
        kept.push(bid);
      }
    }
    state.resting = kept;

    const LIVE_BOOKS = new Set<BookId>(["btc", "gold", "eth", "sol"]);
    for (const round of rounds) {
      if (!round.book || !LIVE_BOOKS.has(round.book)) continue;
      if (!round.take || !round.leg || !round.chip) continue;
      const yes = round.leg === "down" ? round.down : round.up;
      const low = round.catalyst ? 0.2 : 0.25;
      const high = round.catalyst ? 0.4 : 0.45;
      if (yes < low || yes > high) continue;
      const clip = (liveGate.ok ? sniperClip(state.cash, yes, true) : Math.min(clipWanted, 5)) * (round.catalyst ? 4 : 1);
      if (state.cash < clip) break;
      const ticker = round.ticker || round.slug;
      if (!ticker) continue;
      const onTicker = state.positions.filter((p) => p.ticker === ticker && p.venue === "kalshi15m");
      if (onTicker.length >= 2) continue;
      if (onTicker.length === 1 && onTicker[0].leg !== round.leg) continue;
      if (onTicker.length === 1 && Date.now() - state.lastOpenAt < 60_000) continue;
      if (onTicker.length === 1 && yes >= (onTicker[0].yes || onTicker[0].entry)) continue;
      if ((state.resting ?? []).some((b) => b.ticker === ticker)) continue;
      const misses = state.ledger.filter((r) => r.note.includes("MISS") && r.note.includes(ticker)).length;
      if (misses >= 2) continue;
      let fill;
      try {
        fill = await submitBinary({
          venue: "kalshi15m",
          ticker,
          leg: round.leg,
          sizeUsd: clip,
          yes,
          beat: round.beat,
          slotEnd: round.end,
          chip: round.chip,
          cross: true,
        });
      } catch (e) {
        const why = e instanceof Error ? e.message.slice(0, 160) : "err";
        const ban = !/no fill|404|not_found/.test(why);
        state.lastNote = `order fail ${round.book} · ${why}`;
        state.ledger.unshift({ id: `miss-${ticker}-${Date.now()}`, ts: etNow(), play: "sit", note: `${ban ? "MISS" : "SKIP"} ${round.leg} ${ticker} · ${why}`, delta: 0 });
        appendLedger({ kind: "miss", note: state.lastNote, market_ticker: ticker, mode: "live" });
        saveHeart(state, false);
        continue;
      }
      if (fill.mode === "live" && !(fill.count && fill.count > 0)) continue;
      state.cash = Number((state.cash - clip).toFixed(2));
      state.lastOpenAt = Date.now();
      state.positions.push({
        book: round.book,
        side: round.leg === "down" ? "short" : "long",
        entry: fill.yes,
        sizeUsd: clip,
        opened: new Date().toISOString(),
        play: "scalp",
        venue: "kalshi15m",
        leg: round.leg,
        ticker,
        beat: round.beat,
        slotEnd: round.end,
        chip: round.chip,
        yes: fill.yes,
        mode: fill.mode,
        count: fill.count,
      });
      state.fills += 1;
      state.ledger.unshift({
        id: fill.id,
        ts: etNow(),
        play: "scalp",
        note: `HEART ${round.leg.toUpperCase()} ${fill.yes.toFixed(3)} · beat ${round.beat.toFixed(2)} spot ${round.spot.toFixed(2)} · $${clip} · ${ticker} · ${fill.mode}`,
        delta: 0,
      });
      appendLedger({ kind: "fill", note: state.ledger[0].note, market_ticker: ticker, actual_fill_price: fill.yes, order_id: fill.id, mode: fill.mode, side: round.leg });
      state.lastNote = `filled ${round.book} ${round.leg} $${clip}`;
      state.lastFill = state.ledger[0].note;
      opened.push(ticker);
      if (telegramReady()) void sendTelegram(`${etNow()} ET ${round.leg} ${BOOK_LABEL[round.book]} $${clip} @ ${fill.yes.toFixed(2)}`);
    }
  }

  if (!state.lastNote || opened.length === 0) {
    state.lastNote = tradable.map((r) => `${BOOK_LABEL[r.book ?? "btc"]} ${r.leftSec}s ${r.take ? "TAKE" : "sit"}`).join(" · ") || state.lastNote;
  }
  const ping = volAlert(Date.now());
  if (ping) state.lastNote = `${state.lastNote} · vol ${ping}`.slice(0, 280);
  saveHeart(state, true);
  void logShadow(rounds).catch(() => null);
  void runPerpScan()
    .then((note) => {
      if (note) state.lastNote = `${state.lastNote} · ${note}`.slice(0, 280);
      saveHeart(state, true);
    })
    .catch(() => null);
  return state;
}

export async function tickHeart(execute = false) {
  if (!execute) return tickHeartInner(false);
  return tickHeartInner(true);
}

export async function executeHeart() {
  return tickHeart(true);
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
    void tickHeartInner(false);
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
