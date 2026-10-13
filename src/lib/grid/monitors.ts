/**
 * Intel Grid monitor definitions (Phase 3). Research only: a monitor change becomes evidence, nothing more.
 * Every monitor's Firecrawl `estimatedCreditsPerMonth` is recorded at creation. The combined estimate for grid
 * monitors is capped (GRID_MONITOR_CAP, default 15,000/month); anything that would exceed it is kept DISABLED
 * (paused in Firecrawl, or not created) and reported for approval.
 */
export type MonitorKind = "page" | "section" | "search";
export type MonitorDef = {
  key: string; kind: MonitorKind; name: string; cron: string; essential: boolean; why: string;
  body: Record<string, unknown>;
};

export const GRID_MONITOR_CAP = Number(process.env.GRID_MONITOR_CAP) > 0 ? Number(process.env.GRID_MONITOR_CAP) : 15_000;
const TZ = "America/New_York";

export const MONITORS: MonitorDef[] = [
  {
    key: "official-release-pages",
    kind: "page",
    name: "Grid: official release pages (BLS CPI/jobs/PPI, BEA GDP/PCE)",
    cron: "15 */3 * * *",
    essential: true,
    why: "Every 3 h, not 5-minute: release minutes are already covered by the event-aware release read (every 10 min, 30 min before to 90 min after each scheduled release). This catches unscheduled revisions/corrections. Hourly was estimated at 5,760 credits/month; 3-hourly at ~1,920.",
    body: {
      targets: [{ type: "scrape", urls: ["https://www.bls.gov/news.release/cpi.nr0.htm", "https://www.bls.gov/news.release/empsit.nr0.htm", "https://www.bls.gov/news.release/ppi.nr0.htm", "https://www.bea.gov/news/current-releases"] }],
      goal: "Alert when a new release, a revised figure, a correction notice or a changed release date appears. Ignore navigation, footer and layout changes.",
      judgeEnabled: true,
    },
  },
  {
    key: "fed-press-section",
    kind: "section",
    name: "Grid: Federal Reserve press releases section (new/revised/removed pages)",
    cron: "0 */6 * * *",
    essential: false,
    why: "Every 6 h (3-hourly was estimated at 4,800 credits/month); FOMC statements are also caught by the Fed RSS hourly for free. The crawl adds revised/removed-page detection.",
    body: {
      targets: [{ type: "crawl", url: "https://www.federalreserve.gov/newsevents/pressreleases.htm", crawlOptions: { limit: 10, maxDiscoveryDepth: 1, includePaths: ["newsevents/pressreleases/.*"] } }],
      goal: "Alert on new or revised Federal Reserve Board press releases about monetary policy, FOMC statements, discount rate or emergency facilities. Ignore enforcement actions and banking applications.",
      judgeEnabled: true,
    },
  },
  {
    key: "web-crypto-exchange",
    kind: "search",
    name: "Grid: web search – crypto exchange outages, restrictions, ETF decisions",
    cron: "0 */2 * * *",
    essential: false,
    why: "Every 2 h: exchange incidents and ETF decisions move BTC/ETH/SOL/XRP and are not on any official calendar.",
    body: {
      targets: [{ type: "search", queries: ["crypto exchange outage OR halt OR withdrawals suspended", "SEC decision spot bitcoin OR ether OR solana OR XRP ETF"], searchWindow: "6h", maxResults: 10 }],
      goal: "Alert on a NEW report of a major crypto exchange outage, trading halt, withdrawal suspension or regulatory restriction, or a regulator decision on a crypto ETF. Ignore price commentary, predictions and sponsored content.",
      judgeEnabled: true,
    },
  },
  {
    key: "web-macro-surprise",
    kind: "search",
    name: "Grid: web search – central-bank surprises, data revisions, gold policy",
    cron: "0 */4 * * *",
    essential: false,
    why: "Every 4 h: unscheduled central-bank actions, statistical revisions and central-bank gold buying/selling.",
    body: {
      targets: [{ type: "search", queries: ["central bank surprise rate decision emergency", "BLS OR BEA revision revised data", "central bank gold reserves purchase OR sale"], searchWindow: "24h", maxResults: 10 }],
      goal: "Alert on a NEW unscheduled central-bank policy action, an official US data revision, or a central bank announcing gold reserve purchases or sales. Ignore opinion pieces and forecasts.",
      judgeEnabled: true,
    },
  },
];

export type CreatedMonitor = { key: string; id: string | null; estimatedCreditsPerMonth: number | null; status: "active" | "paused" | "not_created"; cron: string; reason: string };

/** Decide which monitors stay active given Firecrawl's per-monitor estimates and the cap. Essential first. */
export function planActivation(estimates: { key: string; estimate: number; essential: boolean }[], cap = GRID_MONITOR_CAP) {
  const order = [...estimates].sort((a, b) => Number(b.essential) - Number(a.essential));
  let total = 0;
  const active: string[] = [];
  const disabled: string[] = [];
  for (const m of order) {
    if (total + m.estimate <= cap) {
      total += m.estimate;
      active.push(m.key);
    } else disabled.push(m.key);
  }
  return { active, disabled, total };
}

export function createBody(def: MonitorDef) {
  return { name: def.name, schedule: { cron: def.cron, timezone: TZ }, retentionDays: 30, ...def.body };
}
