export type BookSnap = { seq: number; yes: [string, string][]; no: [string, string][] };

export function nextBook(prev: BookSnap | null, msg: { seq: number; snapshot: boolean; yes: [string, string][]; no: [string, string][] }) {
  if (msg.snapshot || prev == null) return { book: { seq: msg.seq, yes: msg.yes, no: msg.no }, gap: false, recover: false };
  if (msg.seq !== prev.seq + 1) return { book: prev, gap: true, recover: true };
  return { book: { seq: msg.seq, yes: msg.yes, no: msg.no }, gap: false, recover: false };
}

export function reuseClientId(prev: { ticker: string; clientOrderId: string; status: string } | null, ticker: string) {
  if (!prev || prev.ticker !== ticker) return null;
  if (prev.status === "unknown" || prev.status === "resting" || prev.status === "open") return prev.clientOrderId;
  return null;
}
