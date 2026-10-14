import path from "node:path";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { AppError, errorHandler, requestLog, type Logger } from "./http";
import type { Repo } from "./repo/types";
import type { AiClient } from "./services/ai";
import type { AuthService, VerifiedUser } from "./services/auth";
import type { GoogleApi } from "./services/google";
import { authRoutes } from "./routes/auth";
import { scheduleRoutes } from "./routes/schedule";
import { recoveryRoutes } from "./routes/recovery";
import { communicationRoutes } from "./routes/communication";
import {
  googleCallback,
  googleLoginRoutes,
  googleRoutes,
} from "./routes/google";

export type Deps = {
  auth: AuthService;
  repoFor: (userId: string, accessToken: string) => Repo;
  ai: AiClient;
  google: GoogleApi;
  /** Encrypts stored Google tokens; null when Google is not configured. */
  tokenKey: Buffer | null;
  stateKey: Buffer;
  returnUrlPrefixes: string[];
  now: () => Date;
  log: Logger;
  trustProxy?: boolean;
};
export type RequestContext = { user: VerifiedUser; token: string; repo: Repo };
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      ctx?: RequestContext;
    }
  }
}

export function context(req: Request): RequestContext {
  if (!req.ctx) throw new AppError("UNAUTHORIZED", "Sign in to continue.");
  return req.ctx;
}

/** Accepts only valid Supabase access tokens; the user id comes from the token. */
export function authenticate(deps: Deps) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = req.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) throw new AppError("UNAUTHORIZED", "Sign in to continue.");
    const user = await deps.auth.verify(token);
    if (!user)
      throw new AppError(
        "UNAUTHORIZED",
        "Your session has expired. Please sign in again.",
      );
    req.ctx = { user, token, repo: deps.repoFor(user.id, token) };
    next();
  };
}

/**
 * Runs a write once per Idempotency-Key. A retry with the same key gets the
 * stored response; failures are not stored, so they can be retried.
 */
export async function idempotent(
  repo: Repo,
  scope: string,
  key: string,
  run: () => Promise<{ status: number; body: unknown }>,
): Promise<{ status: number; body: unknown }> {
  const state = await repo.beginIdempotent(scope, key);
  if (state.state === "done") return { status: state.status, body: state.body };
  if (state.state === "pending")
    throw new AppError(
      "REQUEST_IN_PROGRESS",
      "This request is already being processed. Please wait a moment.",
    );
  try {
    const result = await run();
    await repo.finishIdempotent(scope, key, result.status, result.body);
    return result;
  } catch (error) {
    await repo.abandonIdempotent(scope, key).catch(() => undefined);
    throw error;
  }
}

// The API answers JSON and the public pages are static HTML with no scripts,
// so the policy can be strict: same-origin assets plus Google Fonts only.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  // Browsers ignore this over plain http (local development), so it only
  // takes effect behind Render's https.
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  next();
}

export function createApp(deps: Deps) {
  const app = express();
  app.disable("x-powered-by");
  if (deps.trustProxy) app.set("trust proxy", 1);
  app.use(requestLog(deps.log));
  app.use(securityHeaders);
  app.use(express.json({ limit: "100kb" }));
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      ai: deps.ai.available,
      google: deps.google.configured && !!deps.tokenKey,
    });
  });
  app.use("/api/auth/google", googleLoginRoutes(deps));
  app.use("/api/auth", authRoutes(deps));
  // Google redirects the browser here, without the app's access token.
  app.get("/api/google/callback", googleCallback(deps));
  const api = express.Router();
  api.use(authenticate(deps));
  api.use(scheduleRoutes(deps));
  api.use(recoveryRoutes(deps));
  api.use(communicationRoutes(deps));
  api.use(googleRoutes(deps));
  app.use("/api", api);
  // The public site: home page, privacy policy and terms, which Google's
  // OAuth consent screen links to. Served after /api so an endpoint can
  // never be shadowed by a file. "/privacy" works without the extension.
  app.use(
    express.static(path.resolve(__dirname, "../public"), {
      extensions: ["html"],
      maxAge: "1h",
      redirect: false,
    }),
  );
  app.use(() => {
    throw new AppError("NOT_FOUND", "That endpoint does not exist.");
  });
  app.use(errorHandler(deps.log));
  return app;
}
