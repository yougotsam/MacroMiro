/**
 * Prompt library for the AI and Scenario Lab, rebuilt from the AEIOU playbook (#26 daily bias, #27 gold bias,
 * #28 London killzone, #16 FVG, #47 EMA stack, #48 RSI divergence, #55 VWAP, #110–115 timing, #124 backtest).
 * Each brief is filled with the numbers the pre-trade checklist already measured, so the AI explains and
 * challenges them instead of inventing levels. Briefs ask for definitions and the time zone, and forbid an
 * invented probability: MiroFish is "down" when it is down. These briefs never send an order.
 */
import type { PreTrade } from "./checklist";

export type Brief = { id: string; title: string; text: string };

const steps = (c: PreTrade) => c.steps.map((s) => `${s.n}. ${s.name}: ${s.state} (${s.detail})`).join("\n");
const p = (x: number | null) => (x == null ? "none" : `${(x * 100).toFixed(1)}%`);
const rules = "Rules: state your definitions and the time zone (New York). Use only the numbers given; if something is missing, say so. Do not invent a probability, a level, or a fill.";

export function dailyBiasBrief(c: PreTrade): Brief {
  const gold = c.asset === "GOLD";
  return {
    id: gold ? "27-gold-daily-bias" : "26-daily-bias",
    title: `${c.asset} daily bias`,
    text: [
      `Determine today's bias for ${c.asset} using SMC: previous-day high/low and which ran first, structure (BOS/ChoCH), order blocks and fair-value gaps, premium vs discount${gold ? ", the dollar and rates tilt" : ""}.`,
      `Measured checklist:\n${steps(c)}`,
      `Model chance of up: ${p(c.pUp)}. Bias: ${c.bias}. MiroFish: ${c.news.mirofishState === "ok" ? p(c.news.mirofishP) : c.news.mirofishState}.`,
      "Answer: Bias | Key levels | Entry model today | Invalidation | Which checklist steps disagree and why.",
      rules,
    ].join("\n\n"),
  };
}

export function killzoneBrief(c: PreTrade): Brief {
  return {
    id: "28-killzone-setup",
    title: `${c.asset} killzone setup`,
    text: [
      `For ${c.asset}, judge the current killzone: mark the Asian range, expect London or New York to sweep one side first, enter only after sweep + ChoCH + FVG on 15m, target the other side of the range.`,
      `Measured checklist:\n${steps(c)}`,
      "Answer: Is there a valid sweep → ChoCH → FVG sequence right now (yes/no and which bar)? Entry | Stop | Target, or 'no setup'.",
      rules,
    ].join("\n\n"),
  };
}

export function scenarioBrief(c: PreTrade, headline: string): Brief {
  return {
    id: "114-news-trap",
    title: `${c.asset} scenario: ${headline.slice(0, 60)}`,
    text: [
      `Scenario Lab. Headline: "${headline}". Asset: ${c.asset}. Next 15 minutes.`,
      `Model chance of up before the news: ${p(c.pUp)}; checklist bias ${c.bias}.`,
      "Give three scenarios (continuation, fake-out/trap, reversal). For each: what price does first, what would confirm it on 15m, and whether it agrees with the model. Do not output a probability unless you can show the count behind it.",
      rules,
    ].join("\n\n"),
  };
}

export function reviewBrief(summary: string): Brief {
  return {
    id: "124-126-review",
    title: "End-of-day review",
    text: [
      "Review today's desk decisions against the #124 protocol and the #126 risk overlay.",
      summary,
      "Answer: what lost money and which checklist step should have stopped it | anything that broke a rule | one change to test next (as a backtest, not a live change).",
      rules,
    ].join("\n\n"),
  };
}
