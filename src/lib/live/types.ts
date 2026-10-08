import type { AnalogLive } from "./empirical";

export type BookId = "btc" | "sol" | "eth" | "xrp" | "gold" | "silver" | "es" | "oil";

export function bookAlwaysOpen(book: BookId) {
  return book === "btc" || book === "sol" || book === "eth" || book === "xrp";
}


export type Bar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type Regime = "trend" | "range" | "mixed";
export type FibZone = "none" | "load" | "deep" | "break";

export type Tape = {
  book: BookId;
  symbol: string;
  venue: string;
  last: number;
  changePct: number | null;
  bars: Bar[];
  ema20: number;
  ema50: number;
  vwap: number;
  fib236: number;
  fib382: number;
  fib50: number;
  fib618: number;
  fib786: number;
  fibZone: FibZone;
  stretchPct: number;
  stacked: "long" | "short" | "chop";
  atFib: boolean;
  rsi: number | null;
  atr: number;
  adx: number | null;
  plusDi: number | null;
  minusDi: number | null;
  regime: Regime;
  volRatio: number;
  bbMid: number;
  bbUpper: number;
  bbLower: number;
  asOf: string;
};

export type CalEvent = {
  id: string;
  name: string;
  time: string;
  country: string;
  currency: string;
  importance: string;
  forecast: number | string | null;
  previous: number | string | null;
  actual: number | string | null;
  sourceUrl: string | null;
};

export type Headline = {
  id: string;
  title: string;
  source: string;
  url: string;
  published: string | null;
};

export type SessionMap = {
  cash: "open" | "closed";
  globex: "open" | "closed" | "halt";
  crypto: "open";
  note: string;
  holiday?: string;
};

export type Snapshot = {
  btc: number;
  sol: number;
  gold: number;
  es: number;
  oil: number;
  vix: number | null;
  dxy: number | null;
  fng: number | null;
  fngLabel: string | null;
};


export type DeskPayload = {
  asOf: string;
  session: SessionMap;
  heat: number;
  snapshot: Snapshot;
  next: CalEvent | null;
  hoursToNext: number | null;
  calendar: CalEvent[];
  wire: Headline[];
  analogs: AnalogLive[];
  tapes: Record<BookId, Tape>;
  sources: { name: string; url: string }[];
};

export type { AnalogLive };
