/** Skill layer. Patterns confirm a thesis. They do not place orders. */

export type PxBar = { o: number; h: number; l: number; c: number; v: number };

export type SkillRead = {
  thesis: "momentum" | "meanrev" | "news" | "none";
  pattern: "hammer" | "engulf" | "none";
  confirms: string[];
  veto: string | null;
  ret1: number | null;
  ret5: number | null;
  body: number | null;
  wickReject: boolean;
};

export function fold5(bars: PxBar[]): PxBar | null {
  const g = bars.slice(-5);
  if (g.length < 5) return null;
  return {
    o: g[0].o,
    h: Math.max(...g.map((b) => b.h)),
    l: Math.min(...g.map((b) => b.l)),
    c: g[4].c,
    v: g.reduce((a, b) => a + b.v, 0),
  };
}

function retN(closes: number[], n: number) {
  if (closes.length < n + 1) return null;
  const a = closes[closes.length - 1 - n];
  const b = closes[closes.length - 1];
  if (!a) return null;
  return (b - a) / a;
}

function patternOf(bar: PxBar | undefined): SkillRead["pattern"] {
  if (!bar || bar.h <= bar.l) return "none";
  const body = Math.abs(bar.c - bar.o);
  const range = bar.h - bar.l;
  const lower = Math.min(bar.o, bar.c) - bar.l;
  if (range > 0 && lower > body * 2 && body / range < 0.35) return "hammer";
  return "none";
}

/** A hammer or an RSI print is not a thesis. Momentum needs 1m and 5m the same way plus a book. Mean-reversion needs a wick rejection, not RSI alone. */
export function readSkill(input: {
  bars: PxBar[];
  rsi: number | null;
  bookImb: number | null;
  newsBlocked: boolean;
  engulf: "up" | "down" | null;
}): SkillRead {
  const closes = input.bars.map((b) => b.c);
  const last = input.bars.at(-1);
  const five = fold5(input.bars);
  const ret1 = retN(closes, 1);
  const ret5 = five && five.o ? (five.c - five.o) / five.o : null;
  const body = last ? Math.abs(last.c - last.o) : null;
  const wickReject = patternOf(last) === "hammer";
  const pattern: SkillRead["pattern"] = input.engulf ? "engulf" : wickReject ? "hammer" : "none";
  const confirms: string[] = [];
  let veto: string | null = null;
  if (input.newsBlocked) veto = "news";
  const mom =
    ret1 != null &&
    ret5 != null &&
    Math.sign(ret1) === Math.sign(ret5) &&
    Math.sign(ret1) !== 0 &&
    input.bookImb != null &&
    Math.sign(input.bookImb) === Math.sign(ret1);
  if (mom) confirms.push("1m", "5m", "book");
  const fade = wickReject && input.rsi != null && (input.rsi >= 70 || input.rsi <= 30);
  if (fade) confirms.push("wick", "rsi");
  const thesis: SkillRead["thesis"] = veto ? "news" : mom ? "momentum" : fade ? "meanrev" : "none";
  return { thesis, pattern, confirms, veto, ret1, ret5, body, wickReject };
}
