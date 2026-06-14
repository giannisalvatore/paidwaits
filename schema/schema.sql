-- WaitingAds — schema DB (MySQL 8)
-- Tutti gli importi sono in MICROS (1$ = 1_000_000) per gestire frazioni di centesimo:
-- un'impression a bid $5 CPM costa 5_000 micros.

CREATE TABLE IF NOT EXISTS users (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  google_sub  VARCHAR(64) UNIQUE,          -- subject Google OAuth (NULL solo per utenti dev-mode)
  email       VARCHAR(255) UNIQUE NOT NULL,
  name        VARCHAR(255),
  created_at  BIGINT NOT NULL              -- epoch ms
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Sessioni dell'estensione. Una sola sessione "earning" per utente alla volta (session guard).
CREATE TABLE IF NOT EXISTS sessions (
  id              CHAR(36) PRIMARY KEY,    -- uuid
  user_id         BIGINT UNSIGNED NOT NULL,
  device_id       VARCHAR(128) NOT NULL,
  earning         TINYINT(1) NOT NULL DEFAULT 0,
  last_heartbeat  BIGINT NOT NULL,
  created_at      BIGINT NOT NULL,
  KEY idx_sessions_user (user_id, last_heartbeat),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Traccia l'ultimo passaggio di sessione earning per il cooldown anti ping-pong.
CREATE TABLE IF NOT EXISTS earning_switches (
  user_id      BIGINT UNSIGNED PRIMARY KEY,
  session_id   CHAR(36) NOT NULL,
  switched_at  BIGINT NOT NULL,
  CONSTRAINT fk_switches_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS campaigns (
  id             BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  advertiser_id  BIGINT UNSIGNED NOT NULL,
  name           VARCHAR(255) NOT NULL,
  creative_text  TEXT NOT NULL,
  image_url      VARCHAR(2048),
  target_url     VARCHAR(2048) NOT NULL,
  bid_micros     BIGINT NOT NULL,          -- prezzo per BLOCK (= per 1.000 views da 5s) in micros, min 1_000_000 ($1); è anche il rank in coda
  blocks         BIGINT NOT NULL DEFAULT 0,-- block acquistati; 1 block = 1.000 views GARANTITE da consegnare
  funded_micros  BIGINT NOT NULL DEFAULT 0,-- pagato = somma(block × bid al momento dell'acquisto)
  status         ENUM('live','paused') NOT NULL DEFAULT 'live',
  paid           TINYINT(1) NOT NULL DEFAULT 1,    -- 0 = draft in attesa di pagamento (esclusa dal serving)
  stripe_session_id VARCHAR(255),                  -- sessione Stripe Checkout (acquisizione pubblica)
  created_at     BIGINT NOT NULL,
  KEY idx_campaigns_adv (advertiser_id),
  CONSTRAINT fk_campaigns_adv FOREIGN KEY (advertiser_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ogni GET /ad/next crea un ad_request: serve a validare l'impression (≥5s, una sola conversione).
CREATE TABLE IF NOT EXISTS ad_requests (
  id           CHAR(36) PRIMARY KEY,        -- uuid
  user_id      BIGINT UNSIGNED NOT NULL,
  session_id   CHAR(36) NOT NULL,
  campaign_id  BIGINT UNSIGNED NOT NULL,
  earning      TINYINT(1) NOT NULL,         -- la sessione era earning al momento della richiesta
  status       ENUM('pending','converted','expired') NOT NULL DEFAULT 'pending',
  created_at   BIGINT NOT NULL,
  KEY idx_ad_requests_user (user_id, created_at),
  CONSTRAINT fk_adreq_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_adreq_session FOREIGN KEY (session_id) REFERENCES sessions(id),
  CONSTRAINT fk_adreq_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS impressions (
  id                 BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  ad_request_id      CHAR(36) NOT NULL UNIQUE,
  campaign_id        BIGINT UNSIGNED NOT NULL,
  user_id            BIGINT UNSIGNED NOT NULL,
  session_id         CHAR(36) NOT NULL,
  cost_micros        BIGINT NOT NULL,       -- addebito inserzionista (bid/1000)
  user_share_micros  BIGINT NOT NULL,       -- 50%
  created_at         BIGINT NOT NULL,
  KEY idx_impressions_user (user_id, created_at),
  KEY idx_impressions_campaign (campaign_id),
  CONSTRAINT fk_imp_adreq FOREIGN KEY (ad_request_id) REFERENCES ad_requests(id),
  CONSTRAINT fk_imp_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT fk_imp_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS clicks (
  id                 BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  impression_id      BIGINT UNSIGNED NOT NULL UNIQUE,
  campaign_id        BIGINT UNSIGNED NOT NULL,
  user_id            BIGINT UNSIGNED NOT NULL,
  cost_micros        BIGINT NOT NULL,       -- bid × CLICK_MULT / 1000; 0 se il click non è pagato (cap/dedupe)
  user_share_micros  BIGINT NOT NULL,       -- sempre 0: i click non pagano l'utente (100% piattaforma)
  created_at         BIGINT NOT NULL,
  KEY idx_clicks_user (user_id, created_at),
  KEY idx_clicks_user_campaign (user_id, campaign_id),
  CONSTRAINT fk_click_imp FOREIGN KEY (impression_id) REFERENCES impressions(id),
  CONSTRAINT fk_click_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT fk_click_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ledger a doppia entrata: fonte di verità per saldi e guadagni.
-- account_type: 'advertiser' | 'user' | 'platform' (account_id = 0 per platform).
-- La somma degli amount di ogni ref (impression/click) è 0.
CREATE TABLE IF NOT EXISTS ledger (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  account_type  ENUM('advertiser','user','platform') NOT NULL,
  account_id    BIGINT UNSIGNED NOT NULL,
  amount_micros BIGINT NOT NULL,            -- positivo = accredito, negativo = addebito
  ref_type      ENUM('deposit','impression','click','payout') NOT NULL,
  ref_id        VARCHAR(64) NOT NULL,
  created_at    BIGINT NOT NULL,
  KEY idx_ledger_account (account_type, account_id),
  KEY idx_ledger_ref (ref_type, ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payouts (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  amount_micros BIGINT NOT NULL,
  status        ENUM('requested','processing','paid','rejected') NOT NULL DEFAULT 'requested',
  requested_at  BIGINT NOT NULL,
  processed_at  BIGINT,
  KEY idx_payouts_user (user_id),
  CONSTRAINT fk_payouts_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Flag di piattaforma (key/value): killswitch globale, versione ToS, ecc.
-- Killswitch: flag_key='killswitch', flag_value JSON {"killed":bool,"reason":"...","scope":"all"}.
-- Si attiva via questa tabella (admin/DB) o via env KILLSWITCH=true (emergenza).
CREATE TABLE IF NOT EXISTS platform_flags (
  flag_key    VARCHAR(64) PRIMARY KEY,
  flag_value  TEXT,
  updated_at  BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Dedup degli eventi billabili (idempotenza): ogni impression/click porta un
-- event_uuid generato dal client. La PK impedisce di contare due volte lo stesso
-- evento (retry/doppio invio). INSERT vince una sola volta.
CREATE TABLE IF NOT EXISTS billing_events (
  event_uuid  CHAR(36) PRIMARY KEY,
  kind        ENUM('impression','click') NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  ref_id      VARCHAR(64) NOT NULL,
  created_at  BIGINT NOT NULL,
  KEY idx_billing_events_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Telemetria di salute dell'estensione (best-effort, non PII delle conversazioni).
CREATE TABLE IF NOT EXISTS telemetry (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED,
  event       VARCHAR(64) NOT NULL,
  cc_version  VARCHAR(64),
  detail      VARCHAR(512),
  created_at  BIGINT NOT NULL,
  KEY idx_telemetry_event (event, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Thinking sessions: traccia ogni thinking per anti-bot + analytics.
-- PreToolUse: started_at. Stop/timeout: finished_at.
-- Valido se: finished_at IS NULL AND expires_at > NOW().
CREATE TABLE IF NOT EXISTS thinking_sessions (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  session_id  CHAR(36) NOT NULL,
  started_at  BIGINT NOT NULL,
  finished_at BIGINT,
  expires_at  BIGINT NOT NULL,
  created_at  BIGINT NOT NULL,
  KEY idx_thinking_user (user_id, started_at),
  KEY idx_thinking_active (user_id, finished_at, expires_at),
  CONSTRAINT fk_thinking_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Impression maturation: le impression rimangono "pending" per 7gg prima di diventare "mature" (prelevabili).
-- status: 'pending' (0-7gg) → 'mature' (dopo 7gg) → 'payout_requested' (in un payout)
CREATE TABLE IF NOT EXISTS impression_status (
  id            BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  impression_id BIGINT UNSIGNED NOT NULL UNIQUE,
  status        ENUM('pending','mature','payout_requested') DEFAULT 'pending',
  updated_at    BIGINT NOT NULL,
  KEY idx_status (status, updated_at),
  CONSTRAINT fk_imp_status FOREIGN KEY (impression_id) REFERENCES impressions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Account flags: fraud risk, review status (manual review prima del payout).
CREATE TABLE IF NOT EXISTS account_flags (
  user_id        BIGINT UNSIGNED PRIMARY KEY,
  fraud_risk     ENUM('low','medium','high') DEFAULT 'low',
  flagged_reason TEXT,
  flagged_at     BIGINT,
  reviewed_at    BIGINT,
  reviewed_by    VARCHAR(255),
  final_verdict  ENUM('approved','rejected','suspended'),
  CONSTRAINT fk_flag_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Magic link per login passwordless inserzionisti (signup/signin + post-pagamento).
CREATE TABLE IF NOT EXISTS magic_link_tokens (
  token       CHAR(64) PRIMARY KEY,
  email       VARCHAR(255) NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  expires_at  BIGINT NOT NULL,
  used_at     BIGINT,
  created_at  BIGINT NOT NULL,
  KEY idx_magic_email (email, created_at),
  CONSTRAINT fk_magic_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
