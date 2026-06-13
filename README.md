# WaitingAds

> AI thinks. Get paid for waiting.

Marketplace pubblicitario per i tempi di attesa di Claude Code. Analisi completa in [ANALISI.md](ANALISI.md).

## Struttura

| Cartella | Cosa | Stack |
|---|---|---|
| `backend/` | API: auth, asta continua, session guard, ledger, payout | Node.js + Koa + mysql2 (raw query, no ORM) |
| `extension/` | Estensione VS Code lato consumer: mostra le ads durante il thinking | TypeScript + esbuild |
| `frontend/` | Landing + dashboard inserzionista + dashboard utente | Next.js 14 + Tailwind |
| `schema/` | Schema MySQL | SQL puro |

## Avvio in sviluppo

```bash
# 1. Database (MySQL 8 su porta 3308)
docker compose up -d

# 2. Backend (porta 4100)
cd backend
cp .env.example .env
npm install
npm run migrate
npm run dev

# 3. Frontend (porta 3000)
cd frontend
npm install
npm run dev

# 4. Estensione VS Code
cd extension
npm install && npm run build
# poi F5 da VS Code (Run Extension), o vsce package per il .vsix
```

## Provare il core loop

1. Apri `http://localhost:3000/login`, accedi (dev mode: solo email).
2. Da `/advertiser`: nel blocco "Lancia una campagna" imposta bid + budget e premi "Lancia — paga $X". Il budget è il pagamento della campagna stessa.
3. Nell'Extension Development Host: `WaitingAds: Connect account`, poi `WaitingAds: Install Claude Code hooks`.
4. Usa Claude Code: a ogni prompt l'estensione sostituisce il loading con l'ad nella **status bar** (spinner nativo + testo) e nella **statusline** di Claude; dopo 5s di visibilità l'impression viene accreditata (50% a te). Thinking lunghi ruotano più ads (1 ogni ~5s).
5. Guadagni e payout su `http://localhost:3000/dashboard`.

## Regole economiche (vedi ANALISI.md §5–7)

- Asta **continua per-impression**, niente blocchi: P(vittoria) ∝ bid. First-price: paghi `bid/1000` a impression.
- Click: l'inserzionista paga `bid × 50 / 1000`; **i click non pagano l'utente** (zero incentivo al click fraud).
- **Budget per-campagna**: ogni campagna è finanziata da sé (crea = paga). `residuo = funded − spesa`; a residuo zero esce dall'asta. Top-up con "+ Budget".
- Payout utenti: 50% delle impression, soglia minima $20.
- Tutti gli importi nel DB sono in **micros** (1$ = 1.000.000).

## Sicurezza

- Auth a sessione cookie (koa-session, httpOnly, signed) — niente JWT.
- Session guard: una sola sessione earning per utente, heartbeat 30s, cooldown 60s.
- Impression valida solo se: sessione earning viva, ≥5s di visibilità, cap 60/ora e 300/giorno, guadagno max $5/giorno.
- Ownership check su ogni risorsa; nessun dato di altri utenti esposto; dev login disattivato in produzione.
