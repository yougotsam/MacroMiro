export type ShadowFeatures = {
  ticker: string;
  rsi: number | null;
  bbWidth: number | null;
  fibZone: "none" | "236" | "382" | "500" | "618";
  volume: number;
  engulf: "up" | "down" | null;
  spread: number | null;
  bookImb: number | null;
  payoutX: number | null;
  feeEst: number | null;
  newsBlocked: boolean;
};

export type LaneRound = {
  book?: string;
  moveBps: number;
  up: number;
  winner: string;
};

export type Lane = { id: string; take: boolean; why: string };

/** Shadow only. Never called by decide(). */
export function shadowLanes(round: LaneRound, f: ShadowFeatures): Lane[] {
  const move = Math.abs(round.moveBps);
  const imbAgrees =
    f.bookImb != null && ((round.winner === "up" && f.bookImb > 0.15) || (round.winner === "down" && f.bookImb < -0.15));
  const mom =
    !f.newsBlocked &&
    move >= 8 &&
    round.up >= 0.4 &&
    round.up <= 0.7 &&
    imbAgrees &&
    (f.spread == null || f.spread <= 0.06);
  const fade =
    (f.rsi != null && f.rsi >= 70 && round.up >= 0.8) || (f.rsi != null && f.rsi <= 30 && round.up <= 0.2);
  const gold =
    round.book === "gold" && !f.newsBlocked && move >= 8 && round.up >= 0.4 && round.up <= 0.7;
  const bookOk = imbAgrees && (f.spread == null || f.spread <= 0.04) && f.volume > 0;
  return [
    { id: "baseline", take: false, why: "no-trade" },
    { id: "momentum", take: mom, why: mom ? "move+book+band" : "no" },
    { id: "meanrev", take: fade, why: fade ? "rsi extreme" : "no" },
    { id: "gold-news", take: gold, why: round.book === "gold" ? (f.newsBlocked ? "news sit" : gold ? "gold move" : "no") : "not gold" },
    { id: "book", take: bookOk, why: bookOk ? "book agrees" : "no" },
  ];
}
