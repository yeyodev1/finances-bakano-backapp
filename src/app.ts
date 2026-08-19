import express from "express";
import cors from "cors";
import http from "http";
import routerApi from "./routes";
import { dbConnect } from "./config/mongo";
import { globalErrorHandler } from "./middlewares/globalErrorHandler.middleware";
import { webhook as stripeWebhook } from "./controllers/stripe.controller";

const whitelist = [
  "http://localhost:8100",
  "http://localhost:8080",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:8101",
];

/** bakano.ec y cualquiera de sus subdominios (finances.bakano.ec, metrics.bakano.ec…). */
const BAKANO_DOMAIN = /^https:\/\/([a-z0-9-]+\.)*bakano\.ec$/i;
/** Previews de Vercel del propio proyecto. */
const VERCEL_PREVIEW = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

/** Orígenes extra por entorno, separados por coma. */
const extraOrigins = (process.env.CORS_EXTRA_ORIGINS || "")
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

export function isOriginAllowed(origin: string): boolean {
  if (whitelist.includes(origin) || extraOrigins.includes(origin)) return true;
  return BAKANO_DOMAIN.test(origin) || VERCEL_PREVIEW.test(origin);
}

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

export function createApp() {
  const app = express();

  app.use(cors(corsOptions));

  // El webhook de Stripe verifica la firma sobre el body crudo, así que se monta
  // ANTES del express.json global (que consumiría y parsearía el stream).
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    (_req, _res, next) => {
      dbConnect().then(() => next(), next);
    },
    stripeWebhook
  );

  app.use(express.json({ limit: "50mb" }));

  // En serverless la instancia puede arrancar en frío: aseguramos la conexión.
  app.use((_req, _res, next) => {
    dbConnect().then(() => next(), next);
  });

  app.get("/", (_req, res) => {
    res.send("Server is alive");
  });

  routerApi(app);

  app.use(globalErrorHandler);

  const server = http.createServer(app);

  return { app, server };
}
