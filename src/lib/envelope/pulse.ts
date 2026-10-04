import type { PlayId } from "@/lib/envelope/opinion";
import { ATR_CHOP, CASH_KILL, CLIP_USD, DAILY_STOP_USD, STREAK_SIT } from "@/lib/envelope/clip";
import { isMacroKill, redSoon } from "@/lib/live/ff-calendar";
import { bookAlwaysOpen, type DeskPayload, type Tape } from "@/lib/live/types";
import type { ScanPayload } from "@/lib/scan/types";
import type { PaperRow } from "./paper";

export type Chip = { id: string; ok: boolean; note: string };

export type Pulse = {
  chips: Chip[];
  n: number;
  action: PlayId;
  auto: boolean;
  reason: string;
  sizeUsd: number;
  side: "long" | "short" | null;
};

const STREAK_WINDOW_MS = 4 * 60 * 60 * 1000;

export function rowClosedAt(id: string): number | null {
  const n = Number(id.split("-")[0]);
  return Number.isFinite(n) && n > 1_600_000_000_000 ? n : null;
}

export function coldStreak(ledger: PaperRow[] | undefined, now = Date.now()) {
  const closed = (ledger ?? []).filter((r) => {
    if (r.delta === 0) return false;
    const at = rowClosedAt(r.id);
    return at == null || now - at < STREAK_WINDOW_MS;
  }).slice(0, STREAK_SIT);
  return closed.length >= STREAK_SIT && closed.every((r) => r.delta < 0);
}

export function runPulse(opts: {
  desk: DeskPayload;
  tape: Tape;
  scan: ScanPayload | null;
  cash: number;
  dayPnl: number;
  clipUsd?: number;
  now?: number;
  ledger?: PaperRow[];
}): Pulse {
  const now = opts.now ?? Date.now();
  const tape = opts.tape;
  const feedAge = now - new Date(opts.desk.asOf).getTime();
  const stale = !Number.isFinite(feedAge) || feedAge > 180_000;
  const rsi = tape.rsi;
  const stacked = tape.stacked;
  const regime = tape.regime;
  const reds = redSoon(opts.desk.calendar, now, 1.5);
  const macroReds = reds.filter(isMacroKill);
  const printKill =
    (!bookAlwaysOpen(tape.book) && reds.length > 0) || (bookAlwaysOpen(tape.book) && macroReds.length > 0);
  const analog = opts.desk.analogs.find((a) => a.n >= 8);
  const analogBlocks =
    !bookAlwaysOpen(tape.book) &&
    analog != null &&
    analog.rate < 0.45 &&
    opts.desk.hoursToNext != null &&
    opts.desk.hoursToNext < 12;
  const gap = tape.book === "btc" ? (opts.scan?.fair?.gap ?? null) : null;
  const polyAlign =
    tape.book !== "btc"
      ? null
      : gap == null
        ? false
        : stacked === "long" || (tape.plusDi != null && tape.minusDi != null && tape.plusDi > tape.minusDi)
          ? gap > 0.04
          : gap < -0.04;
  const atrPct = tape.last ? tape.atr / tape.last : 0;
  const volOk = atrPct >= ATR_CHOP;
  const heatOk = opts.desk.heat < 72;
  const cashOk = opts.cash > CASH_KILL;
  const dayOk = opts.dayPnl > -DAILY_STOP_USD;
  const live = bookAlwaysOpen(tape.book) || opts.desk.session.globex === "open";
  const streak = coldStreak(opts.ledger);
  const thinBreak = tape.volRatio < 0.45 && tape.fibZone === "none";

  let side: "long" | "short" | null = stacked === "chop" ? null : stacked;
  if (regime === "trend" && tape.plusDi != null && tape.minusDi != null) {
    side = tape.plusDi >= tape.minusDi ? "long" : "short";
  }
  if (regime === "range" && rsi != null) {
    if (rsi <= 33 && tape.last <= tape.bbMid) side = "long";
    else if (rsi >= 67 && tape.last >= tape.bbMid) side = "short";
    else side = null;
  }

  const rsiOk =
    rsi != null &&
    side != null &&
    (regime === "range"
      ? (side === "long" && rsi <= 33) || (side === "short" && rsi >= 67)
      : side === "long"
        ? rsi >= 35 && rsi <= 68
        : rsi >= 32 && rsi <= 65);

  const zoneOk =
    regime === "range"
      ? (side === "long" && tape.last <= tape.bbMid) || (side === "short" && tape.last >= tape.bbMid)
      : tape.fibZone === "load" || (Math.abs(tape.stretchPct) >= 0.2 && !thinBreak);

  const chips: Chip[] = [
    {
      id: "regime",
      ok: regime !== "mixed" || stacked !== "chop",
      note: `adx ${tape.adx == null ? "—" : tape.adx.toFixed(0)} ${regime}`,
    },
    {
      id: "rsi",
      ok: rsiOk,
      note: rsi == null ? "rsi n/a" : `rsi ${rsi.toFixed(0)} ${regime === "range" ? "fade" : "cont"}`,
    },
    {
      id: "zone",
      ok: zoneOk,
      note: regime === "range" ? "bb" : tape.fibZone === "load" ? "fib 38-62" : tape.fibZone === "deep" ? "fib deep" : `stretch ${tape.stretchPct.toFixed(2)}%`,
    },
    {
      id: "poly",
      ok: tape.book !== "btc" ? true : polyAlign === true,
      note: tape.book !== "btc" ? "n/a" : gap == null ? "no ladder" : `gap ${(gap * 100).toFixed(1)}pp`,
    },
    { id: "vol", ok: volOk && !thinBreak, note: thinBreak ? "thin tape" : volOk ? `atr ${(atrPct * 100).toFixed(2)}%` : "saw · skip" },
    { id: "heat", ok: heatOk, note: `heat ${opts.desk.heat}` },
    { id: "fresh", ok: !stale, note: stale ? "stale" : "live" },
    { id: "cash", ok: cashOk && dayOk && !streak, note: streak ? `${STREAK_SIT} losers · sit` : dayOk ? `cash ${opts.cash.toFixed(0)}` : `day ${opts.dayPnl.toFixed(0)} kill` },
    {
      id: "news",
      ok: !printKill,
      note: printKill ? `print ${reds[0]?.name ?? "red"}` : "cal clear",
    },
  ];

  const edgeIds =
    tape.book === "btc" ? ["regime", "rsi", "zone", "poly"] : ["regime", "rsi", "zone"];
  const edge = chips.filter((c) => edgeIds.includes(c.id) && c.ok).length;
  const rails = chips.filter((c) => ["heat", "fresh", "cash", "vol", "news"].includes(c.id)).every((c) => c.ok);
  const nearPrint = opts.desk.hoursToNext != null && opts.desk.hoursToNext < 6 && opts.desk.hoursToNext > 0;
  const need = 2;

  let action: PlayId = "sit";
  let reason = `${regime} · ${edge}/${need}`;
  if (!rails) {
    action = "sit";
    reason = chips.find((c) => !c.ok && ["heat", "fresh", "cash", "vol", "news"].includes(c.id))?.note ?? "rail";
  } else if (nearPrint && !bookAlwaysOpen(tape.book)) {
    action = "event";
    reason = `${opts.desk.next?.name ?? "Print"} ${opts.desk.hoursToNext?.toFixed(1)}h · Gate`;
  } else if (live && side && !analogBlocks && edge >= need && rsiOk) {
    action = "scalp";
    reason = `${regime} ${side} · ${edge} conf · ${tape.symbol}`;
  }

  const auto = action === "scalp" && rails && edge >= need && live && !analogBlocks && volOk && !!side && !streak && !printKill;
  const sizeUsd = action === "scalp" ? opts.clipUsd || CLIP_USD : 0;
  return { chips, n: edge, action, auto, reason, sizeUsd: Math.round(sizeUsd), side: auto || action === "scalp" ? side : null };
}
