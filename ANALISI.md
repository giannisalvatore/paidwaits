# Paidwaits — Analisi di prodotto

> **AI thinks. Get paid for waiting.**
> Trasformiamo i tempi di attesa di Claude Code in inventory pubblicitaria. Il 50% del ricavo va a chi guarda.

> ⚠️ **NOTA DI STATO (2026-06-14).** Questo documento descrive il prodotto *target* e in più punti **diverge dal codice reale**. Per lo stato verificato, i finding e la roadmap vedi [docs/AUDIT-E-ROADMAP.md](docs/AUDIT-E-ROADMAP.md). In sintesi, dopo l'audit: il modello reale è **a blocchi** (non l'asta continua descritta in §5 — decisione: si tengono i blocchi, questa sezione va riscritta); il DB è **MySQL** (non Postgres); i **pagamenti Stripe non esistono ancora** (solo TODO); il brand è **Paidwaits**.

---

## 1. Il concept in una frase

Quando Claude Code "pensa", il developer aspetta guardando uno spinner. Quell'attenzione vale soldi: l'estensione VS Code sostituisce lo spinner con una pubblicità, l'inserzionista paga per impression/click, e il ricavo delle impression viene diviso 50/50 tra piattaforma e developer (i click li paga solo l'inserzionista, vedi §6).

**Perché funziona:**
- L'audience è iper-qualificata: solo developer che usano attivamente AI tools (CPM altissimo per advertiser dev-tool: Vercel, Linear, Ramp, Sentry...).
- L'attenzione è garantita: durante il thinking l'utente è fermo, davanti allo schermo, in attesa. Non è un banner ignorabile in una sidebar.
- L'utente è incentivato a non bloccare le ads: viene pagato.

---

## 2. Architettura — i 3 componenti

```
┌─────────────────────┐         ┌──────────────────────┐         ┌─────────────────────┐
│  ESTENSIONE VS CODE │  ◄────► │       BACKEND        │  ◄────► │   FRONTEND (web)    │
│  (lato consumer)    │   API   │  (cuore del sistema) │         │                     │
├─────────────────────┤         ├──────────────────────┤         ├─────────────────────┤
│ · rileva thinking   │         │ · auth (Google)      │         │ · landing page ✓    │
│ · mostra l'ad       │         │ · engine d'asta      │         │ · dashboard         │
│ · traccia view/click│         │ · session guard      │         │   inserzionista     │
│ · heartbeat sessione│         │ · anti-bot           │         │ · dashboard utente  │
│                     │         │ · contabilità/ledger │         │   (guadagni+payout) │
│                     │         │ · payout (Stripe)    │         │                     │
└─────────────────────┘         └──────────────────────┘         └─────────────────────┘
```

### 2.1 Estensione VS Code (consumer)

Il pezzo che "consuma" le pubblicità. Flusso:

1. **Login con Google** (unico metodo, vedi anti-bot §4). L'estensione riceve un token di sessione.
2. **Rilevamento del thinking**: l'estensione sa quando Claude Code sta lavorando. Per l'MVP l'approccio più affidabile sono gli **hook di Claude Code** (eventi `PreToolUse` / `Stop` ecc. configurati in `settings.json` durante l'onboarding) che notificano l'estensione su inizio/fine elaborazione. Alternativa/fallback: watch dei transcript `~/.claude/projects/*.jsonl`.
3. **Richiesta ad**: a inizio thinking l'estensione chiama `GET /ad/next` → il backend risolve l'asta e ritorna la creative (testo + URL).
4. **Render — non invadente, nativo.** L'ad non è un pannello: **sostituisce il loading originale di Claude mantenendone lo stile**. Due superfici:
   - **VS Code**: la **status bar** con lo spinner nativo (`$(loading~spin)`) + il testo dell'ad — al posto del normale indicatore di attesa. Cliccabile (traccia il click e apre l'URL).
   - **Claude Code CLI/TUI**: la **statusline nativa** (configurata in `settings.json`), che durante il thinking mostra la riga sponsorizzata accanto al loading, nello stesso stile testuale del terminale.
   Le ads ruotano a **slot da ~5 secondi**: ogni slot completato conta come impression valida e si passa all'ad successiva (un thinking da 15s mostra 3 ads). Lo slot finale parziale (<5s) non conta.
5. **Tracking**: `POST /impression` (con proof di sessione attiva) e `POST /click` se l'utente clicca.

### 2.2 Backend (MVP)

API stateless + MySQL 8 (mysql2, raw query, no ORM). Moduli:

| Modulo | Responsabilità |
|---|---|
| **Auth** | Google OAuth, emissione token, un account = un'identità Google |
| **Ad engine** | Asta in real-time per ogni richiesta di ad (§5) |
| **Session guard** | Max 1 sessione pagante per utente (§4) |
| **Ledger** | Ogni impression/click genera due scritture: addebito inserzionista, accredito 50% utente. Contabilità a doppia entrata, fonte di verità per tutto |
| **Billing** | Ricariche inserzionisti via Stripe (§7) |
| **Payout** | Pagamenti agli utenti via Stripe Connect / PayPal (§6) |
| **Anti-fraud** | Validazione impression, rate limit, scoring (§4) |

### 2.3 Frontend (MVP)

- **Landing** — già in sviluppo ([hero.tsx](frontend/components/hero.tsx)).
- **Dashboard inserzionista** — minimal: crea campagna (nome, creative, URL, bid, budget), vedi spesa/impression/click in tempo reale, bottone ricarica. Una pagina, una tabella, un form.
- **Dashboard utente** — guadagni (oggi / mese / totale), impression servite, saldo, bottone payout.

---

## 3. Flusso end-to-end di una pubblicità

```
Inserzionista                Backend                    Developer (estensione)
     │                          │                              │
     │ crea campagna + ricarica │                              │
     │─────────────────────────►│                              │
     │                          │       Claude inizia a pensare│
     │                          │◄────────── GET /ad/next ─────│
     │                          │ asta: sceglie il vincitore   │
     │                          │─────────── creative ────────►│
     │                          │                              │ mostra ad ≥5s
     │                          │◄──────── POST /impression ───│
     │                          │ valida (session guard,       │
     │                          │ anti-bot) poi ledger:        │
     │   −$bid/1000             │ addebita inserzionista       │
     │                          │ accredita utente (50%)       │  +50%
     │                          │                              │
     │                          │◄──────── POST /click ────────│ (se clicca)
     │   −$bid×CLICK_MULT/1000  │ addebito extra click         │  +0 (i click non
     │                          │ (100% alla piattaforma)      │   pagano l'utente)
```

---

## 4. Anti-bot e session guard — ogni utente è reale

Questo è il moat. Se il traffico è sporco, gli inserzionisti scappano. Se è certificato, possiamo chiedere CPM premium.

### Identità: solo Google OAuth
- Nessuna registrazione email/password: **un account = un'identità Google reale**. Alza enormemente il costo di creare account fake rispetto a email usa-e-getta.
- Opzionale (post-MVP): segnali di anzianità dell'account Google, o richiesta di GitHub OAuth aggiuntivo per uno "score" developer.

### Session guard: una sola sessione pagata per utente
Regola: **un utente guadagna al massimo da 1 sessione di pubblicità alla volta**, anche se ha Claude Code aperto su 5 finestre/macchine.

Meccanica:
- Ogni estensione attiva manda un **heartbeat** (ogni ~30s) con `user_id + device_id + session_id`.
- Il backend mantiene **una sola sessione "earning"** per `user_id`: la prima attiva. Le altre ricevono comunque le ads ma con flag `non-earning` (oppure non le ricevono affatto — scelta di prodotto: io le mostrerei comunque, l'inserzionista non paga e l'utente non guadagna, ma sotto soglie sospette).
- L'impression è accreditata **solo se arriva dalla sessione earning attiva al momento della view**. Cambio di sessione earning ha un cooldown (es. 60s) per impedire il ping-pong.

### Validazione impression
Un'impression conta solo se:
1. arriva da una sessione earning con heartbeat vivo;
2. il thinking era reale (l'hook di Claude Code ha segnalato inizio elaborazione — la richiesta ad senza evento di thinking corrispondente è scartata);
3. è durata ≥ 5 secondi (timestamp lato server tra `GET /ad/next` e `POST /impression`);
4. passa i rate limit: cap di impression/ora e impression/giorno per utente (un umano non genera 1.000 thinking l'ora);
5. il pattern temporale è plausibile (i thinking reali hanno durate variabili; intervalli perfettamente regolari = bot).

### Difese aggiuntive
- **Cap giornaliero di guadagno per utente**: limita il danno di qualsiasi frode riuscita e rende l'attacco economicamente poco interessante.
- **Payout con review**: i payout sotto soglia minima e i pattern anomali vengono trattenuti per revisione (§6) — la frode si combatte anche pagando lentamente i casi sospetti.
- **Click fraud**: l'utente **non guadagna dai click** (§6), quindi non ha alcun incentivo a cliccare per soldi. A protezione dell'inserzionista restano comunque: cap di click pagati per utente/giorno (es. 3) e dedupe per campagna (stesso utente che riclicca la stessa campagna non riaddebita).

---

## 5. Engine d'asta — continuo, senza blocchi

**Niente blocchi da 1.000 view** (il modello di Kickbacks). L'asta è **continua e per-impression**: ogni volta che un'estensione chiede un'ad, il backend la assegna in tempo reale tra le campagne attive.

### Regole (volutamente semplici)

- Ogni campagna ha: `bid` (= CPM, prezzo per 1.000 impression, minimo $1), `budget residuo`, `creative`.
- **Il bid alto fa spendere di più, anche se è già profittevole stare in cima**: prezzo *first-price* — paghi sempre il tuo bid, `bid/1000` per impression. Niente second-price: più semplice da capire, più revenue, ed è esattamente l'incentivo voluto (vuoi più volume? alzi il bid e paghi di più su *ogni* impression).
- **Assegnazione: rotazione pesata sul bid.** Ad ogni richiesta, la campagna è estratta con probabilità proporzionale al bid:

  ```
  P(campagna i vince l'impression) = bid_i / Σ bid_attivi
  ```

  Esempio con i bid attuali della demo: Ramp $25, Linear $3.8, Vercel $2.5 → Ramp prende ~80% delle impression, Linear ~12%, Vercel ~8%.

  Perché pesata e non "il top bid prende tutto": (a) il vincitore assoluto svuoterebbe il budget in fretta e poi l'inventory resterebbe scoperta; (b) le campagne piccole hanno comunque delivery, quindi più inserzionisti restano nel marketplace; (c) l'incentivo a rilanciare resta fortissimo — più bid = quota di traffico direttamente proporzionale.
- **Click**: costa all'inserzionista `bid × CLICK_MULT / 1000` (es. `CLICK_MULT = 50` → con bid $5 un click costa $0.25). Il click è l'evento di valore vero e fa spendere proporzionalmente di più chi sta in cima. Il ricavo dei click va interamente alla piattaforma (§6).
- **Budget**: la campagna esce dall'asta quando il budget residuo non copre la prossima impression. Niente pacing nel MVP (post-MVP: spesa massima/giorno).

### Cosa NON c'è (di proposito)
Niente targeting, niente blocchi, niente queue, niente frequency capping per campagna nel MVP. Un'unica leva per l'inserzionista: **il bid**. La dashboard mostra il bid più alto attuale, così la competizione è trasparente (il "bid market" già prototipato in [bid-market.tsx](frontend/components/bid-market.tsx) diventa la UI reale di questo meccanismo).

---

## 6. Economics e payout utenti

### Revenue split
- **Impression**: 50% all'utente che ha visto, 50% alla piattaforma.
- **Click**: lo paga solo l'inserzionista (bid × 50 / 1000), **100% alla piattaforma — l'utente non guadagna nulla dai click**. Scelta deliberata: se il click non paga l'utente, sparisce ogni incentivo al click fraud lato utente; chi clicca lo fa solo per interesse reale, e il click venduto all'inserzionista è genuino.

Il 50% sulle impression resta il numero della landing ed è ciò che fa installare l'estensione.

### Ordini di grandezza per l'utente
Con bid medio $5 CPM → l'utente guadagna $2.50 per 1.000 impression. Un developer heavy-user di Claude Code fa ~50–150 thinking/giorno, e i thinking lunghi generano più slot (1 impression ogni ~5s di attesa) → **$5–20/mese a bid medi, fino al cap giornaliero**. Non uno stipendio: un "Claude Code che si ripaga l'abbonamento", che è esattamente il pitch.

### Payout
- **Saldo** accumulato nel ledger, visibile in dashboard in tempo reale.
- **Soglia minima di payout**: $20 (riduce fee di transazione e dà tempo all'anti-fraud).
- **Metodo MVP**: PayPal payouts (onboarding più semplice, globale) — Stripe Connect come evoluzione.
- **Cadenza**: richiesta manuale dell'utente dalla dashboard ("Cash out"), elaborata in batch settimanale con finestra di review anti-fraud di 7 giorni sulle impression più recenti (le impression maturano prima di essere prelevabili).

---

## 7. Pagamenti inserzionisti

Modello **budget per-campagna** (niente saldo condiviso da ricaricare a parte):

1. L'inserzionista crea la campagna inserendo nome, creative, URL, bid e **budget**.
2. **Il budget è il pagamento**: il bottone "Lancia — paga $X" finanzia direttamente quella campagna (in produzione: Stripe Checkout; la campagna diventa `live` solo alla conferma del pagamento).
3. Ogni campagna ha il suo budget: `residuo = budget finanziato − spesa`. Quando il residuo non copre la prossima impression, la campagna esce dall'asta automaticamente (stato "esaurita").
4. **"+ Budget"** su una campagna esistente la ricarica (altro pagamento).

Perché per-campagna e non a saldo condiviso: un solo passaggio per andare live (crea = paga), budget isolato per campagna (nessun travaso involontario tra campagne), e nessuna pagina "Add funds" separata. Vantaggi del prepagato restano: zero rischio di credito, cash flow anticipato.

---

## 8. Dashboard

### Inserzionista (professionale, una pagina)
- **Stat cards** in alto: Campaigns (totali), Serving (live con budget residuo), Views (impression), Spend (spesa totale), CTR.
- **Grafici** (area chart, ultimi 14 giorni): impression, click, spesa giornaliera.
- **Blocco "Lancia una campagna"** in evidenza: form (nome, URL, ad line, bid, budget) con pannello di riepilogo a lato (pagamento, impression stimate, bid CPM) e bottone "Lancia — paga $X". Crea e finanzia in un colpo.
- **Tabella campagne**: nome + creative, bid modificabile live (l'unica leva, immediata), stato (live/paused/esaurita), impression, click, spesa, **budget residuo**, azioni "+ Budget" e pausa/avvio.
- Niente bid market in dashboard: è materiale di marketing, vive solo in landing.

### Utente (minimal, una pagina)
- **Guadagno**: oggi / ultimo mese / totale; saldo disponibile.
- **Statistiche**: impression viste, sessione earning attiva (quale device sta guadagnando ora — trasparenza sul session guard). I click non generano guadagno utente, quindi non sono una metrica utente.
- **Bottone "Cash out"** (attivo sopra soglia) + storico payout.

---

## 9. Differenziazione da Kickbacks (kickbacks.ai)

Kickbacks ha validato il concept ("Get paid for waiting", spinner ads, 50% revshare, $2.50/1.000 all'utente). Stesso spazio, esecuzione diversa:

| | **Kickbacks** | **Noi** |
|---|---|---|
| **Modello di vendita** | Blocchi rigidi da 1.000 impression × 5s, min $1/blocco | **Asta continua per-impression**, budget libero, nessun blocco |
| **Cosa compra il bid** | Posizione in coda → *velocità di consegna* del blocco | **Quota di traffico in tempo reale**, proporzionale e trasparente |
| **Prezzo** | Fisso per blocco una volta comprato | First-price continuo: alzi/abbassi il bid live, effetto immediato |
| **Superficie** | Generalista: VS Code, CLI, terminal, varie integrazioni | **Verticale su Claude Code**: integrazione profonda via hooks, detection del thinking affidabile, UX nativa |
| **Qualità traffico** | Non dichiarata in dettaglio | **Traffico certificato**: solo Google OAuth, 1 sessione pagante/utente, impression legate a thinking reali verificati via hook — vendibile come "verified human developers" |
| **Trasparenza utente** | Stima mensile | Dashboard real-time, visibilità su quale device guadagna, saldo in maturazione |

In sintesi il posizionamento è: **il marketplace serio e verificato per l'attesa di Claude Code**, contro un modello a blocchi più rudimentale e generalista. La qualità certificata del traffico è ciò che giustifica CPM più alti — ed è ciò che il modello a blocchi di Kickbacks non comunica.

---

## 10. Rischi e questioni aperte

1. **Dipendenza da Claude Code / Anthropic**: l'estensione vive su una piattaforma altrui. Se Anthropic integra ads proprie o blocca le estensioni che modificano la UX, il prodotto va ripensato. Mitigazione: il backend (asta, ledger, anti-fraud) è agnostico alla superficie — Cursor, Codex CLI, ecc. sono espansioni naturali.
4. **Frode residua**: nessun sistema è perfetto; cap giornalieri + maturazione payout limitano il danno massimo per account a pochi dollari.
5. **Privacy**: l'estensione NON deve leggere il contenuto delle conversazioni con Claude — solo gli eventi inizio/fine thinking. Da dichiarare esplicitamente: è un punto di fiducia, non solo di compliance. Tanto l'estensione sara open source, riguardo quello che viene inviato.

---

## 11. Roadmap MVP

| Fase | Cosa | Done quando |
|---|---|---|
| **1. Core loop** | Estensione (login Google, detect thinking via hooks, render ad, tracking) + backend (auth, asta pesata, ledger) | Un'ad reale viene mostrata durante un thinking reale e l'addebito/accredito appare nel ledger |
| **2. Lato inserzionista** | Dashboard campagne + Stripe add funds + pausa automatica a saldo zero | Un inserzionista esterno crea e finanzia una campagna da solo |
| **3. Lato utente** | Dashboard guadagni + session guard completo + cash out PayPal | Un utente riceve un payout reale |
| **4. Hardening** | Rate limit, cap giornalieri, maturazione impression, review payout | I controlli anti-fraud di §4 sono tutti attivi |

---

*Documento di analisi — giugno 2026. Il prototipo del bid market in [frontend/lib/marketplace.ts](frontend/lib/marketplace.ts) va aggiornato: rimuovere `BLOCK_VIEWS` (modello a blocchi abbandonato a favore dell'asta continua, §5).*
