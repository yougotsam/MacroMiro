import { bracketCheck, classifySector, flipMode, repricing, type FlipMode, type Sector } from "./flip";

export type RawLeg = {
  ticker?: string;
  event_ticker?: string;
  title?: string;
  yes_sub_title?: string;
  status?: string;
  yes_ask_dollars?: string;
  yes_bid_dollars?: string;
  close_time?: string;
};

export type RawEvent = {
  event_ticker?: string;
  title?: string;
  category?: string;
  markets?: RawLeg[];
};

export type OmniRow = {
  ticker: string;
  eventTicker: string;
  question: string;
  option: string;
  sector: Sector;
  mode: FlipMode;
  yesBid: number | null;
  yesAsk: number | null;
  entry: number | null;
  target: number | null;
  multiple: number | null;
  bracketSum: number | null;
  bracketGap: number | null;
  bracketFlag: boolean;
  closeTime: string | null;
  /** Never a measured win rate. */
  winProbability: "UNKNOWN";
};

function px(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
}

export function boardFromEvents(events: RawEvent[]): OmniRow[] {
  const rows: OmniRow[] = [];
  for (const ev of events) {
    const legs = ev.markets ?? [];
    const asks = legs.map((m) => px(m.yes_ask_dollars));
    const bracket = bracketCheck(asks);
    for (const leg of legs) {
      const ticker = String(leg.ticker ?? "");
      if (!ticker || leg.status === "settled" || leg.status === "closed") continue;
      const question = String(ev.title || leg.title || ticker);
      const sector = classifySector(`${ev.category ?? ""} ${question} ${leg.yes_sub_title ?? ""}`, ticker);
      const yesAsk = px(leg.yes_ask_dollars);
      const yesBid = px(leg.yes_bid_dollars);
      const flip = repricing(yesAsk);
      const mode = flipMode({ ticker, sector, repricingEligible: flip.eligible, bracketFlag: bracket.flag && sector !== "crypto" && sector !== "perps" });
      rows.push({
        ticker,
        eventTicker: String(leg.event_ticker || ev.event_ticker || ""),
        question,
        option: String(leg.yes_sub_title || leg.title || "YES"),
        sector,
        mode,
        yesBid,
        yesAsk,
        entry: flip.entry,
        target: flip.target,
        multiple: flip.multiple,
        bracketSum: bracket.sum,
        bracketGap: bracket.gap,
        bracketFlag: mode === "bracket",
        closeTime: leg.close_time ?? null,
        winProbability: "UNKNOWN",
      });
    }
  }
  const rank = (m: FlipMode) => (m === "bracket" ? 0 : m === "repricing" ? 1 : m === "fifteen" ? 2 : m === "perp" ? 3 : 4);
  rows.sort((a, b) => rank(a.mode) - rank(b.mode) || (b.multiple ?? 0) - (a.multiple ?? 0) || (b.bracketGap ?? -1) - (a.bracketGap ?? -1));
  return rows;
}

export async function loadOmniBoard(fetchImpl: typeof fetch = fetch): Promise<{ rows: OmniRow[]; error: string | null }> {
  try {
    const res = await fetchImpl("https://api.elections.kalshi.com/trade-api/v2/events?status=open&limit=100&with_nested_markets=true", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return { rows: [], error: `events ${res.status}` };
    const body = (await res.json()) as { events?: RawEvent[] };
    return { rows: boardFromEvents(body.events ?? []).slice(0, 80), error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : "events failed" };
  }
}
