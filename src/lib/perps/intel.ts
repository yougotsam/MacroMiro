/**
 * Perps intelligence fusion (EXPERIMENTAL weights, research path only). It reuses existing pieces: the official
 * calendar gate (desk/macro-calendar), grid features (grid/features computeFeatures), research-context items
 * (MiroFish / Spark 2 / desk news), the Firecrawl intel events log, and the Spark v2 catalyst template with perps assets.
 * Every feature carries SOURCE → EVENT → TIMESTAMP (published/available) → RELEVANCE → SCORE. A feature is used only
 * if it was AVAILABLE before the decision time; late items are kept in the trace and marked LATE.
 * Only two ways it can touch a decision:
 *  (1) macroClear into the sniper's macro point (official calendar only, the same rule the Kalshi desk uses);
 *  (2) an additive ranker term (intelScore × intelWeight).
 * Neither changes size, leverage or the stop.
 */
import { macroGateOfficial } from "@/lib/desk/macro-calendar";
import { computeFeatures } from "@/lib/grid/features";
import { catalystPrompt } from "@/lib/grid/spark-templates";

export const INTEL_WEIGHT_EXPERIMENTAL = 0.25;
export const PERPS_ASSETS = ["BTC", "ETH", "SOL", "XRP", "GOLD", "SILVER", "US500"];
export const ASSET_OF: Record<string, string> = { KXBTCPERP: "BTC", KXETHPERP: "ETH", KXSOLPERP: "SOL", KXXRPPERP: "XRP", KXGOLDPERP: "GOLD", KXSILVERPERP: "SILVER", KXUS500PERP: "US500" };
const MACRO_SENSITIVE = new Set(["BTC", "ETH", "SOL", "XRP", "GOLD", "SILVER", "US500"]);
const MAJOR = /\b(CPI|Consumer Price|FOMC|Federal Reserve|Employment Situation|Producer Price|PPI|nonfarm|Beige Book)\b/i;

export type IntelRow = { source: string; event: string; publishedAt: string | null; availableAt: string | null; usable: "PRE_DECISION" | "LATE" | "NO_TIMESTAMP"; relevance: number; score: number; note: string };
export type IntelInput = { calendar: unknown; intelEvents: Array<Record<string, any>>; mirofish: Record<string, any> | null; spark: Record<string, any> | null; evidence: Array<Record<string, any>> };

export function perpsIntel(ticker: string, decisionMs: number, inp: IntelInput) {
  const asset = ASSET_OF[ticker] ?? ticker;
  const rows: IntelRow[] = [];
  const iso = (x: unknown) => { const t = typeof x === "number" ? x : Date.parse(String(x ?? "")); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
  const usability = (avail: string | null): IntelRow["usable"] => (avail == null ? "NO_TIMESTAMP" : Date.parse(avail) <= decisionMs ? "PRE_DECISION" : "LATE");

  // 1) official calendar (BLS/Fed/BEA): the same gate as the Kalshi desk; it can only set macroClear
  const gate = macroGateOfficial(inp.calendar, decisionMs);
  const evs = ((inp.calendar as { events?: { name: string; when: string; source: string }[] })?.events ?? []);
  const next24 = evs.filter((e) => { const t = Date.parse(e.when); return t > decisionMs && t - decisionMs <= 24 * 3600_000; });
  const nextMajor = evs.filter((e) => MAJOR.test(e.name) && Date.parse(e.when) > decisionMs).sort((a, b) => Date.parse(a.when) - Date.parse(b.when))[0];
  const fetchedAt = iso((inp.calendar as { fetchedAt?: string })?.fetchedAt);
  const hoursToMajor = nextMajor ? (Date.parse(nextMajor.when) - decisionMs) / 3600_000 : null;
  rows.push({ source: "official calendar (bls.gov ics, federalreserve.gov, bea.gov)", event: nextMajor ? `${nextMajor.name} @ ${nextMajor.when}` : "no upcoming major release", publishedAt: fetchedAt, availableAt: fetchedAt, usable: usability(fetchedAt),
    relevance: MACRO_SENSITIVE.has(asset) ? 1 : 0.3, score: gate.available && !gate.blocked ? 0 : -1, note: gate.available ? (gate.blocked ? `inside veto window: ${gate.events.join("; ")}` : `verified; ${next24.length} releases in next 24 h; next major in ${hoursToMajor?.toFixed(1)} h`) : `calendar unavailable (${gate.reason}) → macroClear=false` });

  // 2) Firecrawl/monitor intel events (venue ops, regulatory)
  for (const e of inp.intelEvents) {
    const rel = (e.assets ?? []).includes(asset) ? 1 : 0;
    const f = computeFeatures({ publishedAt: e.publishedAt, detectedAt: e.detectedAt }).find((x) => x.name === "NEWS_LATENCY");
    rows.push({ source: String(e.source ?? "intel"), event: String(e.title), publishedAt: iso(e.publishedAt), availableAt: iso(e.detectedAt), usable: usability(iso(e.detectedAt)), relevance: rel,
      score: rel ? -0.5 : 0, note: `latency ${f?.value != null ? (f.value / 3600).toFixed(1) + " h" : "n/a"} (published→our detection); ${rel ? "venue-ops risk on this asset" : "not this asset"}` });
  }
  // 3) Spark 2 catalyst card (context) — template extended to perps assets
  if (inp.spark?.card) {
    const c = inp.spark.card; const at = iso(inp.spark.at);
    rows.push({ source: "Spark 2 catalyst card (" + String(inp.spark.status) + ")", event: String(c.event ?? "").slice(0, 120), publishedAt: null, availableAt: at, usable: usability(at), relevance: MACRO_SENSITIVE.has(asset) ? 0.5 : 0, score: 0,
      note: `bias=${c.bias ?? "n/a"}; context only (no probability). Perps template prompt ready: ${catalystPrompt({ event: String(c.event ?? ""), officialUrls: [], scheduledAt: null, assets: PERPS_ASSETS }).length} chars` });
  }
  // 4) MiroFish scenario (SIMULATED; weight 0)
  if (inp.mirofish) {
    const at = iso(inp.mirofish.at);
    rows.push({ source: "MiroFish", event: String(inp.mirofish.headline ?? ""), publishedAt: null, availableAt: at, usable: usability(at), relevance: 0.5, score: 0, note: `SIMULATED agents, not traders; stage: ${String(inp.mirofish.stage).slice(0, 80)}` });
  }
  // 5) statement diffs / evidence (e.g., FOMC diff)
  for (const e of inp.evidence.filter((x) => x.kind === "statement_diff")) {
    const at = iso(e.detectedAt);
    rows.push({ source: String(e.sourceUrl), event: String(e.title), publishedAt: iso(e.publishedAt), availableAt: at, usable: usability(at), relevance: MACRO_SENSITIVE.has(asset) ? 0.5 : 0, score: 0, note: `${e.summary}; NARRATIVE_CHANGE only, no direction (weight 0)` });
  }
  // MACRO_SURPRISE needs actual AND consensus from named sources; we do not store consensus → PENDING
  const surprise = computeFeatures({}).find((x) => x.name === "MACRO_SURPRISE")!;
  rows.push({ source: "grid/features MACRO_SURPRISE", event: "actual vs expected", publishedAt: null, availableAt: null, usable: "NO_TIMESTAMP", relevance: 1, score: 0, note: `${surprise.status}: no sourced consensus stored (free sources only); cannot score` });

  const usable = rows.filter((r) => r.usable === "PRE_DECISION");
  const intelScore = +usable.reduce((s, r) => s + r.relevance * r.score, 0).toFixed(3);
  const macroClear = gate.available && !gate.blocked;
  return { ticker, asset, decisionAt: new Date(decisionMs).toISOString(), macroClear, intelScore, weight: INTEL_WEIGHT_EXPERIMENTAL, rows };
}
