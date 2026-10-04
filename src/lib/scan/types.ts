export type ScanAction = "scan" | "cancel" | "watch";

export type ScanVenue = "polymarket" | "polyus" | "kalshi" | "binance" | "coinbase" | "solana" | "jupiter" | "yahoo" | "risk";

export type ScanRow = {
  id: string;
  ts: string;
  venue: ScanVenue;
  action: ScanAction;
  market: string;
  price: number | null;
  sizeUsd: number;
  note: string;
  url?: string | null;
};

export type ScanModule = {
  id: string;
  name: string;
  detail: string;
  state: "scanning" | "connected" | "filtering" | "down";
};

export type ScanPayload = {
  asOf: string;
  rows: ScanRow[];
  modules: ScanModule[];
  scannedUsd: number;
  markets: number;
  polyN: number;
  binanceN: number;
  dexN: number;
  scanN: number;
  cancelN: number;
  basisPct: number | null;
  binanceBtc: number | null;
  solUsd: number | null;
  jupUsd: number | null;
  clipUsd: number;
  fair: {
    strike: number;
    yes: number;
    fair: number;
    gap: number;
    question: string;
    afterFee: number;
  } | null;
  fomcHike: number | null;
  fomcHold: number | null;
};
