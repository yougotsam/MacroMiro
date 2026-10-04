import {
  analogRule,
  analogSource,
  lookup,
  overlayEmpirical,
  signFromSurprise,
  usedP,
  type EmpiricalHint,
} from "@/lib/printgate/analogs";

export type Side = "long" | "short";
export type Verdict = "arm" | "block";

export type Series = {
  id: string;
  name: string;
  instrument: string;
  unit: string;
  urls: [string, string];
  sideIfPrintAbove: Side | null;
  qty: number;
  minAbsSurprisePct: number;
  eventClass: string;
};

export type Rails = {
  maxNotionalUsd: number;
  maxDailyLossUsd: number;
  maxOpenPositions: number;
  requireTwoSources: boolean;
  minAbsSurprisePct: number;
  minAnalogP: number;
};

export type Book = {
  id: string;
  name: string;
  rails: Rails;
  series: Series[];
};

export type Print = {
  seriesId: string;
  printValue: number;
  sourceUrl: string;
  unit?: string;
  passage?: string;
  confidence: "high" | "medium" | "low";
};

export type Surprise = {
  printValue: number;
  consensus: number;
  pct: number;
  sign: number;
};

export type Fill = {
  id: string;
  seriesId: string;
  instrument: string;
  side: Side;
  qty: number;
  price: number;
  notional: number;
  reason: string;
  surprisePct: number;
  ts: string;
};

export type AnalogHit = {
  rule: string;
  usedP: number;
  source: "prior" | "empirical";
  n: number;
  outcome: "up" | "down";
  asset: string;
};

export type PipelineResult = {
  prints: Print[];
  surprise: Surprise | null;
  verdict: Verdict;
  reason: string;
  side: Side | null;
  qty: number;
  railsLog: string[];
  fill: Fill | null;
  analog: AnalogHit | null;
};

export const PRICES: Record<string, number> = {
  CL: 78.4,
  GC: 2485,
  BTCUSD: 64200,
};

export const GOLD_BOOK: Book = {
  id: "gold",
  name: "Gold / energy event book",
  rails: {
    maxNotionalUsd: 10_000,
    maxDailyLossUsd: 400,
    maxOpenPositions: 1,
    requireTwoSources: true,
    minAbsSurprisePct: 0.6,
    minAnalogP: 0.55,
  },
  series: [
    {
      id: "cpi_mm",
      name: "CPI m/m",
      instrument: "GC",
      unit: "%",
      urls: ["https://www.bls.gov/news.release/cpi.nr0.htm", "https://www.bls.gov/cpi/"],
      sideIfPrintAbove: "short",
      qty: 1,
      minAbsSurprisePct: 0.5,
      eventClass: "cpi",
    },
    {
      id: "nfp",
      name: "NFP change",
      instrument: "GC",
      unit: "000s",
      urls: ["https://www.bls.gov/news.release/empsit.nr0.htm", "https://www.bls.gov/news.release/empsit.toc.htm"],
      sideIfPrintAbove: "short",
      qty: 1,
      minAbsSurprisePct: 5,
      eventClass: "nfp",
    },
    {
      id: "eia_crude_stocks",
      name: "EIA weekly crude stocks",
      instrument: "CL",
      unit: "mmbbl",
      urls: [
        "https://www.eia.gov/petroleum/supply/weekly/",
        "https://www.eia.gov/dnav/pet/pet_stoc_wstk_dcu_nus_w.htm",
      ],
      sideIfPrintAbove: "short",
      qty: 1,
      minAbsSurprisePct: 0.8,
      eventClass: "eia_crude",
    },
    {
      id: "gld_holdings",
      name: "SPDR GLD tonnes",
      instrument: "GC",
      unit: "tonnes",
      urls: [
        "https://www.spdrgoldshares.com/usa/",
        "https://www.spdrgoldshares.com/usa/gold-bar-list/",
      ],
      sideIfPrintAbove: "long",
      qty: 1,
      minAbsSurprisePct: 0.15,
      eventClass: "gld_flow",
    },
    {
      id: "cftc_gold_mm_net",
      name: "CFTC gold managed money net",
      instrument: "GC",
      unit: "contracts",
      urls: [
        "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm",
        "https://www.cftc.gov/dea/futures/deacmesf.htm",
      ],
      sideIfPrintAbove: null,
      qty: 1,
      minAbsSurprisePct: 8,
      eventClass: "cot_gold",
    },
  ],
};

function flip(side: Side): Side {
  return side === "long" ? "short" : "long";
}

function sourcesAgree(prints: Print[], relTol = 0.002): boolean {
  if (prints.length < 2) return false;
  const base = prints[0].printValue;
  if (base === 0) return prints.every((p) => Math.abs(p.printValue) < 1e-9);
  return prints.every((p) => Math.abs(p.printValue - base) / Math.abs(base) <= relTol);
}

export function runPipeline(opts: {
  book: Book;
  seriesId: string;
  prints: Print[];
  consensus: number | null;
  openPositions: number;
  dayPnl: number;
  lastPrice?: number;
  empirical?: EmpiricalHint[];
}): PipelineResult {
  const series = opts.book.series.find((s) => s.id === opts.seriesId);
  if (!series) {
    return empty("unknown series", ["unknown series"], opts.prints);
  }

  const railsLog: string[] = [];
  if (!opts.prints.length) return empty("no prints", railsLog);
  if (opts.consensus === null) return empty("no consensus stored", railsLog, opts.prints);

  const printValue = opts.prints[0].printValue;
  const delta = printValue - opts.consensus;
  const pct = opts.consensus === 0 ? (delta === 0 ? 0 : 100) : (delta / Math.abs(opts.consensus)) * 100;
  const sign = delta > 0 ? 1 : delta < 0 ? -1 : 0;
  const surprise: Surprise = { printValue, consensus: opts.consensus, pct, sign };

  const bookRows = overlayEmpirical(opts.empirical ?? []);
  const analogRow = lookup(series.eventClass, signFromSurprise(pct), series.instrument, bookRows);
  const analog: AnalogHit | null = analogRow
    ? {
        rule: analogRule(analogRow),
        usedP: usedP(analogRow),
        source: analogSource(analogRow),
        n: analogRow.n,
        outcome: analogRow.outcome,
        asset: analogRow.asset,
      }
    : null;

  const floor = series.minAbsSurprisePct;
  if (Math.abs(pct) < floor) {
    return blocked(opts.prints, surprise, analog, railsLog, `surprise ${pct.toFixed(3)}% below ${floor}%`);
  }

  if (!series.sideIfPrintAbove) {
    return blocked(opts.prints, surprise, analog, railsLog, "no side map on this series");
  }

  let side: Side | null = sign >= 0 ? series.sideIfPrintAbove : flip(series.sideIfPrintAbove);
  let verdict: Verdict = "arm";
  let reason = `surprise ${pct >= 0 ? "+" : ""}${pct.toFixed(3)}% vs consensus ${opts.consensus}`;
  let qty = series.qty;

  if (opts.book.rails.requireTwoSources) {
    const uniq = new Set(opts.prints.map((p) => p.sourceUrl.replace(/\/$/, "")));
    if (uniq.size < 2) {
      verdict = "block";
      reason = `need 2 sources, got ${uniq.size}`;
      railsLog.push(reason);
      side = null;
      qty = 0;
    } else if (!sourcesAgree(opts.prints)) {
      verdict = "block";
      reason = "sources disagree on print_value";
      railsLog.push(reason);
      side = null;
      qty = 0;
    }
  }

  if (verdict === "arm" && opts.prints.some((p) => p.confidence === "low")) {
    verdict = "block";
    reason = "confidence low rejected";
    railsLog.push(reason);
    side = null;
    qty = 0;
  }

  if (verdict === "arm" && analog && analog.usedP < opts.book.rails.minAnalogP) {
    verdict = "block";
    reason = `analog p ${analog.usedP.toFixed(2)} (${analog.source}) below ${opts.book.rails.minAnalogP}`;
    railsLog.push(reason);
    side = null;
    qty = 0;
  }

  if (verdict === "arm" && opts.openPositions >= opts.book.rails.maxOpenPositions) {
    verdict = "block";
    reason = "max open positions";
    railsLog.push(reason);
    side = null;
    qty = 0;
  }

  if (verdict === "arm" && opts.dayPnl <= -Math.abs(opts.book.rails.maxDailyLossUsd)) {
    verdict = "block";
    reason = "daily loss rail";
    railsLog.push(reason);
    side = null;
    qty = 0;
  }

  const price = opts.lastPrice ?? PRICES[series.instrument];
  const notional = Math.abs(qty * (price ?? 0));
  if (verdict === "arm" && (!price || notional > opts.book.rails.maxNotionalUsd)) {
    verdict = "block";
    reason = "notional rail";
    railsLog.push(reason);
    side = null;
    qty = 0;
  }

  if (verdict === "arm") railsLog.push("rails_clear");

  const fill: Fill | null =
    verdict === "arm" && side && price
      ? {
          id: Math.random().toString(16).slice(2, 10),
          seriesId: series.id,
          instrument: series.instrument,
          side,
          qty,
          price,
          notional: Math.abs(qty * price),
          reason,
          surprisePct: pct,
          ts: new Date().toISOString(),
        }
      : null;

  return {
    prints: opts.prints,
    surprise,
    verdict,
    reason,
    side,
    qty,
    railsLog,
    fill,
    analog,
  };
}

function empty(reason: string, railsLog: string[], prints: Print[] = []): PipelineResult {
  return {
    prints,
    surprise: null,
    verdict: "block",
    reason,
    side: null,
    qty: 0,
    railsLog,
    fill: null,
    analog: null,
  };
}

function blocked(
  prints: Print[],
  surprise: Surprise,
  analog: AnalogHit | null,
  railsLog: string[],
  reason: string,
): PipelineResult {
  railsLog.push(reason);
  return {
    prints,
    surprise,
    verdict: "block",
    reason,
    side: null,
    qty: 0,
    railsLog,
    fill: null,
    analog,
  };
}
