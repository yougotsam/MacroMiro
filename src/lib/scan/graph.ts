import { CLIP_USD, CASH_KILL, POLY_FEE_PLUS_CENTS } from "@/lib/envelope/clip";
import { fairAbove, volFromBars } from "@/lib/live/indicators";
import { bookAlwaysOpen, type BookId, type DeskPayload } from "@/lib/live/types";
import type { DexTape } from "./dex";
import type { ScanAction, ScanModule, ScanPayload, ScanRow, ScanVenue } from "./types";

export type PolyMarket = {
  question: string;
  yes: number;
  spread: number;
  bid: number | null;
  ask: number | null;
  end?: string | null;
  source?: "gamma" | "us";
  url?: string | null;
};

export type BinanceTick = {
  symbol: string;
  last: number;
  changePct: number;
  bid: number;
  ask: number;
};

export const GRAPH = {
  id: "envelope-scan-v3",
  nodes: ["polymarket", "polyus", "binance", "solana", "jupiter", "yahoo", "risk"] as const,
};

function polyUrl(q: string) {
  return `https://polymarket.com/search?_q=${encodeURIComponent(q)}`;
}
function yahooUrl(sym: string) {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}`;
}
function bnUrl(sym: string) {
  return `https://www.binance.us/trade/${sym}`;
}

function row(
  venue: ScanVenue,
  action: ScanAction,
  market: string,
  price: number | null,
  note: string,
  sizeUsd = 0,
  url: string | null = null,
): ScanRow {
  return {
    id: `${venue}-${market}-${action}-${Math.random().toString(16).slice(2, 6)}`,
    ts: new Date().toISOString(),
    venue,
    action,
    market,
    price,
    sizeUsd,
    note,
    url,
  };
}

function roundClock(question: string, end?: string | null) {
  const q = question.toLowerCase();
  const is5 = /\b5\s*-?\s*m(in)?\b/.test(q);
  const is15 = /\b15\s*-?\s*m(in)?\b/.test(q) || /up or down/i.test(question);
  const dur = is5 ? 5 : is15 ? 15 : null;
  const endMs = end ? Date.parse(end) : NaN;
  const leftMin = Number.isFinite(endMs) ? (endMs - Date.now()) / 60_000 : null;
  const late = leftMin != null && leftMin <= 3;
  const early = leftMin != null && dur != null && leftMin > dur - 2;
  return { dur, leftMin, late, early, short: Boolean(dur) };
}

export function runGraph(opts: {
  desk: DeskPayload | null;
  poly: PolyMarket[];
  polyUs?: PolyMarket[];
  binance: BinanceTick[];
  dex: DexTape | null;
  cash: number;
  tg?: { ready: boolean; last?: string };
}): ScanPayload {
  const rows: ScanRow[] = [];
  const heat = opts.desk?.heat ?? 0;
  const btc = opts.desk?.snapshot.btc ?? 0;
  const kill = heat >= 78 || opts.cash <= CASH_KILL;

  const allPoly = [...opts.poly, ...(opts.polyUs ?? [])];
  for (const m of allPoly) {
    const venue: ScanVenue = m.source === "us" ? "polyus" : "polymarket";
    const link = m.url || polyUrl(m.question);
    const clock = roundClock(m.question, m.end);
    const left =
      clock.short && clock.leftMin != null
        ? `${clock.leftMin.toFixed(1)}m left`
        : clock.leftMin != null && clock.leftMin < 24 * 60
          ? `${(clock.leftMin / 60).toFixed(1)}h left`
          : "no clock";
    if (m.yes <= 0.05 || m.yes >= 0.95) {
      rows.push(row(venue, "cancel", m.question, m.yes, "resolved / no market", 0, link));
      continue;
    }
    if (kill) {
      rows.push(row("risk", "cancel", m.question, m.yes, heat >= 78 ? "risk cap · heat" : "cash rail"));
      continue;
    }
    if (clock.late && clock.dur === 5 && /bitcoin|btc/i.test(m.question)) {
      const lateScan = m.yes >= 0.52 && m.yes <= 0.93;
      rows.push(
        row(
          venue,
          lateScan ? "scan" : "watch",
          m.question,
          m.yes,
          `5m late ${left} · ${lateScan ? "window edge" : "rich/thin"}`,
          lateScan ? CLIP_USD : 0,
          link,
        ),
      );
      continue;
    }
    if (clock.late) {
      rows.push(row(venue, "watch", m.question, m.yes, `last minutes · ${left} · desk 5m BTC only`, 0, link));
      continue;
    }
    if (clock.early) {
      rows.push(row(venue, "watch", m.question, m.yes, `minute 0–2 · wait · ${left}`, 0, link));
      continue;
    }
    rows.push(
      row(
        venue,
        "scan",
        m.question,
        m.yes,
        `${m.source === "us" ? "US " : ""}YES ${m.yes.toFixed(3)} · spread ${m.spread.toFixed(3)} · ${left} · clip $${CLIP_USD}`,
        CLIP_USD,
        link,
      ),
    );
  }

  const bnBtc = opts.binance.find((t) => t.symbol === "BTCUSDT");
  if (bnBtc && btc) {
    const basis = (bnBtc.last - btc) / btc;
    const note = `Binance ${bnBtc.last.toFixed(0)} vs Coinbase ${btc.toFixed(0)} · basis ${(basis * 100).toFixed(3)}%`;
    if (kill) rows.push(row("risk", "cancel", "BTCUSDT", bnBtc.last, "risk cap · basis skipped"));
    else if (Math.abs(basis) >= 0.0015)
      rows.push(row("binance", "scan", "BTCUSDT basis", bnBtc.last, note, CLIP_USD, bnUrl("BTCUSDT")));
    else rows.push(row("binance", "watch", "BTCUSDT", bnBtc.last, note, 0, bnUrl("BTCUSDT")));
  }
  for (const t of opts.binance) {
    if (t.symbol === "BTCUSDT") continue;
    const spr = t.ask && t.bid ? (t.ask - t.bid) / t.last : 0;
    if (kill) rows.push(row("risk", "cancel", t.symbol, t.last, "risk cap"));
    else if (spr > 0.0008)
      rows.push(row("binance", "cancel", t.symbol, t.last, `depth thin · spr ${(spr * 1e4).toFixed(1)}bp`, 0, bnUrl(t.symbol)));
    else
      rows.push(
        row(
          "binance",
          "watch",
          t.symbol,
          t.last,
          `${t.changePct >= 0 ? "+" : ""}${t.changePct.toFixed(2)}% 24h`,
          0,
          bnUrl(t.symbol),
        ),
      );
  }

  const dex = opts.dex;
  if (dex) {
    if (dex.solUsd != null && dex.jupUsd != null) {
      const gap = (dex.jupUsd - dex.solUsd) / dex.solUsd;
      const note = `Jup ${dex.jupUsd.toFixed(2)} vs Dex ${dex.solUsd.toFixed(2)} · ${(gap * 100).toFixed(3)}%`;
      if (Math.abs(gap) >= 0.004)
        rows.unshift(row("jupiter", "scan", "SOL 1→USDC", dex.jupUsd, note, CLIP_USD, "https://jup.ag"));
      else rows.push(row("jupiter", "watch", "SOL 1→USDC", dex.jupUsd, note, 0, "https://jup.ag"));
    } else if (dex.solUsd != null) {
      rows.push(row("jupiter", "watch", "SOL Dex", dex.solUsd, dex.err || "Jupiter quote down · Dex only", 0, "https://jup.ag"));
    }

    for (const p of dex.pairs) {
      const url = p.url || `https://dexscreener.com/solana/${p.pairAddress}`;
      const name = `${p.base}/${p.quote}`;
      if (p.boosted) {
        rows.push(row("solana", "cancel", name, p.priceUsd || null, "paid boost · SafeGuard skip", 0, url));
        continue;
      }
      if (p.fresh || p.liqUsd < 50_000) {
        rows.push(
          row(
            "solana",
            "cancel",
            name,
            p.priceUsd || null,
            p.fresh ? "new profile · no liq proof" : `liq $${(p.liqUsd / 1000).toFixed(0)}k · thin`,
            0,
            url,
          ),
        );
        continue;
      }
      if (p.chg5m != null && Math.abs(p.chg5m) >= 25) {
        rows.push(row("solana", "cancel", name, p.priceUsd, `5m ${p.chg5m.toFixed(1)}% · blow-off`, 0, url));
        continue;
      }
      if (p.liqUsd >= 1_000_000 && (p.base === "SOL" || p.base === "JUP" || p.base === "WETH")) {
        rows.push(
          row(
            "solana",
            "watch",
            name,
            p.priceUsd,
            `${p.dexId} · liq $${(p.liqUsd / 1e6).toFixed(1)}m · 5m ${p.chg5m ?? "—"}%`,
            0,
            url,
          ),
        );
        continue;
      }
      if (kill) {
        rows.push(row("risk", "cancel", name, p.priceUsd, "risk cap · dex"));
        continue;
      }
      rows.push(
        row(
          "solana",
          "scan",
          name,
          p.priceUsd,
          `${p.dexId} · liq $${(p.liqUsd / 1000).toFixed(0)}k · 5m ${p.chg5m ?? "—"}% · clip $${CLIP_USD}`,
          CLIP_USD,
          url,
        ),
      );
    }
  }

  const deskRows: ScanRow[] = [];
  const deskBooks: { id: BookId; label: string }[] = [
    { id: "btc", label: "BTC-USD" },
    { id: "sol", label: "SOL-USD" },
    { id: "eth", label: "ETH-USD" },
    { id: "gold", label: "Gold GC=F" },
    { id: "silver", label: "Silver SI=F" },
    { id: "es", label: "ES=F" },
    { id: "oil", label: "Oil CL=F" },
  ];
  for (const b of deskBooks) {
    const t = opts.desk?.tapes[b.id];
    if (!t?.last) continue;
    const sessionLive = bookAlwaysOpen(b.id) || opts.desk?.session.globex === "open";
    if (!sessionLive) {
      deskRows.push(row("yahoo", "watch", b.label, t.last, `session dark · ${opts.desk?.session.globex ?? "closed"}`, 0, yahooUrl(t.symbol)));
      continue;
    }
    if (kill) {
      deskRows.push(row("risk", "cancel", b.label, t.last, "risk cap · book"));
      continue;
    }
    const rsi = t.rsi == null ? "—" : t.rsi.toFixed(0);
    if (t.stacked !== "chop" && (t.atFib || Math.abs(t.stretchPct) >= 0.2)) {
      deskRows.push(
        row(
          "yahoo",
          "scan",
          b.label,
          t.last,
          `${t.stacked} · RSI ${rsi} · stretch ${t.stretchPct.toFixed(2)}% · clip $${CLIP_USD}`,
          CLIP_USD,
          yahooUrl(t.symbol),
        ),
      );
    } else {
      deskRows.push(
        row(
          "yahoo",
          "watch",
          b.label,
          t.last,
          `${t.stacked} · RSI ${rsi} · VWAP ${t.vwap.toFixed(2)}`,
          0,
          yahooUrl(t.symbol),
        ),
      );
    }
  }

  let fair: ScanPayload["fair"] = null;
  const sigma = opts.desk ? volFromBars(opts.desk.tapes.btc.bars) : 0.5;
  const now = Date.now();
  for (const m of allPoly) {
    const hit = m.question.match(/above\s+\$([0-9,]+)/i);
    if (!hit || !btc) continue;
    const strike = Number(hit[1].replace(/,/g, ""));
    if (!Number.isFinite(strike)) continue;
    const end = m.end ? Date.parse(m.end) : now + 8 * 3600_000;
    const years = Math.max(1 / 365 / 24, (end - now) / (365.25 * 24 * 3600_000));
    const fv = fairAbove(btc, strike, years, sigma);
    if (fv == null) continue;
    const gap = fv - m.yes;
    if (!fair || Math.abs(strike - btc) < Math.abs(fair.strike - btc)) {
      fair = { strike, yes: m.yes, fair: fv, gap, question: m.question, afterFee: Math.abs(gap) - POLY_FEE_PLUS_CENTS };
    }
  }
  if (fair) {
    const clears = fair.afterFee >= 0;
    const dir = fair.gap >= 0 ? "YES cheap" : "YES rich";
    rows.unshift(
      row(
        "polymarket",
        clears ? "scan" : "cancel",
        `BTC > $${fair.strike.toLocaleString()}`,
        fair.yes,
        `${dir} · YES ${fair.yes.toFixed(3)} · fair ${fair.fair.toFixed(3)} · gap ${(fair.gap * 100).toFixed(1)}pp · 1.6%+2¢ ${clears ? "clears" : "dead"} · clip $${clears ? CLIP_USD : 0}`,
        clears ? CLIP_USD : 0,
        polyUrl(fair.question),
      ),
    );
  }

  rows.unshift(...deskRows);

  const fomcHike = allPoly.find((m) => /increase interest rates by 25|Fed Rate Cut Greater/i.test(m.question))?.yes ?? null;
  const fomcHold = allPoly.find((m) => /no change in Fed|Fed Decision/i.test(m.question))?.yes ?? null;

  const modules: ScanModule[] = [
    {
      id: "poly",
      name: "Polymarket",
      detail: `${opts.poly.length} gamma · last-3m cancel`,
      state: opts.poly.length ? "scanning" : "down",
    },
    {
      id: "polyus",
      name: "Poly US",
      detail: `${opts.polyUs?.length ?? 0} crypto/macro · gateway.polymarket.us`,
      state: (opts.polyUs?.length ?? 0) ? "scanning" : "down",
    },
    {
      id: "binance",
      name: "Binance",
      detail: "spot public tape",
      state: opts.binance.length ? "connected" : "down",
    },
    {
      id: "dex",
      name: "DexScreener",
      detail: dex ? `${dex.pairs.length} sol · ${dex.boostN} paid boosts` : "down",
      state: dex && dex.pairs.length ? "scanning" : "down",
    },
    {
      id: "jup",
      name: "Jupiter",
      detail: dex?.jupUsd != null ? `1 SOL → $${dex.jupUsd.toFixed(2)}` : dex?.err || "no quote",
      state: dex?.jupUsd != null ? "connected" : dex?.jupReady ? "filtering" : "down",
    },
    {
      id: "macro",
      name: "GC / ES / CL",
      detail: opts.desk ? `GC ${opts.desk.snapshot.gold.toFixed(0)} · ES ${opts.desk.snapshot.es.toFixed(0)} · CL ${opts.desk.snapshot.oil.toFixed(1)}` : "desk down",
      state: opts.desk ? "scanning" : "down",
    },
    {
      id: "sg",
      name: "SafeGuard",
      detail: "Telegram buy-bot · no public REST · paid trend = cancel",
      state: "filtering",
    },
    {
      id: "tg",
      name: "Ask Zeebs",
      detail: opts.tg?.ready ? "Ping Zeebs only" : "no token",
      state: opts.tg?.ready ? "connected" : "down",
    },
    {
      id: "risk",
      name: "Risk",
      detail: kill
        ? "kill switch"
        : `$${CLIP_USD} clip · ${rows.filter((r) => r.action === "scan").length} scan · ${rows.filter((r) => r.action === "cancel").length} cancel`,
      state: "filtering",
    },
  ];

  return {
    asOf: new Date().toISOString(),
    rows: rows.slice(0, 48),
    modules,
    scannedUsd: rows.filter((r) => r.action === "scan").reduce((a, r) => a + r.sizeUsd, 0),
    markets: opts.poly.length + (opts.polyUs?.length ?? 0) + opts.binance.length + (dex?.pairs.length ?? 0),
    polyN: opts.poly.length + (opts.polyUs?.length ?? 0),
    binanceN: opts.binance.length,
    dexN: dex?.pairs.length ?? 0,
    scanN: rows.filter((r) => r.action === "scan").length,
    cancelN: rows.filter((r) => r.action === "cancel").length,
    basisPct: bnBtc && btc ? (bnBtc.last - btc) / btc : null,
    binanceBtc: bnBtc?.last ?? null,
    solUsd: dex?.solUsd ?? null,
    jupUsd: dex?.jupUsd ?? null,
    clipUsd: CLIP_USD,
    fair,
    fomcHike,
    fomcHold,
  };
}
