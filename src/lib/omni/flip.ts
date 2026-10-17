/** Side-quest math. None of this is a win probability and none of it sends an order. */

export type Sector = "tech" | "sports" | "culture" | "macro" | "crypto" | "perps" | "other";
export type FlipMode = "repricing" | "bracket" | "fifteen" | "perp" | "watch";

const TECH = /\b(ai|llm|gemini|claude|openai|gpt|grok|anthropic|google|alphabet|search share|market share|chatbot|arena)\b/i;
const SPORTS = /\b(nfl|nba|mlb|nhl|ncaa|ufc|soccer|premier league|championship|spread|touchdown|playoff)\b/i;
const CULTURE = /\b(oscar|grammy|emmy|box office|streaming|movie|album|award)\b/i;
const MACRO = /\b(cpi|fomc|fed |federal reserve|payroll|unemployment|jobs report|weather|hurricane|gdp|inflation)\b/i;
const CRYPTO = /\b(btc|bitcoin|eth|ethereum|sol|solana|xrp|crypto)\b/i;

export function classifySector(text: string, ticker = ""): Sector {
  if (/PERP/i.test(ticker)) return "perps";
  if (/15M/i.test(ticker)) return "crypto";
  const blob = `${text} ${ticker}`;
  if (TECH.test(blob)) return "tech";
  if (SPORTS.test(blob)) return "sports";
  if (CULTURE.test(blob)) return "culture";
  if (MACRO.test(blob)) return "macro";
  if (CRYPTO.test(blob)) return "crypto";
  return "other";
}

/** Yes asks of sibling contracts. A sum under $1 is a check, not a filled arbitrage. The set may be incomplete. */
export function bracketCheck(yesAsks: Array<number | null>): { siblings: number; sum: number | null; gap: number | null; flag: boolean } {
  const asks = yesAsks.filter((n): n is number => n != null && n > 0 && n < 1);
  if (asks.length < 2) return { siblings: asks.length, sum: null, gap: null, flag: false };
  const sum = +asks.reduce((s, n) => s + n, 0).toFixed(4);
  const gap = +(1 - sum).toFixed(4);
  return { siblings: asks.length, sum, gap, flag: gap > 0.03 };
}

/**
 * Buy band 8¢–30¢. Exit target is twice the ask, but never under 45¢ and never over 75¢.
 * Multiple is target ÷ entry (18¢ → 45¢ is 2.5x). It is a price path, not a forecast that the book will get there.
 */
export function repricing(yesAsk: number | null): { eligible: boolean; entry: number | null; target: number | null; multiple: number | null } {
  if (yesAsk == null || !(yesAsk >= 0.08 && yesAsk <= 0.3)) return { eligible: false, entry: yesAsk, target: null, multiple: null };
  const target = Math.min(0.75, Math.max(0.45, Math.round(yesAsk * 2 * 100) / 100));
  const multiple = +(target / yesAsk).toFixed(2);
  return { eligible: multiple >= 2, entry: yesAsk, target, multiple };
}

export function flipMode(input: { ticker: string; sector: Sector; repricingEligible: boolean; bracketFlag: boolean }): FlipMode {
  if (input.sector === "perps" || /PERP/i.test(input.ticker)) return "perp";
  if (/15M/i.test(input.ticker)) return "fifteen";
  if (input.bracketFlag) return "bracket";
  if (input.repricingEligible) return "repricing";
  return "watch";
}

export const RUNGS = [
  { name: "1", from: 100, to: 250 },
  { name: "2", from: 250, to: 1000 },
  { name: "3", from: 1000, to: 5000 },
  { name: "4", from: 5000, to: 10000 },
] as const;

export const BANK_PRESETS = [100, 200, 500, 2500] as const;
export type BankPreset = (typeof BANK_PRESETS)[number] | "live";

export function rungFor(equity: number) {
  const rung = RUNGS.find((r) => equity < r.to) ?? RUNGS[RUNGS.length - 1];
  const span = rung.to - rung.from;
  const progress = Math.max(0, Math.min(1, (equity - rung.from) / span));
  return { name: rung.name, from: rung.from, to: rung.to, progress: +progress.toFixed(4), finished: equity >= 10_000 };
}

export type AgentRole = { name: string; job: string };

export function domainAgents(sector: Sector): AgentRole[] {
  const book = { name: "Book", job: "Read the Kalshi bid and ask. Do not invent a fill." };
  const referee = { name: "Referee", job: "Say what is missing. A story is not a win probability." };
  if (sector === "tech") return [
    { name: "Arena", job: "What the public leaderboard last printed, and when." },
    { name: "Release", job: "Whether a model launch is announced or only rumored." },
    book,
    { name: "Clock", job: "How long until the contract closes." },
    referee,
  ];
  if (sector === "sports") return [
    { name: "Wire", job: "The last official score or status, with the source." },
    { name: "Skeptic", job: "What would make that score stale." },
    book,
    { name: "Clock", job: "Time left in the event versus time left on the contract." },
    referee,
  ];
  if (sector === "culture") return [
    { name: "Tally", job: "The public count (box office, streams, votes) and its timestamp." },
    { name: "Skeptic", job: "Whether that count is final." },
    book,
    { name: "Clock", job: "When the contract settles versus when the tally updates." },
    referee,
  ];
  if (sector === "macro") return [
    { name: "Print", job: "The official release, the prior, and the time it posted." },
    { name: "Revision", job: "Whether a later revision can change the print." },
    book,
    { name: "Clock", job: "Minutes between the release and this read." },
    referee,
  ];
  if (sector === "crypto" || sector === "perps") return [
    { name: "Index", job: "The settlement index or mark, not a headline." },
    { name: "Noise", job: "Whether the move is larger than the usual wiggle." },
    book,
    { name: "Clock", job: "Seconds left, if this is a short contract." },
    referee,
  ];
  return [
    { name: "Source", job: "The best public source for this question, with a time." },
    { name: "Skeptic", job: "Why that source can be wrong." },
    book,
    { name: "Clock", job: "When the contract closes." },
    referee,
  ];
}

export function geminiPasses(question: string): string[] {
  return [
    `Pass 1 — source: what public number or score answers "${question}", and what time was it printed?`,
    "Pass 2 — book: what is the Kalshi yes ask right now, and is the gap versus that source a price difference or a missing contract?",
    "Pass 3 — refuse: if either source has no timestamp, the answer is UNKNOWN. Do not write a win probability.",
  ];
}
export function scenarioSeed(input: { question: string; ticker: string; sector: Sector; yesAsk: number | null }): string {
  const agents = domainAgents(input.sector).map((a) => `- ${a.name}: ${a.job}`).join("\n");
  const px = input.yesAsk == null ? "no ask" : `${Math.round(input.yesAsk * 100)}¢`;
  return [
    `Question: ${input.question}`,
    `Ticker: ${input.ticker}`,
    `Sector: ${input.sector}`,
    `Kalshi yes ask at read: ${px}`,
    "",
    "Five roles. Debate the evidence. Do not vote a settlement probability.",
    "If a later report contains a line that says Probability, that line is a claim, not a market chance.",
    "",
    agents,
  ].join("\n");
}
