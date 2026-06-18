# kickbacks — Linea condivisa: go-to-market, money-loop e collaborazione

> **Stato: PROPOSTA per allineamento — NON una decisione presa.** È la linea che propongo;
> servono il tuo OK e le tue correzioni, Gianni. _"Se condividiamo la linea, proseguiamo."_
> **È solo documentazione.** Nessun codice, nessun vincolo: un punto di partenza per decidere insieme.
>
> Data: 2026-06-14 · Autori della linea tecnica: io + la lente "Agile Technical Practices"
> (walking skeleton, Theory of Constraints, bounded context, Conway).

## 0. Perché questo documento

Abbiamo **due implementazioni dello stesso prodotto** ("kickbacks / WaitingAds": pubblicità
mostrate dentro una CLI/estensione AI *mentre "pensa"*, con il **50% del ricavo all'umano che
guarda**). Se le lasciamo divergere, per la **Legge di Conway** due repo diventano due sistemi
che si allontanano. Questo doc propone **una linea condivisa** e una **divisione di proprietà
chiara**, così lavoriamo in parallelo senza pestarci i piedi.

## 1. Dove siamo — onesto, senza tifo

Due asset **complementari**, non in competizione:

| | **paidwaits (Gianni)** | **kickbacks-backend (io)** |
|---|---|---|
| Cos'è | verticale completo e **demoabile**: landing + dashboard advertiser + dashboard user + estensione + backend (ledger, guard anti-frode, auction ranking-by-bid) | **money-core backend** contract-first contro il **client open** kickbacks.ai, su Convex, testato (atdd_pure) |
| Stack | Node/Koa + MySQL + Next.js | Convex + TypeScript |
| Forza | **cliccabile end-to-end OGGI** → perfetto per investitori e primi advertiser | fedeltà al **contratto del client open** (= backend drop-in per la distribuzione esistente); idempotenza del ledger **provata** (100× concorrenza); ledger append-only in micros; gate anti-frode |
| Limite | MVP rapido senza test; sul **proprio** contratto/estensione (fuori dalla distribuzione del client open); **niente rotaie di pagamento reali** (Stripe in/out, KYC) | **nessuna superficie umana** ancora (niente UI); pre-domanda |

**Sintesi: il tuo verticale valida il mercato; il mio backend porta i soldi in sicurezza.**
Pezzi diversi dello stesso puzzle. (Nota onesta: le **rotaie di pagamento reali mancano in
entrambi** — è la parte più seria ancora da fare, insieme.)

## 2. L'obiettivo (il nostro nord)

**Primo advertiser pagante + primo payout reale** — il **loop di denaro completo**:
advertiser paga → impression servita → watcher pagato (split 50/50). È il traguardo più
ambizioso perché tocca *entrambi* i bordi più rischiosi (soldi IN e soldi OUT).

## 3. La linea proposta (3 punti da decidere insieme)

### 3.1 Modello di collaborazione → **proposta: Modello 1**

- **Gianni** → le **superfici web** (landing, dashboard advertiser, dashboard user): riusi i
  tuoi frontend Next.js **già fatti**, ma ripuntati sul **contratto** del backend (non più su
  MySQL).
- **Io** → il **money-core backend** + il **contratto** + una **portal-API** per le dashboard.
- **Il contratto è l'unico accoppiamento.** Lavoriamo in parallelo **senza approvarci i PR a
  vicenda** (bounded context = isolamento + parallelizzazione). Niente "PR grosso e aspetta":
  integriamo contro il contratto.

_Alternative sul tavolo: **Modello 2** = monorepo unico diviso per cartelle/context (PR piccoli
e frequenti, una pipeline sola); **Modello 3** = restiamo separati e condividiamo solo idee._

### 3.2 Il "money steel-thread" — la fetta verticale più sottile che chiude il loop

Non completiamo ogni pezzo orizzontalmente; facciamo la **fetta più sottile che porta UN
dollaro reale per tutto il giro**, poi ingrossiamo. Un advertiser, una campagna, un watcher,
importi minuscoli.

0. **demo-skeleton** — prova la cucitura tecnica + alza la spine (in corso)
1. **ledger** — credito idempotente, 50/50 micros, append-only
2. **auth** — device-flow + identità (non si paga un anonimo)
3. **metrics-ingest + gate minimo** — soglia server-timed + cooldown + cap giornaliero
4. **serving autenticato** — la campagna (ranking-by-bid banale con un solo bid)
5. **earnings-read** — il watcher vede il saldo
6. **soldi IN** — Stripe Checkout → credit balance in micros *(qui entra la tua dashboard
   advertiser, puntata sulla portal-API)*
7. **soldi OUT** — **primo payout a mano** dal saldo del ledger _(do things that don't scale)_

### 3.3 La decisione sul rischio (C2) — da prendere insieme

"Primo payout reale" fa scattare un nostro paletto: **Convex non basta come unico registro di
fondi** (manca UNIQUE dichiarativo / PITR / riconciliazione SQL) → servirebbe **Postgres come
registro-di-record prima del primo credito reale**.

- **(A) C2 stretto** — Postgres-of-record dentro il primo loop. Più sicuro, più lavoro upfront.
- **(B) Eccezione-pilota delimitata** *(mia raccomandazione)* — per **UN** pilot controllato
  (advertiser che conosciamo, watcher = noi/un amico, importi minuscoli, riconciliazione a mano)
  accettiamo Convex **consapevolmente**, con un **paletto scritto**: Postgres-of-record
  **obbligatorio** prima di qualunque partecipante reale/sconosciuto.

In entrambi i casi: **automatizziamo i soldi IN; il primo payout lo facciamo a mano**; rimandiamo
Stripe Connect + KYC + pipeline di riconciliazione a quando c'è **volume**.

## 4. Cosa NON cambia (i paletti del denaro)

- **micros** ovunque (1 USD = 1.000.000); formato stringa-USD solo al bordo di visualizzazione
- **ledger append-only** — le correzioni sono **voci di storno**, mai modifiche/cancellazioni
- **idempotenza** su `(client_id, nonce)`; webhook Stripe idempotenti sull'event-id
- **anti-frode davanti al credito** (validate → credit → persist), non dentro al ledger
- **ACL attorno a Stripe** (sia charges in entrata sia Connect in uscita)

## 5. Domande aperte per te, Gianni

1. **Modello 1 / 2 / 3?**
2. **C2: A o B?**
3. Le tue **dashboard** sono ripuntabili sul contratto del client open con sforzo ragionevole?
4. **I click pagano l'utente?** (tu nel tuo ANALISI: 100% piattaforma — concordo, salvo motivi)
5. **Cadenza heartbeat / cooldown earning-switch / soglie cap** (tu avevi ~30s / ~60s)
6. **Giurisdizione KYC/tax** per i payout (US first? EU?)

## 6. Se condividiamo la linea — come proseguiamo

1. **Lock** di Modello + C2 in una decisione scritta (ADR/WD).
2. Io espongo la **portal-API** (il contratto per le dashboard); tu ci punti il **frontend advertiser**.
3. Costruiamo il **money steel-thread** fetta per fetta (sezione 3.2).
4. **Primo pilot**: noi come advertiser + watcher, importi minuscoli, payout a mano → primo
   loop di denaro reale validato end-to-end.

---

> **Contesto tecnico (nel mio repo `kickbacks-backend`, posso condividerlo):**
> `CONTRACT.md` (il contratto `/v1` verificato contro i parser del client open) ·
> `docs/reference/money-edges-context-map.md` (mappa dei bounded context money-in / money-out) ·
> `docs/adr/ADR-001` (ledger fasato Convex→Postgres dietro una porta) ·
> `docs/PROJECT-OVERVIEW.md` (quadro completo).
