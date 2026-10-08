export type BrokerChoice = {
  id: "paper" | "pmus" | "alpaca" | "ibkr";
  name: string;
  role: string;
  assets: string;
  paper: string;
  when: string;
  blocker: string;
};

export const BROKERS: BrokerChoice[] = [
  {
    id: "paper",
    name: "Kalshi paper",
    role: "Same 15m contracts. An order leaves only when the begin file is on and the math clears.",
    assets: "KXBTC15M, KXETH15M, KXSOL15M, KXXRP15M, and KXGOLD15M. Each needs its own settlement feed.",
    paper: "Shadow log",
    when: "Now",
    blocker: "",
  },
];