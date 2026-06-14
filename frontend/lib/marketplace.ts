import { api } from "./api";

// Costanti economiche (mirror del backend, vedi config.js → economics).
// 1 block = 1.000 views (5s). Il bid è prezzo per block E posizione in coda:
// bid più alto = consegna prima, NON più views.
export const MIN_BID = 1; // $ minimo per block
export const DEFAULT_BID = 5; // $ default nel form
export const CLICK_MULT = 50; // un click costa bid × 50 / 1000
export const VIEWS_PER_BLOCK = 1000;

export type CampaignStatus = "live" | "paused";

export type MarketCampaign = {
  rank: number;
  name: string;
  bidMicros: number;
  viewsDelivered: number;
  status: CampaignStatus;
};

export type Market = {
  servedToday: number;
  topBidMicros: number;
  campaigns: MarketCampaign[];
};

type MarketResponse = {
  served_today: number;
  top_bid_micros: number;
  campaigns: {
    rank: number;
    name: string;
    bid_micros: number;
    views_delivered: number;
    status: CampaignStatus;
  }[];
};

// Dati reali del marketplace (endpoint pubblico /market sul backend).
export async function fetchMarket(): Promise<Market> {
  const data = await api<MarketResponse>("/market");
  return {
    servedToday: data.served_today,
    topBidMicros: data.top_bid_micros,
    campaigns: data.campaigns.map((c) => ({
      rank: c.rank,
      name: c.name,
      bidMicros: c.bid_micros,
      viewsDelivered: c.views_delivered,
      status: c.status,
    })),
  };
}

export const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Come usd ma con sotto-centesimi visibili (il costo per impression a bid bassi
// è < $0,01, es. $0,005 a $5/block).
export const usdSub = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

// "312k" / "1.2M" per la colonna views.
export const compactViews = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    : n >= 1_000
      ? `${Math.round(n / 1_000)}k`
      : `${n}`;

// Posizione in coda che un prezzo (in $) prenderebbe nel mercato attuale.
export const rankFor = (price: number, campaigns: MarketCampaign[]) =>
  campaigns.filter((c) => c.bidMicros / 1_000_000 > price).length + 1;

// Logo deterministico (lettera + colore) derivato dal nome campagna.
const LOGO_COLORS = [
  "bg-amber-400 text-black",
  "bg-indigo-500 text-white",
  "bg-emerald-600 text-white",
  "bg-sky-500 text-white",
  "bg-rose-500 text-white",
  "bg-zinc-800 text-white",
];
export function logoFor(name: string) {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return { letter, className: LOGO_COLORS[h % LOGO_COLORS.length] };
}
