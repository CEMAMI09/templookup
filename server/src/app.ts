import path from "node:path";
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import helmet from "helmet";
import type { AppConfig } from "./config.ts";
import { AppError, publicError } from "./errors.ts";
import { MockCrm } from "./coto/mock.ts";
import { LiveCrm } from "./coto/live.ts";
import type { Crm } from "./coto/types.ts";
import { authRouter } from "./routes/auth.ts";
import { contactsRouter } from "./routes/contacts.ts";

export function createApp(config: AppConfig, crm: Crm = config.crmMode === "live" ? new LiveCrm(config.coto) : new MockCrm()) {
  const app = express();
  if (config.trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use((_req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "blob:", "data:"],
          mediaSrc: ["'self'", "blob:"],
          workerSrc: ["'self'", "blob:", "https://cdn.jsdelivr.net"],
          scriptSrc: ["'self'", "'wasm-unsafe-eval'", "'unsafe-eval'", "blob:", "https://cdn.jsdelivr.net"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'", "blob:", "https://cdn.jsdelivr.net"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(
    session({
      name: "aaoptom.sid",
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.nodeEnv === "production",
        maxAge: 12 * 60 * 60 * 1000,
      },
    }),
  );

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRouter(config, crm));
  app.use("/api/contacts", contactsRouter(config, crm));
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "That action is not available." } });
  });

  if (config.nodeEnv === "production") {
    const clientDir = path.resolve(process.cwd(), "dist/client");
    app.use(express.static(clientDir, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(clientDir, "index.html"));
    });
  }

  app.use(((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      if (error.status === 499) return;
      if (error.status >= 500 || error.code === "CRM_AUTH" || error.code === "CRM_FORBIDDEN") {
        console.error(
          JSON.stringify({
            level: "error",
            code: error.code,
            status: error.status,
            detail: redact(error.logDetail ?? error.message, config.coto.token),
          }),
        );
      }
      res.status(error.status).json(publicError(error));
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: { code: "VALIDATION", message: "The request could not be read." } });
      return;
    }
    console.error(
      JSON.stringify({
        level: "error",
        code: "UNHANDLED",
        detail: redact(error instanceof Error ? error.name : "unknown", config.coto.token),
      }),
    );
    res.status(500).json({ error: { code: "CRM_UNAVAILABLE", message: "Something went wrong. Try again." } });
  }) as ErrorRequestHandler);

  return app;
}

function redact(value: string, token: string): string {
  const withoutBearer = value.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  return token ? withoutBearer.split(token).join("[redacted]") : withoutBearer;
}
