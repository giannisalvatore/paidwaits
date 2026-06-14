import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSpend, costPerImpression, costPerClick } from "../src/services/money.js";
import { economics } from "../src/config.js";

const total = (s) => s.advertiser + s.user + s.platform;

// Il costo di un'impression è bid_micros/1000, quindi NON sempre intero: testiamo
// anche costi dispari, dove il floor/resto è l'unica cosa che salva la somma-zero.
const COSTS = [0, 1, 2, 3, 5, 7, 9, 999, 5_000, 1_000_001, 12_345];

test("impression: le tre gambe sommano SEMPRE a zero (doppia entrata)", () => {
  for (const costMicros of COSTS) {
    const s = splitSpend({ refType: "impression", costMicros });
    assert.equal(total(s), 0, `cost=${costMicros}`);
  }
});

test("impression: utente = floor(cost*USER_SHARE), piattaforma = RESTO (non un secondo floor)", () => {
  for (const costMicros of COSTS) {
    const s = splitSpend({ refType: "impression", costMicros });
    assert.equal(s.user, Math.floor(costMicros * economics.USER_SHARE), `user cost=${costMicros}`);
    assert.equal(s.platform, costMicros - s.user, `platform=resto cost=${costMicros}`);
    // su costo dispari l'utente prende il floor: il centesimo di troppo resta alla piattaforma
    assert.ok(s.user <= s.platform, `utente <= piattaforma cost=${costMicros}`);
  }
});

test("impression: l'inserzionista è addebitato dell'intero costo", () => {
  const s = splitSpend({ refType: "impression", costMicros: 5_000 });
  assert.equal(s.advertiser, -5_000);
});

test("click: l'utente NON guadagna nulla, tutto alla piattaforma, somma-zero", () => {
  for (const costMicros of [0, 1, 250_000, 1_000_001]) {
    const s = splitSpend({ refType: "click", costMicros });
    assert.equal(s.user, 0, `user=0 cost=${costMicros}`);
    assert.equal(s.platform, costMicros, `platform=tutto cost=${costMicros}`);
    assert.equal(s.advertiser, -costMicros, `advertiser=-tutto cost=${costMicros}`);
    assert.equal(total(s), 0, `somma-zero cost=${costMicros}`);
  }
});

test("lo split rispetta lo USER_SHARE configurato (50%)", () => {
  assert.equal(economics.USER_SHARE, 0.5);
  const s = splitSpend({ refType: "impression", costMicros: 5_000 });
  assert.equal(s.user, 2_500);
  assert.equal(s.platform, 2_500);
});

test("costPerImpression: il bid è un CPM (prezzo/1000), arrotondato per difetto", () => {
  assert.equal(costPerImpression(5_000_000), 5_000); // $5 CPM -> 5.000 micros/impression
  assert.equal(costPerImpression(1_000_000), 1_000); // $1 CPM minimo
  assert.equal(costPerImpression(1_999), 1); // floor, non arrotonda per eccesso
  assert.equal(costPerImpression(999), 0);
});

test("costPerClick: bid × CLICK_MULT / 1000, arrotondato per difetto", () => {
  assert.equal(economics.CLICK_MULT, 50);
  assert.equal(costPerClick(5_000_000), 250_000); // bid $5 -> un click costa $0.25
  assert.equal(costPerClick(1_000_000), 50_000);
});

test("il costo che alimenta lo split è SEMPRE intero (niente frazioni di micro)", () => {
  for (const bid of [1_000_000, 1_999, 3_333_333, 5_000_000]) {
    assert.ok(Number.isInteger(costPerImpression(bid)), `imp bid=${bid}`);
    assert.ok(Number.isInteger(costPerClick(bid)), `click bid=${bid}`);
  }
});
