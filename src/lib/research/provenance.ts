/**
 * Seed provenance (round 3.3). A MiroFish seed may only contain documents that are
 *   - from an allow-listed official host,
 *   - specific to the catalyst (CPI pages for a CPI sim; no homepages, no unrelated releases),
 *   - carry a publication timestamp taken from the document itself (or the verified calendar's fetch time), and
 *   - were published BEFORE the simulation start and before the event (no look-ahead into the release).
 * Pure functions; no network. Rejections carry a reason and are recorded with the job.
 */
import { etWallToUtc } from "@/lib/desk/official-calendar";
import type { CatalystKind } from "./pipeline";

export type SeedDoc = { url: string; title: string; text: string; publishedAt: string | null; publishedBasis: string; fetchedAt: string; docType: "schedule" | "prior_release" | "nowcast" };
export type Verdict = { ok: true } | { ok: false; reason: string };

export const OFFICIAL_HOSTS = new Set(["www.bls.gov", "bls.gov", "www.clevelandfed.org", "www.federalreserve.gov", "www.bea.gov"]);
/** catalyst-specific documents by kind; anything else is not seeded */
export const SEED_DOCS: Partial<Record<CatalystKind, Array<{ url: string; docType: SeedDoc["docType"] }>>> = {
  cpi: [
    { url: "https://www.bls.gov/schedule/news_release/bls.ics", docType: "schedule" },
    { url: "https://www.bls.gov/news.release/cpi.nr0.htm", docType: "prior_release" },
    { url: "https://www.clevelandfed.org/indicators-and-data/inflation-nowcasting", docType: "nowcast" },
    // BLS's CPI schedule page carries no publication timestamp: it is fetched, then rejected as undated.
    { url: "https://www.bls.gov/schedule/news_release/cpi.htm", docType: "schedule" },
  ],
};
const SPECIFIC: Partial<Record<CatalystKind, RegExp>> = { cpi: /consumer price index|\bCPI\b/i, ppi: /producer price index/i, nfp: /employment situation|nonfarm payroll/i, fomc: /FOMC|Federal Open Market Committee/i };
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthIx = (m: string) => MONTHS.findIndex((x) => x.startsWith(m.toLowerCase().replace(/\.$/, "").slice(0, 3)));

export function isHomepage(url: string, title = "") {
  const u = new URL(url);
  const path = u.pathname.replace(/\/+$/, "");
  if (path === "" || /^\/(index|home|default)(\.html?|\.aspx)?$/i.test(path)) return true;
  // a title that is only the agency name (what a redirect-to-home looks like)
  return /^\s*(U\.S\. Bureau of Labor Statistics|Federal Reserve Bank of Cleveland|Board of Governors of the Federal Reserve System)(\s*[:|-]\s*\1)?\s*$/i.test(title);
}

/** BLS release text: "embargoed until 8:30 a.m. (ET) Friday, September 11, 2026" */
export function blsReleaseTime(text: string): string | null {
  const m = text.match(/embargoed\s+until\s+(\d{1,2}):(\d{2})\s*([ap])\.?m\.?\s*\(ET\)\s*\w+,\s*([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})/i);
  if (!m) return null;
  let hh = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "p") hh += 12;
  const mo = monthIx(m[4]);
  if (mo < 0) return null;
  return new Date(etWallToUtc(Number(m[6]), mo + 1, Number(m[5]), hh, Number(m[2]))).toISOString();
}

/**
 * Cleveland Fed nowcast: the table's "Updated MM/DD" column plus the page's own statement that estimates are
 * updated "around 10:00 a.m. Eastern". We take 12:00 ET of the latest MM/DD as a conservative upper bound;
 * the year comes from the newest "<Month> YYYY" row label.
 */
export function clevelandNowcastTime(text: string): string | null {
  if (!/updated daily|every business day around 10:00 a\.m\. Eastern/i.test(text.replace(/\s+/g, " "))) return null;
  const rows = [...text.matchAll(/\b([A-Z][a-z]+) (\d{4})\s+(?:-?\d+\.\d+\s+){1,4}(\d{2})\/(\d{2})\b/g)];
  if (!rows.length) return null;
  let best: number | null = null;
  for (const r of rows) {
    const refMo = monthIx(r[1]);
    let year = Number(r[2]);
    const mo = Number(r[3]), d = Number(r[4]);
    if (refMo >= 0 && mo - 1 < refMo - 6) year += 1; // Dec reference month updated in January
    const t = etWallToUtc(year, mo, d, 12, 0);
    if (best == null || t > best) best = t;
  }
  return best == null ? null : new Date(best).toISOString();
}

export function publishedAtOf(docType: SeedDoc["docType"], url: string, text: string): { at: string | null; basis: string } {
  const host = new URL(url).hostname;
  if (host.endsWith("bls.gov") && docType === "prior_release") return { at: blsReleaseTime(text), basis: "release embargo line in the document" };
  if (host.endsWith("clevelandfed.org") && docType === "nowcast") return { at: clevelandNowcastTime(text), basis: "table 'Updated' date + stated 10:00 ET update (12:00 ET bound)" };
  return { at: null, basis: "no publication timestamp in the document" };
}

/** The provenance gate. simStartMs = when the simulation is seeded; eventMs = the scheduled release. */
export function checkProvenance(doc: SeedDoc, kind: CatalystKind, simStartMs: number, eventMs: number): Verdict {
  let u: URL;
  try { u = new URL(doc.url); } catch { return { ok: false, reason: "bad_url" }; }
  if (u.protocol !== "https:" || !OFFICIAL_HOSTS.has(u.hostname)) return { ok: false, reason: "not_official_host" };
  if (isHomepage(doc.url, doc.title)) return { ok: false, reason: "homepage" };
  if (!(SEED_DOCS[kind] ?? []).some((d) => d.url === doc.url)) return { ok: false, reason: "not_catalyst_specific_url" };
  const re = SPECIFIC[kind];
  if (!re || !re.test(`${doc.title}\n${doc.text.slice(0, 6000)}`)) return { ok: false, reason: "irrelevant_content" };
  if (doc.text.length < (doc.docType === "schedule" ? 80 : 200)) return { ok: false, reason: "too_short" };
  if (!doc.publishedAt || !Number.isFinite(Date.parse(doc.publishedAt))) return { ok: false, reason: "undated" };
  const pub = Date.parse(doc.publishedAt);
  if (pub > simStartMs) return { ok: false, reason: "published_after_sim_start" };
  if (pub >= eventMs) return { ok: false, reason: "published_at_or_after_event" };
  if (pub > Date.parse(doc.fetchedAt)) return { ok: false, reason: "published_after_fetch" };
  return { ok: true };
}
