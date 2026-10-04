export type TfId = "1m" | "5m" | "15m" | "1h" | "6h" | "1d";

export const TFS: { id: TfId; label: string; cb: number; yahoo: string; range: string }[] = [
  { id: "1m", label: "1m", cb: 60, yahoo: "1m", range: "1d" },
  { id: "5m", label: "5m", cb: 300, yahoo: "5m", range: "5d" },
  { id: "15m", label: "15m", cb: 900, yahoo: "15m", range: "5d" },
  { id: "1h", label: "1h", cb: 3600, yahoo: "60m", range: "1mo" },
  { id: "6h", label: "6h", cb: 21600, yahoo: "1h", range: "3mo" },
  { id: "1d", label: "1D", cb: 86400, yahoo: "1d", range: "1y" },
];

export function tfOf(id: string): (typeof TFS)[number] {
  return TFS.find((t) => t.id === id) ?? TFS[2];
}
