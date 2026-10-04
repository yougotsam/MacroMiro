export function relTime(iso: string | null | undefined) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = (Date.now() - t) / 1000;
  if (s < 0) return "now";
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.max(1, Math.round(s / 3600))}h ago`;
  return `${Math.max(1, Math.round(s / 86400))}d ago`;
}

export function unescapeHtml(s: string) {
  return s
    .replace(/\u0026apos;/g, "'")
    .replace(/\u0026#39;/g, "'")
    .replace(/\u0026quot;/g, '"')
    .replace(/\u0026lt;/g, "<")
    .replace(/\u0026gt;/g, ">")
    .replace(/\u0026amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export function toIsoDate(raw: string | null) {
  if (!raw) return null;
  const clean = raw.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
  const t = Date.parse(clean);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
