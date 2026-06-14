export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || "mysql://root:waitingads@127.0.0.1:3308/waitingads",
  sessionKeys: (process.env.SESSION_KEYS || "dev-only-change-me").split(","),
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:3000",
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  devLogin: process.env.DEV_LOGIN === "true",
  isProduction: process.env.NODE_ENV === "production",
};

// Economia della piattaforma (vedi ANALISI.md §5–6)
export const economics = {
  MIN_BID_MICROS:     1_000_000,      // $1 CPM minimo
  CLICK_MULT:         50,             // un click costa bid × 50 / 1000
  USER_SHARE:         0.5,            // 50% all'utente
  MIN_CAMPAIGN_FUND_MICROS: 20_000_000, // budget minimo per lanciare una campagna $20
  MIN_PAYOUT_MICROS:  10_000_000,     // soglia payout $10
};

// Anti-fraud e session guard (vedi ANALISI.md §4)
export const guard = {
  MIN_VIEW_MS:          5_000,        // visibilità minima per impression valida
  AD_REQUEST_TTL_MS:    10 * 60_000,  // oltre, l'ad_request scade
  HEARTBEAT_TTL_MS:     90_000,       // sessione viva se heartbeat < 90s fa
  EARNING_COOLDOWN_MS:  60_000,       // cooldown cambio sessione earning
  // Nessun cap di CONTEGGIO orario/giornaliero: chi usa Claude tutto il giorno
  // deve poter vedere tutte le ads possibili (sono view reali pagate dagli
  // inserzionisti). Il ritmo resta limitato dai cap FISICI (MIN_VIEW + cooldown)
  // e dal budget delle campagne; l'esposizione sui soldi dal cap economico sotto.
  CLICK_DAY_CAP:        3,            // click pagati max / giorno / utente
  EARN_HOUR_CAP_MICROS: 20_000_000,   // guadagno max $20 / ora / utente
  EARN_DAY_CAP_MICROS:  200_000_000,  // guadagno max $200 / giorno / utente
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
