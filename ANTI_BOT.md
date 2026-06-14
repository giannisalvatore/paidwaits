# WaitingAds — Anti-Bot Protection Layers

## 🎯 Overview

Protezione multi-layer contro bot che replicano l'API in cascata (thinking-start → GET /ad/next → POST /impression).

---

## 🛡️ Layer 1: Thinking validation (Endpoint protection)

**Cosa:** POST /thinking-start crea una sessione di thinking che valida GET /ad/next e POST /impression.

**Come funziona:**
1. Estensione riceve hook `PreToolUse` da Claude Code (scatta a OGNI tool del turno)
2. Estensione chiama `POST /me/thinking-start {session_id}`
3. Backend: se c'è già un thinking attivo per la sessione ne **estende** la validità a T+120s (stesso turno → stessa riga); altrimenti crea una nuova riga (nuovo turno)
4. `GET /ad/next` verifica che thinking sia attivo (richiede thinking_sessions valida)
5. `POST /impression` verifica che thinking sia ANCORA attivo
6. Se thinking è scaduto: `POST /impression` → "thinking_expired"

> La finestra si **estende a ogni tool**, quindi un turno lungo resta sempre servibile.
> Non c'è più alcun lock che blocca i thinking successivi: il ritmo è limitato solo
> dai cap fisici (5s view + 4s cooldown) e dal cap economico giornaliero.

**Protegge da:**
- Bot che chiama GET /ad/next senza thinking-start
- Bot che chiama POST /impression fuori dalla finestra di thinking
- Bot che riusa token vecchi dopo che il thinking finisce

**Schema:**
```sql
CREATE TABLE thinking_sessions (
  id, user_id, session_id, started_at, finished_at, expires_at, created_at
  -- Attivo se: finished_at IS NULL AND expires_at > NOW()
  -- Salvato per sempre per debugging/analytics
);
```

**Endpoints nuovi:**
- `POST /me/thinking-start` — notifica thinking started
- `POST /me/thinking-stop` — notifica thinking stopped

---

## 🧠 Layer 2: Pattern detection (Behavioral fingerprinting)

**Cosa:** Rileva pattern bot-like e flagga account sospetti.

**Pattern rilevati:**
1. **Intervalli regolari**: Se tutti gli intervalli tra impression sono identici (stdDev < 500ms) → bot
2. **High volume**: > 300 impression in 24h da stesso device → sospetto
3. **Multi-account same IP**: Non rilevato automaticamente (va fatto a livello di infra)

**Come funziona:**
1. Query all'ora/giorno: "Seleziona utenti con pattern sospetto"
2. Flagga account in `account_flags` con `fraud_risk = 'high'`
3. Payout li rifiuta finché non sono approved manualmente

**Schema:**
```sql
CREATE TABLE account_flags (
  user_id, fraud_risk ENUM('low','medium','high'), 
  flagged_reason, flagged_at, reviewed_at, reviewed_by, 
  final_verdict ENUM('approved','rejected','suspended')
);
```

**Endpoint admin:**
- `POST /admin/detect-bots` — scansiona tutti gli utenti e flagga pattern sospetti
- `GET /admin/flagged-accounts` — lista account flaggati in attesa di review
- `POST /admin/approve-account` — approva account dopo review manuale

---

## ⏰ Layer 3: Impression maturation (Payout delay)

**Cosa:** Impression rimangono "pending" per 7 giorni prima di diventare prelevabili.

**Come funziona:**
1. Ogni impression crea una riga in `impression_status` con status='pending'
2. Payout richiede che impression siano `created_at < NOW() - 7 giorni`
3. Human team usa Layer 2 per fare review dei 7 giorni
4. Se account approvato → impression diventa 'mature' e prelevabile
5. Se account sospetto → impression rimane bloccata, account rifiutato

**Schema:**
```sql
CREATE TABLE impression_status (
  impression_id, status ENUM('pending','mature','payout_requested'), updated_at
);
```

**Logica payout:**
```js
// Si preleva SOLO la quota delle impression mature (>7gg) ancora 'pending'.
// I guadagni freschi NON sono prelevabili finché non maturano (finestra di review).
const matureRows = await query(
  "SELECT imp.id, imp.user_share_micros FROM impressions imp " +
  "JOIN impression_status stat ON stat.impression_id = imp.id " +
  "WHERE imp.user_id = ? AND imp.created_at < NOW()-7gg AND stat.status='pending' FOR UPDATE"
);
if (matureRows.length === 0) throw "no_mature_impressions";
const matureMicros = sum(matureRows.user_share_micros);
if (matureMicros < MIN_PAYOUT) throw "below_minimum_payout";
// → paga matureMicros, marca quelle impression 'payout_requested', ledger -matureMicros

// Controlla account flags (prima della transazione)
if (flag.final_verdict === 'suspended') throw "account_suspended";
if (flag.final_verdict === null && flag.fraud_risk === 'high') throw "account_under_review";
```

> ⚠️ **Importante:** il payout NON svuota l'intero saldo. Paga solo la somma di
> `user_share_micros` delle impression che hanno superato i 7 giorni. Il resto del
> saldo (guadagni recenti) resta visibile ma non prelevabile finché non matura.

---

## 👥 Layer 4: Manual review (Human verification)

**Cosa:** Team manuale approva/rifiuta account flaggati prima che possono fare payout.

**Flusso:**
1. Account accumula impression, bot detection le flagga in 24-48h
2. Team vede nella dashboard (endpoint `/admin/flagged-accounts`)
3. Team esamina:
   - Pattern impression (timing, device, IP)
   - Behavior (100+ impression primo giorno = sospetto)
   - Account age, Google account signals
4. Team chiama `POST /admin/approve-account` o rifiuta payout manualmente
5. Account approvato → impression diventano 'mature' → payout OK

---

## 🔧 Setup e testing

### 1. Database: Applica schema
```bash
docker-compose exec -T mysql mysql -u root -pwaitingads waitingads < schema/schema.sql
```

### 2. Estensione: Hook configuration
L'estensione riceve hook via loopback da Claude Code:
```json
// settings.json di Claude Code
{
  "hooks": {
    "PreToolUse": "127.0.0.1:48100/thinking-start",
    "Stop": "127.0.0.1:48100/thinking-stop"
  }
}
```

Quando Claude batte PreToolUse:
- Claude notifica loopback con POST /thinking-start
- Loopback passa a backend: POST /me/thinking-start
- Backend registra thinking_sessions
- GET /ad/next ora accetta la richiesta

### 3. Test manuale: Flusso legittimo
```bash
# 1. Login e sessione
curl -X POST http://localhost:4100/auth/dev -d '{"email":"test@example.com"}' -c cookies.txt

curl -X POST http://localhost:4100/session/start \
  -b cookies.txt \
  -d '{"device_id":"test-device"}' \
  -H 'content-type: application/json'
# Ritorna: {"session_id":"uuid"}

# 2. Thinking start
curl -X POST http://localhost:4100/me/thinking-start \
  -b cookies.txt \
  -d '{"session_id":"uuid"}' \
  -H 'content-type: application/json'
# Ritorna: {"ok":true}

# 3. Get ad (ora OK perché thinking è attivo)
curl http://localhost:4100/ad/next?session_id=uuid \
  -b cookies.txt
# Ritorna: {"ad_request_id":"...", "campaign": {...}}

# 4. Aspetta 5 secondi (MIN_VIEW_MS)
sleep 5

# 5. Post impression
curl -X POST http://localhost:4100/impression \
  -b cookies.txt \
  -d '{"ad_request_id":"..."}' \
  -H 'content-type: application/json'
# Ritorna: {"counted":true,"earned_micros":2500}

# 6. Thinking stop
curl -X POST http://localhost:4100/me/thinking-stop \
  -b cookies.txt \
  -d '{"session_id":"uuid"}' \
  -H 'content-type: application/json'
```

### 4. Test bot: Flusso rifiutato
```bash
# Bot tenta GET /ad/next senza thinking-start
curl http://localhost:4100/ad/next?session_id=uuid \
  -b cookies.txt
# Ritorna: 409 Conflict "no_active_thinking"

# Bot tenta POST /impression fuori dalla finestra
# (Dopo 120s dal thinking-start)
sleep 121
curl -X POST http://localhost:4100/impression \
  -b cookies.txt \
  -d '{"ad_request_id":"..."}' \
  -H 'content-type: application/json'
# Ritorna: {"counted":false,"reason":"thinking_expired"}
```

### 5. Admin: Pattern detection e review
```bash
# Scansiona tutti gli utenti per pattern bot-like
curl -X POST http://localhost:4100/admin/detect-bots \
  -H 'authorization: Bearer ADMIN_TOKEN'  # TODO: Aggiungere auth
# Ritorna: {"flagged": [...], "count": N}

# Lista account flaggati
curl http://localhost:4100/admin/flagged-accounts \
  -H 'authorization: Bearer ADMIN_TOKEN'
# Ritorna: {"flagged": [{user_id, fraud_risk, reason, flagged_at}, ...]}

# Ispeziona account sospetto (thinking + impression pattern)
curl http://localhost:4100/admin/inspect-account/123 \
  -H 'authorization: Bearer ADMIN_TOKEN'
# Ritorna:
# {
#   "impressions_24h": 250,
#   "thinking_sessions_24h": 50,
#   "interval_analysis": {
#     "mean_ms": 5100,
#     "stddev_ms": 120,      # < 500 = HIGH RISK
#     "suspect": "HIGH: Regular intervals detected (likely bot)"
#   },
#   "thinking_durations": [...]
# }

# Approva account dopo review
curl -X POST http://localhost:4100/admin/approve-account \
  -H 'authorization: Bearer ADMIN_TOKEN' \
  -d '{"user_id":123,"reviewed_by":"john@company.com"}' \
  -H 'content-type: application/json'
# Ritorna: {"ok":true, "user_id":123, "verdict":"approved"}

# Debug: mostra thinking history (lato user, non admin)
curl http://localhost:4100/me/thinking-history \
  -b cookies.txt
# Ritorna:
# {
#   "total_thinkings_7d": 150,
#   "active_today": 3,
#   "thinkings": [
#     { "id": 1, "started_at": ..., "finished_at": ..., "duration_seconds": 12 }
#   ]
# }
```

---

## 📊 Cost of attacks

| Scenario | Layer 1 | Layer 2 | Layer 3 | Layer 4 | Result |
|----------|---------|---------|---------|---------|--------|
| **Single bot with fake API knowledge** | ❌ Blocked | — | — | — | Gets 409 on `/ad/next` |
| **Bot replicates sequence correctly** | ✅ Passes | ⚠️ Flagged if 100+ imp/day | ⚠️ 7-day wait | ❌ Manual review | Payout blocked |
| **Bot spreads across 10 accounts** | ✅ Passes | ⚠️ All 10 flagged | ⚠️ 70-day wait total | ❌ All rejected | $0 payout, wasted effort |
| **Attacker with hook integration** | ✅ Passes | ✅ Passes if smart | ✅ Passes | ❌ Behavioral review | Caught eventually |

**Key insight:** Layer 1 is cheap to implement but bypassable. Layers 2-4 are the real cost: accumulate evidence over 7 days, then human review.

---

## ⚙️ TODO

- [ ] Aggiungere autenticazione admin agli endpoint `/admin/*`
- [ ] Implementare scheduled job per detect-bots (es. ogni 24h)
- [ ] Dashboard admin per review account flaggati
- [ ] Webhook notification quando account viene flaggato (Slack/email)
- [ ] Rate limiting per IP oltre ai rate limit per-user
- [ ] Device fingerprinting (TLS unique ID, User-Agent signature)
- [ ] Integration test per il flusso completo bot detection
