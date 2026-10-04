export type NewsEvent = {
  name: string;
  time: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  sourceUrl: string;
};

export type NewsRead = {
  event: string;
  source: string;
  at: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  surprise: "above" | "below" | "inline" | "unknown";
  asset: "btc" | "gold" | "both";
  expected: "up" | "down" | "mixed" | "unknown";
  timeframe: "immediate" | "15m" | "session" | "longer";
  confidence: "low";
  support: string[];
  against: string[];
  veto: boolean;
  trade: false;
};

function num(v: string | null) {
  if (!v) return null;
  const n = Number(String(v).replace(/[%k,]/gi, ""));
  return Number.isFinite(n) ? n : null;
}

export function readNews(e: NewsEvent | null, known: boolean): NewsRead {
  if (!known || !e) {
    return {
      event: known ? "none in window" : "calendar missing",
      source: "https://www.forexfactory.com/calendar",
      at: "",
      actual: null,
      forecast: null,
      previous: null,
      surprise: "unknown",
      asset: "both",
      expected: "unknown",
      timeframe: "15m",
      confidence: "low",
      support: [],
      against: ["no print to confirm"],
      veto: !known,
      trade: false,
    };
  }
  const a = num(e.actual);
  const f = num(e.forecast);
  const surprise = a == null || f == null ? "unknown" : a > f ? "above" : a < f ? "below" : "inline";
  const gold = /CPI|PCE|FOMC|Rate|NFP|Payroll/i.test(e.name);
  const asset: NewsRead["asset"] = gold ? "both" : "btc";
  const expected: NewsRead["expected"] =
    surprise === "above" && /CPI|PCE|NFP|Payroll/i.test(e.name) ? "down" : surprise === "below" ? "up" : "unknown";
  return {
    event: e.name,
    source: e.sourceUrl,
    at: e.time,
    actual: e.actual,
    forecast: e.forecast,
    previous: e.previous,
    surprise,
    asset,
    expected,
    timeframe: "15m",
    confidence: "low",
    support: surprise === "unknown" ? [] : [`${e.name} ${surprise} forecast`],
    against: ["one print is not a trade", "effect on a 15m contract is not measured here"],
    veto: true,
    trade: false,
  };
}
