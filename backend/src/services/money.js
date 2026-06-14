import { economics } from "../config.js";

// Aritmetica del denaro, in micros (1$ = 1_000_000). Funzioni PURE, estratte dai
// punti d'uso sparsi (characterization: stesso identico comportamento) per
// uccidere il "/1000" magico e la duplicazione dello split. Object Calisthenics:
// si wrappano i primitivi; Connascence of Meaning -> Connascence of Name.

const PER_MILLE = 1_000; // il bid è un CPM: prezzo per 1.000 impression (views da 5s)

// Costo di UNA impression: bid_micros è il CPM, quindi bid/1000, arrotondato per
// difetto (il costo è sempre un intero di micros — niente frazioni di micro).
export function costPerImpression(bidMicros) {
  return Math.floor(bidMicros / PER_MILLE);
}

// Costo di UN click pagato: bid × CLICK_MULT / 1000 (il click vale di più).
export function costPerClick(bidMicros) {
  return Math.floor((bidMicros * economics.CLICK_MULT) / PER_MILLE);
}

// Split puro di un evento pagato nelle tre gambe del ledger, in micros.
// Estratto da recordSpend (characterization: stesso identico comportamento,
// nessuna nuova validazione — il tightening dei tipi è un refactor Sprint 4).
//
// Invariante di doppia entrata: advertiser + user + platform === 0.
//   impression -> 50% (Math.floor) all'utente, il RESTO alla piattaforma
//   click      -> 0 all'utente, tutto alla piattaforma
//
// La conservazione del denaro regge perché `platform` è il RESTO (costMicros - user),
// NON un secondo Math.floor: rendere simmetrico lo split romperebbe la somma-zero
// sui costi dispari senza che nulla diventi rosso. Questo è ciò che i test blindano.
export function splitSpend({ refType, costMicros }) {
  const user = refType === "impression" ? Math.floor(costMicros * economics.USER_SHARE) : 0;
  const platform = costMicros - user;
  return { advertiser: -costMicros, user, platform };
}
