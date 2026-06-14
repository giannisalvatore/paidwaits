# Paidwaits / WaitingAds — Audit end-to-end + Roadmap Agile

> Audit evidence-based del 2026-06-14 (Vlad / uppify agency + Gianni Salvatore).
> Ogni affermazione è verificata sul **codice reale**, non sui documenti. Riferimenti come `file:line`.
> Roadmap nella voce dei tre autori della skill `agile-technical-practices`:
> **Pedro Moreira Santos, Marco Consolaro, Alessandro Di Gioia** — *Agile Technical Practices Distilled*.

---

## Decisioni dei fondatori (2026-06-14)

1. **Modello di vendita → si tengono i BLOCCHI.** Il modello a blocchi (già costruito e funzionante) resta; si **allinea la doc** al codice. Conseguenza: lo Sprint 6 NON è più "costruisci l'asta continua" ma "riconcilia `ANALISI.md` al modello a blocchi + riposiziona il pitch vs Kickbacks". Il differenziatore "asta continua" va sostituito (es. qualità del traffico verificato, integrazione profonda, trasparenza).
2. **Avvio → in parallelo.** Le fondamenta (test + CI + sicurezza) partono subito lato dev; in parallelo i fondatori preparano l'account Stripe + creative. Si converge sullo Sprint 3 (Stripe).
3. **Brand → Paidwaits.** Si allinea tutto a *Paidwaits*: aggiornare `ANALISI.md`/`README.md` e fixare il typo del marker `/* PAIDWADS-START */` nell'estensione.

**Già fatto in questo avvio (fondamenta, in parallelo):**
- ✅ **Sicurezza** — guard di produzione fail-closed su `SESSION_KEYS`/`DATABASE_URL` ([config.js](../backend/src/config.js)); dedup billing ora **fail-closed** (tabella mancante → rollback, niente doppia fatturazione) ([serving.js](../backend/src/services/serving.js)).
- ✅ **Kata Zero** — estratta `splitSpend` pura + factory `costPerImpression`/`costPerClick` ([money.js](../backend/src/services/money.js)); **ucciso il `/1000` magico** su 4 punti (auction.js + ads.js) e **unificata la quota utente duplicata** (la tabella `impressions` e il ledger ora non possono divergere).
- ✅ **Test + CI** — 8 test-invariante sul denaro ([money.test.js](../backend/test/money.test.js), `npm test` → 8/8) + GitHub Action ([ci.yml](../.github/workflows/ci.yml)).

**Prossimo (step coordinato client+server):** rendere `event_uuid` obbligatorio su `/impression` e `/click` — richiede prima di verificare che TUTTE le vie client (inclusa la CLI) lo inviino, per non rompere il billing.

---

## 0. TL;DR

Il prodotto ha **ossatura ingegneristica vera e di buona qualità** (ledger a doppia entrata, session guard, anti-frode cablato, ownership ovunque, estensione multi-target più avanzata della doc). Ma:

- **Il loop dei soldi è aperto a entrambe le estremità**: il finanziamento campagne **non fa pagare nessuno** (Stripe è solo un TODO) e il payout **non eroga nulla** (solo richiesta). Il centro (ledger) è reale → "i conti tornano" ma su **moneta del Monopoli**.
- **Zero test automatici** su un ledger di soldi. Nessuna CI.
- **La doc mente sul meccanismo centrale**: `ANALISI.md` vende un'**asta continua pesata** che il codice **non implementa** (il codice è il **modello a BLOCCHI** di Kickbacks).
- **In produzione nessuno può loggarsi**: Google OAuth non configurato + l'estensione usa solo il dev-login (disattivato in prod).
- **Buco di sicurezza critico**: secret di firma sessione con default hardcoded `dev-only-change-me` → forge di cookie = account takeover.

---

## 1. Verifica delle affermazioni di Gianni

| Affermazione di Gianni | Verdetto | Sintesi (prova) |
|---|---|---|
| "**Idealmente advertiser-ready**" | 🟡 **Vero solo a metà** | Le UI/flussi advertiser sono **realmente cablati** al backend (crea/finanzia/edita/pausa campagna → DB reale + ledger reale + serving reale + stats reali). MA: il "paga $X" non addebita nulla, la campagna va `live` senza pagamento, in prod manca il login, e il modello servito è a blocchi (non l'asta del pitch). "Advertiser-ready" come *flussi costruiti* = sì; come *advertiser veri che pagano in prod oggi* = no. |
| "**Il payout lo faremo manualmente**" | 🟡 **Parzialmente vero** | La **richiesta** payout è reale e robusta ([me.js:42-66](../backend/src/routes/me.js#L42) — transazione, `SELECT … FOR UPDATE`, soglia $20, riga `payouts` + addebito ledger). Ma il "manuale" è fattibile **solo editando MySQL a mano**: **zero tooling** — nessun `UPDATE payouts` da nessuna parte, nessun admin, `processed_at` mai scritto dal codice, e **il path "rejected" non riaccredita** il saldo trattenuto (bug: payout rifiutato = saldo utente distrutto). |
| "**C'è solo da configurare Stripe**" | 🔴 **Falso** | Due falsità. (1) Non è "configurare": Stripe **non esiste** nel repo — solo un commento TODO a [campaigns.js:63](../backend/src/routes/campaigns.js#L63). Va **costruita da zero** l'integrazione Checkout + webhook (giorni di lavoro). (2) Non è l'**unico** gap: in prod manca il login (Google OAuth non configurato, dev-login 404 in prod), manca deploy/CI/hosting, i secret sono placeholder, e il modello di vendita servito diverge dal pitch. |

**Verdetto sintetico**: l'istinto di Gianni che *"il lato advertiser è la parte più completa"* è **corretto** — lo è davvero. Ma "basta Stripe" sottostima il lavoro residuo per andare live davvero.

---

## 2. Stato reale per sottosistema (cosa è vero, cosa è finto)

### ✅ Costruito e di qualità (l'ossatura)
- **Ledger a doppia entrata reale**: `recordSpend` scrive 3 gambe che sommano a zero (advertiser −cost, user +50%, platform +resto) dentro **una** transazione; `balance()` = `SUM(amount)` (single source of truth, non una colonna mutabile che deriva). [ledger.js:5-25](../backend/src/services/ledger.js#L5)
- **Anti-frode cablato** in [ads.js:102-115,198](../backend/src/routes/ads.js#L102): dwell ≥5s, cap 60/ora, 300/giorno, max $5/giorno, dedup click, click paga 0 all'utente.
- **Session guard** coerente: una sola sessione earning/utente, heartbeat TTL 90s, cooldown switch 60s. [guard.js:28-66](../backend/src/services/guard.js#L28)
- **Ownership** verificata su *ogni* query che tocca soldi (`user_id`/`advertiser_id`, spesso doppia).
- **Google OAuth backend reale** ([auth.js:28-42](../backend/src/routes/auth.js#L28)) — `verifyIdToken` audience-bound. *(Ma l'estensione client non lo usa.)*
- **Estensione molto più avanzata della doc**: registry **4-target** (claude-code, claude-cli, codex, codex-cli su VS Code + Cursor), loopback bridge che fa girare l'asta host-side (la webview non tiene mai le credenziali), killswitch server-side con offline-freeze + **self-healing reassert** quando un update di Claude Code sovrascrive il bundle. Rilevamento thinking via **DOM polling dello spinner** (non hook), che non legge mai il contenuto delle conversazioni (privacy ok).
- **CORS sicuro**, cookie sessione hardened (httpOnly/signed/sameSite/secure-in-prod), **niente SQL injection** (tutto parametrizzato).

### 🔴 Finto / mancante (il loop dei soldi + le fondamenta di processo)
- **Pagamento advertiser STUB**: `funded_micros` accreditato direttamente, `status='live'` forzato all'insert, riga ledger `deposit` di solo audit → **non addebita nessuno**. [campaigns.js:63,77-85](../backend/src/routes/campaigns.js#L63)
- **Payout = solo richiesta**: nessun codice porta un payout oltre `requested`; nessuna erogazione; rejection non rimborsa.
- **Zero test, zero CI** in tutto il monorepo (backend, frontend, extension).
- **Auth client = dev-email**: l'estensione chiama `/auth/dev` con prompt "*dev mode — Google OAuth in arrivo*" → il moat "verified human developers" **non è applicato**.
- **Pattern detection comportamentale** (§4.5) esplicitamente **rimandata**. [config.js:31-35](../backend/src/config.js#L31)

### 🚨 Sicurezza — da chiudere prima di toccare soldi veri
| Sev | Problema | Dove |
|---|---|---|
| **CRITICAL** | Default secret firma sessione `dev-only-change-me` → forge cookie → account takeover. Nessun guard in prod. | [config.js:4](../backend/src/config.js#L4) |
| **HIGH** | Funding gratis + payout open-loop: il ledger può "dovere" cash reale senza incassi. | campaigns.js / me.js |
| **HIGH** | Dedup **fail-open**: se manca la tabella `billing_events` o il client omette `event_uuid`, il billing può contare doppio. | [serving.js:66](../backend/src/services/serving.js#L66), [ads.js:128](../backend/src/routes/ads.js#L128) |
| **MEDIUM** | Default credenziale DB `root:waitingads` se `DATABASE_URL` non sovrascritto. | [config.js:3](../backend/src/config.js#L3) |
| **MEDIUM** | Proof-of-view = tempo server-elapsed, non vista confermata (client può solo aspettare 5s). | [ads.js:102](../backend/src/routes/ads.js#L102) |

---

## 3. Drift documento ↔ codice (la doc è indietro / mente)

| # | `ANALISI.md` / pitch dice | Il codice fa | Sev |
|---|---|---|---|
| 1 | **Asta continua pesata** `P(win)=bid/Σbid`, niente blocchi (IL differenziatore vs Kickbacks) | **Top-bid-wins deterministico** + cap 1.000 view/blocco. Zero randomness. È **il modello di Kickbacks**. [auction.js:42-45,23](../backend/src/services/auction.js#L42) | 🔴 |
| 2 | Budget libero | `blocks × bid`, minimo $20 | 🔴 |
| 3 | Postgres ([ANALISI.md:50](../ANALISI.md#L50)) | **MySQL 8** (docker, mysql2, DDL MySQL). README corretto, ANALISI errato | 🟡 |
| 4 | Stripe Checkout + PayPal payout | TODO / nulla | 🔴 |
| 5 | Detection via **hook** Claude Code (il moat) + comando "Install hooks" | **DOM polling**; il comando non esiste | 🔴 |
| 6 | Ad in **status bar** con spinner nativo | **Overlay DOM** sopra lo spinner della webview | 🟡 |
| 7 | Auth **solo Google** (moat anti-bot) | Estensione usa **dev-email** | 🔴 |
| 8 | Nome **WaitingAds** | Codice/brand **Paidwaits** (+ marker typo `PAIDWADS`) | 🟢 |

**Implementato-ma-non-documentato** (codice avanti alla doc): registry 4-target, loopback bridge, killswitch+reassert, ad-surface CLI (statusline OSC8 + spinnerVerbs), idempotenza `billing_events`, telemetria.

---

## 4. Il parere dei tre autori (architettura)

> *Pedro, Marco e Alessandro — una sola voce. Tutto si legge su un solo strumento: **l'Entropia di Sistema**. Coesione, Coupling, Connascence, SOLID e gli smell sono un unico ago, non pagelle separate.*

**La lettura più forte non è uno smell — è l'assenza di test.** Avete costruito un ledger di soldi a doppia entrata (tre gambe a somma zero, split 50/50, idempotenza, cap, payout con row-lock) con **ZERO test**. Senza la barra verde non avete **licenza di refactoring**, e l'entropia può solo salire. *Il feedback è tutto, e vi siete accecati sul loop che conta di più: ho appena perso i soldi di qualcuno?* L'artigianato è reale — ma una macchina ben costruita senza imbracatura si può solo **aggiungere**, mai **riplasmare**.

I 5 rischi-cardine:
1. **La correttezza del denaro è un'affermazione non falsificabile.** L'invariante "le gambe sommano a zero" e lo split `floor`/resto ([ledger.js:15-25](../backend/src/services/ledger.js#L15)) non sono protetti da nulla. Trappola latente: la conservazione regge **solo** perché `platformShare` è il resto `cost−userShare`; rendi simmetrico il `floor` e i soldi smettono di conservarsi **senza che nulla diventi rosso**.
2. **Connascence of Manual Task sul payout** — la forma peggiore e meno locale, proprio sul pagare le persone. Il saldo esce subito, l'erogazione è un umano a mano dopo; `processed_at` mai scritto dal codice; il "rejected" non rimborsa.
3. **Entrambe le estremità del tubo dei soldi sono finte, il centro è reale.** "I libri tornano" è un'affermazione su soldi del Monopoli.
4. **La specifica mente sull'algoritmo centrale** (asta) → genera difetti di Categoria-3 (incomprensione) a valle.
5. **Idempotenza fail-OPEN.** Per il denaro il fallimento sicuro è **fail-CLOSED**.

Smell secondari: **Feature Envy** ([ads.js](../backend/src/routes/ads.js) è il dominio travestito da handler HTTP); **Primitive Obsession** (micros nudi + `/1000` magico sparso); **Duplication** (`/impression` e `/click` sono la stessa pipeline due volte — ma *Rule of Three*: aspetta la terza).

**Credito dove l'ago segna basso**: ledger vero con `SUM(amount)`, gambe in una transazione, ownership ovunque, `FOR UPDATE` sul payout, session guard come state machine coerente, coupling per lo più Data/Message (il lato buono). *Le ossa sono buone — ed è esattamente per questo che i test mancanti sono la tragedia.*

---

## 5. Roadmap Agile — esaustiva, con il contributo degli autori a ogni step

> Sequenziata per principi: **prima il feedback, minimizza l'entropia, costruisci la cosa giusta.** Mappa anche sulle wave nWave già presenti nel repo (`.nwave`): DISCUSS → DESIGN → DISTILL → DELIVER.

### Sprint 0 — *Build the right thing*: riconcilia la verità & decidi
**Obiettivo:** una sola fonte di verità prima di scrivere altro codice.
- **Decisione modello di vendita**: BLOCCHI (già costruito) vs **asta continua** (matcha il pitch). *Identifica il vincolo (TOC): il collo di bottiglia non è l'asta — è il loop dei soldi aperto.*
- Riconcilia `ANALISI.md` ↔ codice (auction, Postgres→MySQL, pagamenti, detection, ad-surface). Rimuovi nota stale `BLOCK_VIEWS`.
- Decisione brand: WaitingAds vs Paidwaits (+ fix typo marker `PAIDWADS`).
> 🗣️ **Marco** (Cap.19): *Theory of Constraints* — Identifica→Sfrutta→Subordina. *EventStorming* + *Three Amigos* per fissare il modello condiviso. **Alessandro**: la specifica diventa **acceptance test eseguibile**, così non può più driftare (BDD = *poka-yoke*).

### Sprint 1 — *Kata Zero*: la barra verde sul denaro
**Obiettivo:** la licenza di refactoring che oggi non avete.
- `node:test` (zero nuove dipendenze) + **una** GitHub Action (`node --test`). Inerzia = nemico: automatizza il loop.
- 4 test-invariante sul ledger: gambe-a-zero per ogni `cost` (anche dispari); `user_share == floor(cost/2)` e platform = resto; click non accredita mai l'utente; `event_uuid` ripetuto fattura **una** volta.
- **Una** acceptance test outside-in del comportamento di punta: sessione earning viva → vista ad ≥5s → guadagna 50%, rifiutata oltre il cap $5/giorno, attraverso il confine HTTP su un DB di test.
> 🗣️ **Pedro** (Cap.3-5,10): le *3 Leggi*, **Golden Master / characterization** per blindare il legacy senza test. **Alessandro** (Cap.15): *Passes tests* è l'elemento **ZERO** del Simple Design — non c'è verde in cui restare.

### Sprint 2 — Sicurezza: fail-CLOSED prima di toccare soldi veri
- Startup guard in prod: throw se `SESSION_KEYS` è il default/assente; idem per `DATABASE_URL` con `root:waitingads`.
- Dedup **fail-closed**: `claimBillingEvent` non deve ritornare `true` su tabella assente; `event_uuid` **obbligatorio** su `/impression` e `/click`.
- Gate *money-in-before-money-out* (preludio Stripe).
> 🗣️ **Marco**: *systems thinking* — per il denaro il fallimento sicuro è fail-closed; il killswitch fail-open è giusto, il billing fail-open no. Riconosci il **trade-off**, non subirlo.

### Sprint 3 — Chiudi il loop advertiser: Stripe (build, non configure)
- Stripe Checkout su `POST /campaigns` e `/fund`; `status='live'` **solo** su webhook confermato.
- Endpoint webhook firmato, idempotente, gestione refund.
> 🗣️ **Outside-In (Cap.17)**: l'acceptance test esterno guida gli unit interni (double-loop). **DIP (Cap.13)**: un **port** `PaymentProcessor` (Stripe = un adapter) → le dipendenze puntano al dominio stabile. *Connascence of Name* al confine.

### Sprint 4 — Refactor del cuore di dominio (sotto barra verde)
- Estrai use-case **`BillImpression`** da `routes/ads.js` (cap, cost math, transazione) → da *Feature Envy* a **coesione funzionale**; l'HTTP diventa adapter sottile.
- **Money/Micros value object**: una factory `from-CPM` uccide il `/1000` magico (auction.js:19, ads.js:27/122/186); lo split `floor`/resto diventa un metodo, gli invarianti vivono **sul tipo**.
- *Rule of Three* su `/impression` vs `/click`: alla terza ripetizione, estrai.
> 🗣️ **Alessandro/Pedro (Cap.6,7,12,14)**: *Object Calisthenics* (wrappa i primitivi), *Refactoring* L1-L6 a piccoli passi sempre verde, *Connascence of Meaning → Name*.

### Sprint 5 — Chiudi il loop utente: payout state-machine + OAuth client
- **Port `PayoutProcessor`**: `requested → processing → paid/rejected` via **transizioni di codice** (anche un `ManualPayoutProcessor` lo fa, ma con test e `processed_at` scritto dal codice); **il rejected riaccredita** il ledger.
- **Google OAuth nell'estensione** (sostituisci `/auth/dev`) → attiva davvero il moat anti-bot.
> 🗣️ **Connascence (Cap.14)**: trasforma la *Manual Task* (la peggiore) in *Name/Type* — una macchina a stati con seam di riconciliazione per Stripe/PayPal.

### Sprint 6 — Riconciliazione modello a blocchi (decisione: si tengono i blocchi)
- Riscrivi `ANALISI.md` §5/§7/§9 + `README.md:50` per documentare il **modello a blocchi** come quello reale; rimuovi la vendita di "asta continua, nessun blocco".
- **Riposiziona il differenziatore vs Kickbacks** (non più "asta continua"): qualità del traffico verificato (Google OAuth + 1 sessione earning), integrazione profonda multi-target, trasparenza real-time. *Scelta di marketing dei fondatori.*
- Rimuovi la nota stale su `BLOCK_VIEWS` ([ANALISI.md:235](../ANALISI.md#L235) — simbolo inesistente).
> 🗣️ **Marco (Cap.18-19)**: la specifica è *poka-yoke* solo se dice la verità. Un acceptance test sul modello a blocchi impedisce il drift futuro.

### Sprint 7 — Proof-of-view & anti-frode hardening
- Proof-of-view più forte: nonce server-side legato al thinking, non un timer 5s aspettabile dal client.
- Implementa la pattern-detection comportamentale §4.5 (oggi rimandata).
> 🗣️ **Pedro**: i **cap** ($5/giorno) sono il vero moat che limita il blast-radius — *nominalo*, così nessuno scambia il check dei 5s per anti-frode.

### Sprint 8 — Deploy, osservabilità, doc, mutation testing
- Deploy prod (backend+frontend), CI/CD completa, gestione secret.
- **Mutation testing** feature-scoped (kill-rate ≥80%) per validare che i test prendano bug veri — nWave `nw-mutation-test`.
- Documenta i sottosistemi già costruiti ma non scritti (registry 4-target, loopback, killswitch/reassert, ad-surface CLI).
> 🗣️ **I tre (Cap.16,20)**: l'entropia bassa è lo stato finale; i 12 principi agili sono sul sistema umano. *PopcornFlow* contro l'inerzia: esperimenti rapidi.

---

## 6. Definizione di "advertiser-ready" reale (Definition of Done)

Un advertiser esterno è **veramente** servito quando, in produzione:
1. Si logga (Google OAuth configurato) ✗
2. Crea una campagna e **paga davvero** via Stripe; va `live` solo a pagamento confermato ✗
3. La campagna serve impression secondo il modello **dichiarato nel pitch** (deciso in Sprint 0) ✗/⚠️
4. Vede spesa/impression/click reali in dashboard ✓ (già cablato)
5. Il sistema regge una review di sicurezza minima (secret, fail-closed, deploy) ✗
6. Esiste una rete di test che protegge il denaro ✗

Oggi: **1 di 6 pieno** (la dashboard), il resto da Sprint 1-3 + 0.

---

*Generato dall'audit del 2026-06-14. Skill agile importata in `.claude/skills/agile-technical-practices/`.*
