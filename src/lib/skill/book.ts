/** Kalshi books are bids only. A YES bid at p is a NO ask at 1-p. */

export type BookLevel = [string, string];

export type BookRead = {
  spread: number | null;
  yesBid: number | null;
  yesAsk: number | null;
  yesDepth: number;
  noDepth: number;
  imbalance: number | null;
  missing: string[];
};

function best(rows: BookLevel[] | undefined): { px: number; size: number } | null {
  if (!rows?.length) return null;
  const last = rows[rows.length - 1];
  const px = Number(last[0]);
  const size = Number(last[1]);
  if (!Number.isFinite(px) || !Number.isFinite(size)) return null;
  return { px, size };
}

function depth(rows: BookLevel[] | undefined) {
  if (!rows) return 0;
  return rows.reduce((a, row) => a + (Number(row[1]) || 0), 0);
}

export function readBook(yes: BookLevel[] | undefined, no: BookLevel[] | undefined): BookRead {
  const missing: string[] = [];
  const y = best(yes);
  const n = best(no);
  if (!y) missing.push("yes bid");
  if (!n) missing.push("no bid");
  const yesAsk = n ? Number((1 - n.px).toFixed(4)) : null;
  const spread = y && yesAsk != null ? Number((yesAsk - y.px).toFixed(4)) : null;
  const yesDepth = depth(yes);
  const noDepth = depth(no);
  const tot = yesDepth + noDepth;
  return {
    spread,
    yesBid: y?.px ?? null,
    yesAsk,
    yesDepth,
    noDepth,
    imbalance: tot ? Number(((yesDepth - noDepth) / tot).toFixed(3)) : null,
    missing,
  };
}
