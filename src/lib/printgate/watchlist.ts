export type WatchTarget = {
  id: string;
  name: string;
  kind: "print" | "calendar" | "narrative";
  eventClass: string;
  urls: string[];
  schedule: string;
  goal: string;
};

export const WATCH: WatchTarget[] = [
  {
    id: "bls_nfp",
    name: "BLS Employment Situation",
    kind: "print",
    eventClass: "nfp",
    urls: [
      "https://www.bls.gov/news.release/empsit.nr0.htm",
      "https://www.bls.gov/news.release/empsit.toc.htm",
    ],
    schedule: "Fri 08:35 ET",
    goal: "NFP change (000s) + unemployment rate",
  },
  {
    id: "bls_cpi",
    name: "BLS CPI",
    kind: "print",
    eventClass: "cpi",
    urls: ["https://www.bls.gov/news.release/cpi.nr0.htm", "https://www.bls.gov/cpi/"],
    schedule: "print window only",
    goal: "CPI-U 12-month %",
  },
  {
    id: "fomc",
    name: "FOMC calendar + statement",
    kind: "calendar",
    eventClass: "fomc",
    urls: [
      "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
      "https://www.federalreserve.gov/monetarypolicy/fomc.htm",
    ],
    schedule: "meeting days",
    goal: "Next decision date + funds target if posted",
  },
  {
    id: "ecb",
    name: "ECB monetary policy",
    kind: "calendar",
    eventClass: "ecb",
    urls: [
      "https://www.ecb.europa.eu/press/calendars/html/index.en.html",
      "https://www.ecb.europa.eu/press/govcdec/html/index.en.html",
    ],
    schedule: "meeting days",
    goal: "Deposit rate + statement",
  },
  {
    id: "eia_wpsr",
    name: "EIA weekly petroleum",
    kind: "print",
    eventClass: "eia_crude",
    urls: [
      "https://www.eia.gov/petroleum/supply/weekly/",
      "https://www.eia.gov/dnav/pet/pet_stoc_wstk_dcu_nus_w.htm",
    ],
    schedule: "Wed 10:35 ET",
    goal: "US commercial crude mmbbl",
  },
  {
    id: "cftc_cot",
    name: "CFTC COT",
    kind: "print",
    eventClass: "cot_gold",
    urls: [
      "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm",
      "https://www.cftc.gov/dea/futures/deacmesf.htm",
    ],
    schedule: "Fri 15:35 ET",
    goal: "COMEX gold managed-money net",
  },
  {
    id: "gld",
    name: "SPDR GLD holdings",
    kind: "print",
    eventClass: "gld_flow",
    urls: ["https://www.spdrgoldshares.com/usa/", "https://www.spdrgoldshares.com/usa/gold-bar-list/"],
    schedule: "2x/day",
    goal: "GLD tonnes",
  },
  {
    id: "btc_etf",
    name: "US spot BTC ETF flows",
    kind: "print",
    eventClass: "btc_etf_flow",
    urls: ["https://farside.co.uk/btc/", "https://www.theblock.co/data/crypto-markets/bitcoin-etf"],
    schedule: "weekdays 18:00 ET",
    goal: "Daily net flow USD mn",
  },
];
