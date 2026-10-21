/**
 * Promotion evidence comes only from journal rows whose fill count is above zero
 * and whose fee was copied off Kalshi. Hypothetical decisions (filled: false, taker fee assumed)
 * are not included. This file does not send an order.
 */
import { readFileSync, existsSync } from "node:fs";
import { promotionDocument, type PromotionDoc } from "../deskc/promotion";
import type { DecisionRow } from "../deskc/scorecard";
import type { JournalRow } from "./oms";

export type JournalFill = {
  cid: string;
  ticker: string;
  fill: number;
  fee: number | null;
  feeSource: "exchange" | "unknown";
  mode?: string;
};

export function journalFills(rows: JournalRow[]): JournalFill[] {
  const by = new Map<string, JournalRow[]>();
  for (const r of rows) {
    if (!r.cid) continue;
    const list = by.get(r.cid);
    if (list) list.push(r);
    else by.set(r.cid, [r]);
  }
  const out: JournalFill[] = [];
  for (const [cid, list] of by) {
    let fill = 0;
    let fee: number | null = null;
    let feeSource: "exchange" | "unknown" = "unknown";
    let ticker = list[0]?.ticker ?? "";
    let mode = list[0]?.mode;
    for (const r of list) {
      if (typeof r.fill === "number" && r.fill > fill) fill = r.fill;
      if (r.ticker) ticker = r.ticker;
      if (r.mode) mode = r.mode;
      if (r.feeSource === "exchange" && typeof r.fee === "number" && Number.isFinite(r.fee) && r.fee >= 0) {
        fee = r.fee;
        feeSource = "exchange";
      }
    }
    if (fill > 0) out.push({ cid, ticker, fill, fee, feeSource, mode });
  }
  return out;
}

type Buy = {
  cid: string;
  ticker: string;
  series: string;
  ts: string;
  close: string | null;
  tte: number;
  p: number;
  yesBid: number;
  yesAsk: number;
  side: "yes" | "no";
  mode: "maker" | "taker";
  price: number;
  setup: string;
  indexAge: number;
  bookAge: number;
};

function lines(path: string): unknown[] {
  if (!existsSync(path)) return [];
  const out: unknown[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* torn */ }
  }
  return out;
}

function buys(path: string): Map<string, Buy> {
  const out = new Map<string, Buy>();
  for (const raw of lines(path) as Record<string, unknown>[]) {
    if (raw.action !== "BUY") continue;
    const order = raw.order as { cid?: string } | undefined;
    const best = raw.best as { side?: string; mode?: string; price?: number } | null | undefined;
    const quotes = raw.quotes as { yes_bid?: number; yes_ask?: number } | null | undefined;
    const cid = order?.cid;
    if (!cid || !best || best.side !== "yes" && best.side !== "no") continue;
    if (best.mode !== "maker" && best.mode !== "taker") continue;
    if (typeof best.price !== "number" || typeof raw.p !== "number" || typeof raw.ticker !== "string" || typeof raw.series !== "string") continue;
    if (typeof quotes?.yes_bid !== "number" || typeof quotes?.yes_ask !== "number") continue;
    const conf = raw.confluence as { long?: { setup?: string }; short?: { setup?: string } } | null | undefined;
    const named = best.side === "yes" ? conf?.long?.setup : conf?.short?.setup;
    out.set(cid, {
      cid,
      ticker: raw.ticker,
      series: raw.series,
      ts: typeof raw.ts === "string" ? raw.ts : "",
      close: typeof raw.close === "string" ? raw.close : null,
      tte: typeof raw.tte_s === "number" ? raw.tte_s : 0,
      p: raw.p,
      yesBid: quotes.yes_bid,
      yesAsk: quotes.yes_ask,
      side: best.side,
      mode: best.mode,
      price: best.price,
      setup: named && named !== "NONE" ? named : "settlement-model",
      indexAge: typeof raw.index_age_ms === "number" ? raw.index_age_ms : 99_000,
      bookAge: typeof raw.book_age_ms === "number" ? raw.book_age_ms : 99_000,
    });
  }
  return out;
}

/** One row per verified fill. Unverified fees are counted and then left out. */
export function verifiedFillRows(journal: JournalFill[], buyByCid: Map<string, Buy>, outcomes: Map<string, "yes" | "no">): { rows: DecisionRow[]; unverified: number } {
  const rows: DecisionRow[] = [];
  let unverified = 0;
  for (const f of journal) {
    if (f.feeSource !== "exchange" || f.fee == null) { unverified += 1; continue; }
    const b = buyByCid.get(f.cid);
    const result = outcomes.get(f.ticker);
    if (!b || (result !== "yes" && result !== "no")) { unverified += 1; continue; }
    const y: 0 | 1 = result === "yes" ? 1 : 0;
    const won = b.side === "yes" ? y === 1 : y === 0;
    const per = f.fee / f.fill;
    const pnl = won ? 1 - b.price - per : -b.price - per;
    const at = Date.parse(b.ts) || 0;
    rows.push({
      at,
      expiryMs: Date.parse(b.close ?? "") || at,
      series: b.series,
      setup: b.setup,
      modelPYes: b.p,
      yesPrice: (b.yesBid + b.yesAsk) / 2,
      edge: b.side === "yes" ? b.p - b.price : 1 - b.p - b.price,
      mode: b.mode,
      featureHash: b.ticker,
      settledYes: y,
      pnlAfterFees: Number(pnl.toFixed(6)),
      fresh: b.indexAge < 20_000 && b.bookAge < 20_000,
      tteSec: b.tte,
      filled: true,
    });
  }
  return { rows, unverified };
}

export function promotionFromDisk(dir: string, now = Date.now()): { doc: PromotionDoc; why: string; verified: number; unverified: number } {
  const journal = journalFills(lines(`${dir}/oms-journal.jsonl`) as JournalRow[]);
  const outcomes = new Map<string, "yes" | "no">();
  for (const o of lines(`${dir}/outcomes.jsonl`) as { ticker?: string; result?: string }[]) {
    if (o.ticker && (o.result === "yes" || o.result === "no")) outcomes.set(o.ticker, o.result);
  }
  const { rows, unverified } = verifiedFillRows(journal, buys(`${dir}/decisions.jsonl`), outcomes);
  const bySetup: Record<string, DecisionRow[]> = {};
  for (const r of rows) (bySetup[r.setup] ??= []).push(r);
  if (!Object.keys(bySetup).length) bySetup["settlement-model"] = [];
  const doc = promotionDocument(bySetup, now);
  const parts = Object.entries(doc.setups).map(([id, s]) => `${id} ${s.state} ${s.why}`);
  const why = `journal fills ${journal.length}; fee-verified ${rows.length}; fee-unknown ${unverified}; ${parts.join("; ")}; flat budget stays until ELIGIBLE`;
  return { doc, why, verified: rows.length, unverified };
}
