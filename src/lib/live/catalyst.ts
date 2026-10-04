/** Turns already-fetched headlines into a radar. Scraped text is untrusted and cannot place a trade. */

export type CatalystSource = { title: string; url: string; at: string };

export type Catalyst = {
  id: string;
  event: string;
  asset: "btc" | "gold" | "both";
  bias: "bullish" | "bearish" | "mixed" | "unclear";
  timeframe: "immediate" | "15m" | "session" | "longer";
  confidence: "low" | "medium";
  experimentalAdjustment: number | null;
  adjustmentLabel: "Experimental estimate" | "unavailable";
  support: CatalystSource[];
  against: CatalystSource[];
  crawledAt: string;
  why: string;
  trade: false;
  stripped: boolean;
};

export type RawHit = { title: string; url: string; at?: string; kind?: string };

const INSTRUCTION = /ignore (all |any )?(previous|prior) instructions|you are now|system prompt|place (an )?order|buy now/gi;

function clean(text: string) {
  const stripped = INSTRUCTION.test(text);
  INSTRUCTION.lastIndex = 0;
  return { text: text.replace(INSTRUCTION, "").replace(/\s+/g, " ").trim(), stripped };
}

function assetOf(text: string): Catalyst["asset"] {
  const btc = /bitcoin|\bbtc\b|etf inflow|sec |crypto/i.test(text);
  const gold = /\bgold\b|\bxau\b|bullion|real yield/i.test(text);
  const macro = /fomc|cpi|nfp|payroll|ppi|treasury|fed |bls|geopolit|tariff/i.test(text);
  if (macro || (btc && gold)) return "both";
  if (gold) return "gold";
  if (btc) return "btc";
  return "both";
}

function biasOf(text: string): "bullish" | "bearish" | "unclear" {
  const up = /cut|dovish|inflow|surge|rally|cooler|below forecast|ceasefire/i.test(text);
  const down = /hike|hawkish|outflow|hack|ban|hotter|above forecast|invasion|default/i.test(text);
  if (up && down) return "unclear";
  if (up) return "bullish";
  if (down) return "bearish";
  return "unclear";
}

export function buildCatalysts(hits: RawHit[], crawledAt: string): Catalyst[] {
  const seen = new Set<string>();
  const rows: Catalyst[] = [];
  for (const hit of hits) {
    const url = (hit.url || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const { text, stripped } = clean(`${hit.title} ${hit.kind ?? ""}`);
    if (text.length < 8) continue;
    const asset = assetOf(text);
    const lean = biasOf(text);
    const source = { title: text.slice(0, 180), url, at: hit.at || crawledAt };
    rows.push({
      id: url,
      event: text.slice(0, 140),
      asset,
      bias: lean,
      timeframe: /fomc|cpi|nfp/i.test(text) ? "15m" : "session",
      confidence: "low",
      experimentalAdjustment: null,
      adjustmentLabel: "unavailable",
      support: lean === "bullish" ? [source] : [],
      against: lean === "bearish" ? [source] : [],
      crawledAt,
      why: lean === "unclear" ? "The wording does not pick a side. It is not a trade." : `${lean} read for ${asset}. One source. Not a trade.`,
      trade: false,
      stripped,
    });
  }
  return collapse(rows);
}

function collapse(rows: Catalyst[]): Catalyst[] {
  const by = new Map<string, Catalyst>();
  for (const row of rows) {
    const key = row.asset;
    const prev = by.get(key);
    if (!prev) {
      by.set(key, row);
      continue;
    }
    prev.support.push(...row.support);
    prev.against.push(...row.against);
    prev.stripped = prev.stripped || row.stripped;
  }
  return [...by.values()].map(finish);
}

function finish(row: Catalyst): Catalyst {
  const up = row.support.length;
  const down = row.against.length;
  let bias = row.bias;
  if (up && down) bias = "mixed";
  else if (up >= 2) bias = "bullish";
  else if (down >= 2) bias = "bearish";
  const sources = up + down;
  const confidence = sources >= 2 && bias !== "mixed" && bias !== "unclear" ? "medium" : "low";
  const experimentalAdjustment =
    confidence === "medium" && bias === "bullish" ? 0.02 : confidence === "medium" && bias === "bearish" ? -0.02 : null;
  return {
    ...row,
    bias,
    confidence,
    experimentalAdjustment,
    adjustmentLabel: experimentalAdjustment == null ? "unavailable" : "Experimental estimate",
    why:
      bias === "mixed"
        ? "Sources disagree. No probability change."
        : experimentalAdjustment == null
          ? `${bias} for ${row.asset}. Not enough agreement to move a probability.`
          : `${bias} for ${row.asset}. Experimental ${experimentalAdjustment > 0 ? "+" : ""}${experimentalAdjustment} on the thesis, not an order.`,
    trade: false,
  };
}
