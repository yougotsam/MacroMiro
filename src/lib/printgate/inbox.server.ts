export type InboxEvent = {
  id: string;
  receivedAt: string;
  type: string;
  url?: string;
  watchId?: string;
  eventClass?: string;
  isMeaningful?: boolean;
  judgment?: string;
  printValue?: number | null;
  skipped?: string;
  rawType: string;
};

const MAX = 80;
const inbox: InboxEvent[] = [];

export function pushInbox(ev: InboxEvent) {
  inbox.unshift(ev);
  if (inbox.length > MAX) inbox.length = MAX;
}

export function listInbox() {
  return inbox;
}

export function parseMonitorPayload(payload: Record<string, unknown>): InboxEvent[] {
  const type = String(payload.type || "unknown");
  const metadata = (payload.metadata as Record<string, string> | undefined) || {};
  const data = payload.data;
  const rows = Array.isArray(data) ? data : data ? [data] : [{}];
  return rows.map((row, i) => {
    const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
    const snap =
      r.snapshot && typeof r.snapshot === "object"
        ? ((r.snapshot as { json?: { print_value?: number } }).json ?? null)
        : null;
    const json = (r.json as { print_value?: number } | undefined) || snap;
    const judgment = r.judgment as { reason?: string; meaningful?: boolean } | undefined;
    return {
      id: `${Date.now()}-${i}-${Math.random().toString(16).slice(2, 6)}`,
      receivedAt: new Date().toISOString(),
      type,
      rawType: type,
      url: typeof r.url === "string" ? r.url : undefined,
      watchId: metadata.watch_id,
      eventClass: metadata.event_class,
      isMeaningful: typeof r.isMeaningful === "boolean" ? r.isMeaningful : judgment?.meaningful,
      judgment: judgment?.reason,
      printValue: json?.print_value ?? null,
      skipped: r.isMeaningful === false ? "not meaningful" : undefined,
    };
  });
}
