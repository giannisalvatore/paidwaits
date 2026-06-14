const DEFAULT_SESSION_KEY = "dev-only-change-me";
const DEFAULT_DB_CREDENTIAL = "root:waitingads";

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || "mysql://root:waitingads@127.0.0.1:3308/waitingads",
  sessionKeys: (process.env.SESSION_KEYS || DEFAULT_SESSION_KEY).split(","),
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:3000",
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  devLogin: process.env.DEV_LOGIN === "true",
  isProduction: process.env.NODE_ENV === "production",
};

// Guard di produzione: fail-CLOSED sui secret di default. I cookie di sessione
// sono FIRMATI (non cifrati) con sessionKeys: con la chiave di default chiunque
// può forgiare un cookie valido e impersonare qualsiasi utente. Per i soldi il
// fallimento sicuro è fermarsi, non proseguire con un default insicuro.
if (config.isProduction) {
  const fatal = [];
  if (!process.env.SESSION_KEYS || process.env.SESSION_KEYS.split(",").includes(DEFAULT_SESSION_KEY)) {
    fatal.push("SESSION_KEYS è assente o usa il default 'dev-only-change-me' (account takeover via cookie forgiato)");
  }
  if (!process.env.DATABASE_URL || config.databaseUrl.includes(DEFAULT_DB_CREDENTIAL)) {
    fatal.push("DATABASE_URL è assente o usa la credenziale di default 'root:waitingads'");
  }
  if (fatal.length) {
    throw new Error(`[config] avvio in produzione bloccato:\n  - ${fatal.join("\n  - ")}`);
  }
  if (!config.googleClientId) {
    console.warn("[config] ATTENZIONE: GOOGLE_CLIENT_ID vuoto in produzione — POST /auth/google risponderà 503 e nessuno potrà loggarsi.");
  }
}

// Economia della piattaforma (vedi ANALISI.md §5–6)
export const economics = {
  MIN_BID_MICROS:     1_000_000,      // $1 CPM minimo
  CLICK_MULT:         50,             // un click costa bid × 50 / 1000
  USER_SHARE:         0.5,            // 50% all'utente
  MIN_CAMPAIGN_FUND_MICROS: 20_000_000, // budget minimo per lanciare una campagna $20
  MIN_PAYOUT_MICROS:  20_000_000,     // soglia payout $20
};

// Anti-fraud e session guard (vedi ANALISI.md §4)
export const guard = {
  MIN_VIEW_MS:          5_000,        // visibilità minima per impression valida
  AD_REQUEST_TTL_MS:    10 * 60_000,  // oltre, l'ad_request scade
  HEARTBEAT_TTL_MS:     90_000,       // sessione viva se heartbeat < 90s fa
  EARNING_COOLDOWN_MS:  60_000,       // cooldown cambio sessione earning
  IMP_HOUR_CAP:         60,           // impression pagate max / ora / utente
  IMP_DAY_CAP:          300,          // impression pagate max / giorno / utente
  CLICK_DAY_CAP:        3,            // click pagati max / giorno / utente
  EARN_DAY_CAP_MICROS:  5_000_000,    // guadagno max $5 / giorno / utente
  // Cooldown anti-burst tra due impression PAGATE dello stesso utente. La cadenza
  // legittima (slot ~6s) sta abbondantemente sopra, quindi non genera falsi
  // positivi; un client che martella più veloce viene throttlato. (Nota: la
  // pattern-detection comportamentale "intervalli regolari = bot" di ANALISI §4.5
  // richiede telemetria sui thinking reali ed è rimandata: la nostra cadenza a
  // slot renderebbe regolari anche le impression vere.)
  IMP_COOLDOWN_MS:      4_000,
};

// Modello a BLOCK (stile kickbacks): i block comprano VOLUME (views garantite),
// il bid compra POSIZIONE IN CODA (consegna prima), non più views.
// Una "view" è una visualizzazione da 5 secondi dell'ad durante il thinking.
export const auction = {
  VIEWS_PER_BLOCK: 1_000, // 1 block = 1.000 views (da 5s) garantite
  // Anti-ripetizione per utente: una campagna appena servita a QUESTO utente viene
  // spinta in fondo per questa finestra, così non la rivede due volte di fila
  // (mentre la coda globale resta ordinata per bid). Tiebreak, non cambia il volume.
  REPEAT_COOLDOWN_MS: 45_000,
};

// Killswitch d'emergenza via ambiente (oltre al flag in platform_flags).
// KILLSWITCH=true ferma TUTTO il serving al riavvio del backend, senza DB.
export const ops = {
  envKill: process.env.KILLSWITCH === "true",
  envKillReason: process.env.KILLSWITCH_REASON || "env killswitch",
};
