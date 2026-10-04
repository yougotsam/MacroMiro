/** Contract candles. Kalshi periods are 1, 60, 1440. Five minutes is five finished 1-minute bars. */

export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number; closed: boolean };

export type CandleRead = {
  body: number | null;
  range: number | null;
  bodyRatio: number | null;
  upperWick: number | null;
  lowerWick: number | null;
  wickRatio: number | null;
  engulf: "up" | "down" | null;
  rejection: "up" | "down" | null;
  breakRetest: "up" | "down" | null;
  ret1: number | null;
  ret5: number | null;
  missing: string[];
};

export function finalize(bars: Bar[], nowSec: number): Bar[] {
  return bars.filter((b) => b.closed || b.t + 60 <= nowSec);
}

export function fold5(bars: Bar[]): Bar | null {
  const g = bars.slice(-5);
  if (g.length < 5) return null;
  if (g.some((b) => !b.closed)) return null;
  return {
    t: g[4].t,
    o: g[0].o,
    h: Math.max(...g.map((b) => b.h)),
    l: Math.min(...g.map((b) => b.l)),
    c: g[4].c,
    v: g.reduce((a, b) => a + b.v, 0),
    closed: true,
  };
}

function ret(a: number, b: number) {
  if (!a) return null;
  return (b - a) / a;
}

export function readCandles(bars: Bar[], nowSec: number): CandleRead {
  const missing: string[] = [];
  const done = finalize(bars, nowSec);
  if (done.length < 2) missing.push("1m candles");
  const last = done.at(-1);
  const prev = done.at(-2);
  const five = fold5(done);
  if (!five) missing.push("5m candle");
  if (!last || last.h <= last.l) {
    return {
      body: null, range: null, bodyRatio: null, upperWick: null, lowerWick: null, wickRatio: null,
      engulf: null, rejection: null, breakRetest: null, ret1: null, ret5: null,
      missing: missing.length ? missing : ["last candle"],
    };
  }
  const body = Math.abs(last.c - last.o);
  const range = last.h - last.l;
  const upper = last.h - Math.max(last.o, last.c);
  const lower = Math.min(last.o, last.c) - last.l;
  const rejection: CandleRead["rejection"] =
    range > 0 && lower > body * 2 && body / range < 0.35 ? "up" : range > 0 && upper > body * 2 && body / range < 0.35 ? "down" : null;
  let engulf: CandleRead["engulf"] = null;
  if (prev) {
    const prevBody = Math.abs(prev.c - prev.o);
    if (last.c > last.o && prev.c < prev.o && body > prevBody && last.c >= prev.o && last.o <= prev.c) engulf = "up";
    if (last.c < last.o && prev.c > prev.o && body > prevBody && last.o >= prev.c && last.c <= prev.o) engulf = "down";
  }
  let breakRetest: CandleRead["breakRetest"] = null;
  if (done.length >= 4) {
    const priorHigh = Math.max(...done.slice(-4, -1).map((b) => b.h));
    const priorLow = Math.min(...done.slice(-4, -1).map((b) => b.l));
    const brokeUp = done.slice(-3, -1).some((b) => b.c > priorHigh) && last.l <= priorHigh && last.c > priorHigh;
    const brokeDn = done.slice(-3, -1).some((b) => b.c < priorLow) && last.h >= priorLow && last.c < priorLow;
    if (brokeUp) breakRetest = "up";
    else if (brokeDn) breakRetest = "down";
  }
  return {
    body: Number(body.toFixed(4)),
    range: Number(range.toFixed(4)),
    bodyRatio: range ? Number((body / range).toFixed(3)) : null,
    upperWick: Number(upper.toFixed(4)),
    lowerWick: Number(lower.toFixed(4)),
    wickRatio: range ? Number(((upper + lower) / range).toFixed(3)) : null,
    engulf,
    rejection,
    breakRetest,
    ret1: prev ? ret(prev.c, last.c) : null,
    ret5: five ? ret(five.o, five.c) : null,
    missing,
  };
}
