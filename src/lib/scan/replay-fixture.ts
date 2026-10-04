/** Settled Kalshi windows pulled read-only on 2026-09-22. Decision-time BRTI path and ask are NOT in this payload. Settled yes=1.00 is the outcome, not a model probability. */
export const SETTLED_REPLAY = [
  { book: "btc" as const, ticker: "KXBTC15M-26SEP221915-15", result: "yes", rules: "CF Benchmarks' BRTI sixty seconds" },
  { book: "btc" as const, ticker: "KXBTC15M-26SEP221900-00", result: "no", rules: "CF Benchmarks' BRTI sixty seconds" },
  { book: "btc" as const, ticker: "KXBTC15M-26SEP221845-45", result: "yes", rules: "CF Benchmarks' BRTI sixty seconds" },
  { book: "btc" as const, ticker: "KXBTC15M-26SEP221830-30", result: "yes", rules: "CF Benchmarks' BRTI sixty seconds" },
  { book: "btc" as const, ticker: "KXBTC15M-26SEP221815-15", result: "no", rules: "CF Benchmarks' BRTI sixty seconds" },
  { book: "btc" as const, ticker: "KXBTC15M-26SEP221800-00", result: "no", rules: "CF Benchmarks' BRTI sixty seconds" },
  { book: "btc" as const, ticker: "KXBTC15M-26SEP221745-45", result: "no", rules: "CF Benchmarks' BRTI sixty seconds" },
  { book: "btc" as const, ticker: "KXBTC15M-26SEP221730-30", result: "no", rules: "CF Benchmarks' BRTI sixty seconds" },
  { book: "gold" as const, ticker: "KXGOLD15M-26SEP221915-15", result: "no", rules: "1-minute Pyth GOLD candlestick" },
  { book: "gold" as const, ticker: "KXGOLD15M-26SEP221900-00", result: "yes", rules: "1-minute Pyth GOLD candlestick" },
] as const;

/** Not inputs to the live gate until a later acceptance run stays green. */
export const NOT_LIVE_YET = ["ret1m", "ret5m", "volumeSurprise", "dxy", "ust10y", "session"] as const;
