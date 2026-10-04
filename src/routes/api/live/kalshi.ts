import { createFileRoute } from "@tanstack/react-router";
import { beginFlagOn, liveExecutionAllowed, liveFlagOn } from "@/lib/envelope/kill.server";
import { kalshiGet, probeKalshi } from "@/lib/scan/kalshi-auth";
import { loadGoldFifteen, loadKalshiRound } from "@/lib/scan/kalshi";
import { loadPerps } from "@/lib/scan/kalshi-perps";

function countResting(rows: unknown[] | undefined) {
  if (!Array.isArray(rows)) return null;
  let n = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const status = String((row as { status?: string }).status ?? "").toLowerCase();
    if (!status || status === "resting" || status === "open" || status === "pending") n += 1;
  }
  return n;
}

function countPositions(rows: unknown[] | undefined) {
  if (!Array.isArray(rows)) return null;
  let n = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as { position_fp?: string; position?: number | string };
    const raw = r.position_fp ?? r.position;
    if (raw == null || Number(raw) !== 0) n += 1;
  }
  return n;
}

async function bookCounts() {
  try {
    const [orders, positions] = await Promise.all([
      kalshiGet<{ orders?: unknown[] }>("/trade-api/v2/portfolio/orders?status=resting&limit=100"),
      kalshiGet<{ market_positions?: unknown[] }>("/trade-api/v2/portfolio/positions"),
    ]);
    return {
      openOrders: countResting(orders.data.orders),
      marketPositions: countPositions(positions.data.market_positions),
      querySigned: true,
    };
  } catch {
    return { openOrders: null, marketPositions: null, querySigned: false };
  }
}

async function ruleLine(series: string) {
  try {
    const res = await fetch(
      `https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=${series}&status=open&limit=1`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return { ticker: null, status: null, rules: "" };
    const data = (await res.json()) as {
      markets?: { ticker?: string; status?: string; rules_primary?: string; open_time?: string; close_time?: string }[];
    };
    const now = Date.now();
    const rows = data.markets ?? [];
    const live = rows.find((m) => {
      const o = Date.parse(m.open_time || "");
      const c = Date.parse(m.close_time || "");
      const st = (m.status || "").toLowerCase();
      return Number.isFinite(o) && Number.isFinite(c) && o <= now && now < c && (st === "active" || st === "open");
    });
    const m = live ?? rows[0];
    return {
      ticker: m?.ticker ?? null,
      status: m ? (live ? "active" : m.status ?? null) : "none",
      rules: (m?.rules_primary ?? "").replace(/\s+/g, " ").slice(0, 240),
    };
  } catch {
    return { ticker: null, status: null, rules: "" };
  }
}

export const Route = createFileRoute("/api/live/kalshi")({
  server: {
    handlers: {
      GET: async () => {
        const [auth, round, gold, perps, counts, btcRule, goldRule] = await Promise.all([
          probeKalshi(),
          loadKalshiRound(true),
          loadGoldFifteen(true),
          loadPerps(true),
          bookCounts(),
          ruleLine("KXBTC15M"),
          ruleLine("KXGOLD15M"),
        ]);
        const shard2 = auth.shards?.find((s) => s.index === 2)?.usd ?? null;
        return Response.json({
          ...auth,
          livePath: liveFlagOn(),
          begun: beginFlagOn(),
          liveExecution: liveExecutionAllowed(),
          shard2,
          ...counts,
          round: {
            ticker: round.ticker || round.slug,
            leftSec: round.leftSec,
            beat: round.beat,
            spot: round.spot,
            up: round.up,
            down: round.down,
            take: round.take,
            reason: round.reason,
          },
          gold15m: {
            ticker: gold.ticker || gold.slug,
            leftSec: gold.leftSec,
            beat: gold.beat,
            up: gold.up,
            down: gold.down,
            reason: gold.reason,
          },
          btcRule,
          goldRule,
          btcSettle: "Final-minute BRTI average. Only the 60-tick quarter close is the print. Chart candles are not that print.",
          goldSettle: "Pyth GOLD 1-minute close, rounded to the cent. This chart is COMEX/Yahoo, not that candle.",
          perps,
        });
      },
    },
  },
});