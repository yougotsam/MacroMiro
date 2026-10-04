export type UsContract = {
  slug: string;
  title: string;
  question: string;
  yes: number;
  no: number;
  bid: number | null;
  ask: number | null;
  end: string | null;
  url: string;
  category: string;
};

export type PmusStatus = {
  keysOnDisk: boolean;
  auth: boolean;
  authError: string | null;
  liveOrders: boolean;
  host: string;
  cashUsd: number | null;
  buyingPower: number | null;
  positions: number;
  fiveMin: boolean;
  note: string;
  contracts: UsContract[];
};
