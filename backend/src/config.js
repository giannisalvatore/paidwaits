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
};
