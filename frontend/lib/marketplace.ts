// Asta continua per-impression (vedi ANALISI.md §5): niente blocchi.
// Il bid è un CPM: paghi bid/1000 per ogni impression, e la tua quota di
// traffico è proporzionale al bid. Un click costa bid × CLICK_MULT / 1000.
export const MIN_BID = 1;
export const DEFAULT_BID = 5;
export const CLICK_MULT = 50;

export type BidRow = {
  rank: number;
  campaign: string;
  logo: { letter: string; className: string };
  bid: number;
  impressions: string;
  status: "live" | "paused";
};

export const BIDS: BidRow[] = [
  {
    rank: 1,
    campaign: "Ramp",
    logo: { letter: "R", className: "bg-yellow-400 text-black" },
    bid: 25.0,
    impressions: "1.2M",
    status: "live",
  },
  {
    rank: 2,
    campaign: "Linear",
    logo: { letter: "L", className: "bg-indigo-500 text-white" },
    bid: 3.8,
    impressions: "840K",
    status: "live",
  },
  {
    rank: 3,
    campaign: "Vercel",
    logo: { letter: "▲", className: "bg-black text-white" },
    bid: 2.5,
    impressions: "410K",
    status: "live",
  },
];

export const TOTAL_BID = BIDS.reduce((sum, row) => sum + row.bid, 0);
export const TOP_BID = Math.max(...BIDS.map((b) => b.bid));

// Quota di traffico stimata per un nuovo bid che entra nel mercato attuale.
export const trafficShare = (bid: number) => (bid > 0 ? bid / (TOTAL_BID + bid) : 0);

export const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
