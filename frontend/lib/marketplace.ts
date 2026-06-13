// Modello a BLOCK (stile kickbacks): 1 block = 1.000 views (visualizzazioni da 5s).
// I block comprano le views (volume garantito). Il "bid" è il prezzo per block ED è
// la posizione in coda: bid più alto = consegna prima, NON più views.
export const MIN_BID = 1;
export const DEFAULT_BID = 5;
export const CLICK_MULT = 50;
export const VIEWS_PER_BLOCK = 1000;

export type BidRow = {
  rank: number;
  campaign: string;
  logo: { letter: string; className: string };
  bid: number; // prezzo per block
  views: string; // views consegnate (display)
  status: "live" | "paused";
};

export const BIDS: BidRow[] = [
  {
    rank: 1,
    campaign: "Ramp",
    logo: { letter: "R", className: "bg-yellow-400 text-black" },
    bid: 25.0,
    views: "1.2M",
    status: "live",
  },
  {
    rank: 2,
    campaign: "Linear",
    logo: { letter: "L", className: "bg-indigo-500 text-white" },
    bid: 3.8,
    views: "840K",
    status: "live",
  },
  {
    rank: 3,
    campaign: "Vercel",
    logo: { letter: "▲", className: "bg-black text-white" },
    bid: 2.5,
    views: "410K",
    status: "live",
  },
];

export const TOP_BID = Math.max(...BIDS.map((b) => b.bid));

// La posizione in coda che un nuovo prezzo per block prenderebbe nel mercato attuale
// (1 = primo). Determina la VELOCITÀ di consegna, non quante views ottieni.
export const rankFor = (price: number) => BIDS.filter((b) => b.bid > price).length + 1;

export const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
