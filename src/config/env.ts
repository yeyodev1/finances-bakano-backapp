import dotenv from "dotenv";

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 8200),
  dbUri: process.env.DB_URI || "",
  jwtSecret: process.env.JWT_SECRET || "finances_default_secret",
  timezone: process.env.TZ || "America/Guayaquil",

  resend: {
    apiKey: process.env.RESEND_API_KEY || "",
    from: process.env.RESEND_FROM_EMAIL || "Bakano Finanzas <financiero@bakano.ec>",
    replyTo: process.env.RESEND_REPLY_TO || "financiero@bakano.ec",
    defaultTo: process.env.RESEND_DEFAULT_TO || "dreyes@bakano.ec",
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
    apiKey: process.env.CLOUDINARY_API_KEY || "",
    apiSecret: process.env.CLOUDINARY_API_SECRET || "",
  },

  metrics: {
    apiUrl: (process.env.METRICS_API_URL || "http://localhost:8100/api").replace(/\/+$/, ""),
    apiKey: process.env.FINANCE_API_KEY || "",
  },

  /** Banco (Mercury). Integración de SOLO LECTURA: nunca se emiten POST/PATCH/DELETE. */
  mercury: {
    apiUrl: (process.env.MERCURY_API_URL || "https://api.mercury.com/api/v1").replace(/\/+$/, ""),
    /** Debe incluir el prefijo `secret-token:` tal como lo entrega Mercury. */
    token: process.env.MERCURY_API_TOKEN || "",
    timeout: Number(process.env.MERCURY_TIMEOUT_MS || 20000),
    /** Segundos de caché en memoria para no golpear la API en cada refresh del frontend. */
    cacheTtl: Number(process.env.MERCURY_CACHE_TTL || 60),
  },

  appUrl: process.env.APP_URL || "http://localhost:5173",
  cronSecret: process.env.CRON_SECRET || "",
  cronEnabled: process.env.CRON_ENABLED !== "false",

  seedAdmin: {
    email: process.env.SEED_ADMIN_EMAIL || "dreyes@bakano.ec",
    password: process.env.SEED_ADMIN_PASSWORD || "",
    name: process.env.SEED_ADMIN_NAME || "Diego Reyes",
  },

  brand: {
    /** Logo oscuro: los correos y la app se ven sobre fondo blanco. */
    logoUrl:
      "https://res.cloudinary.com/bihiitae/image/upload/bakano-finanzas/brand/logo-bakano-dark.png",
    /** Logo blanco original de bakano.ec, para fondos oscuros. */
    logoLightUrl:
      "https://res.cloudinary.com/bihiitae/image/upload/bakano-finanzas/brand/logo-bakano-light.png",
    iconUrl:
      "https://res.cloudinary.com/bihiitae/image/upload/bakano-finanzas/brand/logo-bakano-icon.png",
    appName: "Bakano Finanzas",
    primary: "#e6285c",
    primaryDark: "#191423",
    primaryLight: "#f5f3ef",
    secondary: "#85529c",
    green: "#3bb77e",
    warning: "#f59e0b",
    error: "#ef4444",
  },
};
