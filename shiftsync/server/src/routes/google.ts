// Google for Expo on Android, in two flows that share one callback:
// - Sign in with Google: logs the student in (creating the account if new)
//   and connects Calendar and Gmail with a single consent.
// - Connect Google: links Google to an account that is already signed in.
// The app opens the consent page in an auth session; Google redirects to
// this server, which exchanges the code with the client secret and returns
// to the app's deep link with a one-time handle. Google tokens never reach
// the app and are stored encrypted. Sign-in handles also require the PKCE
// verifier only the requesting app knows, so an intercepted link is useless.
import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type {
  GoogleService,
  GoogleStatus,
  Session,
} from "../../../src/domain/contract";
import { context, type Deps } from "../app";
import { loadSchedule } from "../context";
import { AppError, fail, parse, rateLimit } from "../http";
import type { GoogleConnectionRow, Repo } from "../repo/types";
import { importCalendar } from "../services/calendar";
import {
  decryptSecret,
  encryptSecret,
  signState,
  verifyState,
} from "../services/crypto";
import { SCOPES, type TokenSet } from "../services/google";
import {
  googleCompleteSchema,
  googleConnectSchema,
  googleLoginCompleteSchema,
  googleLoginStartSchema,
} from "../schemas";

type State =
  | {
      mode: "connect";
      uid: string;
      services: GoogleService[];
      returnUrl: string;
      nonce: string;
      exp: number;
    }
  | {
      mode: "login";
      challenge: string;
      returnUrl: string;
      nonce: string;
      exp: number;
    };
const TEN_MINUTES = 10 * 60_000;
const ALL_SERVICES: GoogleService[] = ["calendar", "gmail"];
// Completed consents waiting for the app to claim them. Single-instance
// memory is enough: an unclaimed handle just means trying again.
const pendingConnect = new Map<
  string,
  { uid: string; tokens: TokenSet; exp: number }
>();
const pendingLogin = new Map<
  string,
  { session: Session; challenge: string; exp: number }
>();

function statusOf(
  deps: Deps,
  connection: GoogleConnectionRow | null,
): GoogleStatus {
  return {
    configured: deps.google.configured && !!deps.tokenKey,
    connected: !!connection,
    email: connection?.google_email ?? null,
    calendar: !!connection?.scopes.includes(SCOPES.calendar),
    gmail: !!connection?.scopes.includes(SCOPES.gmail),
    needsReconnect: connection?.status === "needs_reauth",
    lastSyncAt: connection?.calendar_last_sync_at ?? null,
    lastSyncError: connection?.calendar_last_sync_error ?? null,
  };
}
const challengeOf = (verifier: string) =>
  crypto.createHash("sha256").update(verifier).digest("base64url");
function allowedReturn(deps: Deps, returnUrl: string) {
  // Only the app's own deep links may receive the result.
  if (!deps.returnUrlPrefixes.some((prefix) => returnUrl.startsWith(prefix)))
    fail("VALIDATION_ERROR", "This return address is not allowed.");
}
function requireConfigured(deps: Deps): Buffer {
  if (!deps.google.configured || !deps.tokenKey)
    throw new AppError(
      "GOOGLE_NOT_CONFIGURED",
      "Google sign-in is not set up on this server yet.",
    );
  return deps.tokenKey;
}
function sweep(now: number) {
  for (const [key, value] of pendingConnect)
    if (value.exp < now) pendingConnect.delete(key);
  for (const [key, value] of pendingLogin)
    if (value.exp < now) pendingLogin.delete(key);
}

/** Saves (or merges) the Google grant for the repo's user. */
async function storeConnection(repo: Repo, key: Buffer, tokens: TokenSet) {
  const existing = await repo.getGoogleConnection();
  const sameAccount =
    !!existing && (!tokens.email || existing.google_email === tokens.email);
  const refresh = tokens.refreshToken
    ? encryptSecret(tokens.refreshToken, key)
    : sameAccount
      ? existing!.refresh_token_enc
      : null;
  if (!refresh)
    fail(
      "VALIDATION_ERROR",
      "Google didn't allow offline access. Please connect again.",
    );
  return repo.saveGoogleConnection({
    google_email: tokens.email ?? existing?.google_email ?? null,
    scopes: [
      ...new Set([...(sameAccount ? existing!.scopes : []), ...tokens.scopes]),
    ],
    refresh_token_enc: refresh!,
    access_token_enc: encryptSecret(tokens.accessToken, key),
    access_token_expires_at: tokens.expiresAt.toISOString(),
    status: "active",
  });
}

export function googleCallback(deps: Deps) {
  return async (req: Request, res: Response) => {
    const query = parse(
      z.object({
        state: z.string().max(4000),
        code: z.string().max(2000).optional(),
        error: z.string().max(200).optional(),
      }),
      req.query,
    );
    const state = verifyState<State>(
      query.state,
      deps.stateKey,
      deps.now().getTime(),
    );
    if (!state) {
      res
        .status(400)
        .type("text/plain")
        .send(
          "This Google sign-in link has expired. Return to ShiftSync and try again.",
        );
      return;
    }
    const back = (params: Record<string, string>) =>
      res.redirect(
        302,
        `${state.returnUrl}${state.returnUrl.includes("?") ? "&" : "?"}${new URLSearchParams(params)}`,
      );
    if (query.error || !query.code) return back({ status: "cancelled" });
    let tokens: TokenSet;
    try {
      tokens = await deps.google.exchangeCode(query.code);
    } catch {
      deps.log.warn("google_code_exchange_failed");
      return back({ status: "error" });
    }
    const now = deps.now().getTime();
    sweep(now);
    const handle = crypto.randomBytes(24).toString("base64url");
    if (state.mode !== "login") {
      pendingConnect.set(handle, {
        uid: state.uid,
        tokens,
        exp: now + TEN_MINUTES,
      });
      return back({ status: "ok", handle });
    }
    if (!tokens.idToken) return back({ status: "error" });
    let session: Session;
    try {
      session = await deps.auth.signInWithGoogle(tokens.idToken);
    } catch (error) {
      deps.log.warn("google_login_failed", {
        code: error instanceof AppError ? error.code : "unknown",
      });
      return back({
        status: "error",
        reason:
          error instanceof AppError && error.code === "GOOGLE_NOT_CONFIGURED"
            ? "not_enabled"
            : "sign_in_failed",
      });
    }
    // The same consent connects Calendar and Gmail for the new session.
    const repo = deps.repoFor(session.user.id, session.accessToken);
    try {
      await storeConnection(repo, deps.tokenKey!, tokens);
      const profile = await repo.getProfile();
      if (tokens.name && !profile?.display_name)
        await repo.saveProfile({ display_name: tokens.name.slice(0, 120) });
    } catch {
      // Signing in still works; the student can connect Google afterwards.
      deps.log.warn("google_login_connection_failed");
    }
    pendingLogin.set(handle, {
      session: {
        ...session,
        user: {
          ...session.user,
          displayName: session.user.displayName || tokens.name || "",
        },
      },
      challenge: state.challenge,
      exp: now + TEN_MINUTES,
    });
    back({ status: "ok", handle });
  };
}

/** Public routes for signing in with Google (mounted at /api/auth/google). */
export function googleLoginRoutes(deps: Deps) {
  const router = Router();
  const limit = rateLimit(10, 60_000);
  router.post("/start", limit, async (req, res) => {
    requireConfigured(deps);
    const body = parse(googleLoginStartSchema, req.body);
    allowedReturn(deps, body.returnUrl);
    const state = signState(
      {
        mode: "login",
        challenge: body.codeChallenge,
        returnUrl: body.returnUrl,
        nonce: crypto.randomBytes(12).toString("base64url"),
        exp: deps.now().getTime() + TEN_MINUTES,
      },
      deps.stateKey,
    );
    res.json({ authUrl: deps.google.authUrl(state, ALL_SERVICES) });
  });
  router.post("/complete", limit, async (req, res) => {
    const { handle, codeVerifier } = parse(googleLoginCompleteSchema, req.body);
    const claim = pendingLogin.get(handle);
    pendingLogin.delete(handle);
    const expected = claim ? Buffer.from(claim.challenge) : Buffer.alloc(0);
    const given = Buffer.from(challengeOf(codeVerifier));
    if (
      !claim ||
      claim.exp < deps.now().getTime() ||
      expected.length !== given.length ||
      !crypto.timingSafeEqual(expected, given)
    )
      fail("UNAUTHORIZED", "This Google sign-in expired. Please try again.");
    res.json(claim!.session);
  });
  return router;
}

export function googleRoutes(deps: Deps) {
  const router = Router();

  router.get("/google/status", async (req, res) => {
    const { repo } = context(req);
    res.json(statusOf(deps, await repo.getGoogleConnection()));
  });

  router.post("/google/connect", async (req, res) => {
    const { user } = context(req);
    requireConfigured(deps);
    const body = parse(googleConnectSchema, req.body);
    allowedReturn(deps, body.returnUrl);
    const state = signState(
      {
        mode: "connect",
        uid: user.id,
        services: [...new Set(body.services)],
        returnUrl: body.returnUrl,
        nonce: crypto.randomBytes(12).toString("base64url"),
        exp: deps.now().getTime() + TEN_MINUTES,
      },
      deps.stateKey,
    );
    res.json({ authUrl: deps.google.authUrl(state, body.services) });
  });

  router.post("/google/complete", async (req, res) => {
    const { repo, user } = context(req);
    const key = requireConfigured(deps);
    const { handle } = parse(googleCompleteSchema, req.body);
    const claim = pendingConnect.get(handle);
    pendingConnect.delete(handle);
    if (!claim || claim.exp < deps.now().getTime() || claim.uid !== user.id)
      fail(
        "VALIDATION_ERROR",
        "This Google sign-in expired. Please connect again.",
      );
    res.json(statusOf(deps, await storeConnection(repo, key, claim!.tokens)));
  });

  router.post("/google/disconnect", async (req, res) => {
    const { repo } = context(req);
    const connection = await repo.getGoogleConnection();
    if (connection && deps.tokenKey) {
      try {
        await deps.google.revoke(
          decryptSecret(connection.refresh_token_enc, deps.tokenKey),
        );
      } catch {
        // Already revoked or unreachable; the stored grant is deleted anyway.
        deps.log.warn("google_revoke_failed");
      }
    }
    await repo.deleteGoogleConnection();
    res.json(statusOf(deps, null));
  });

  router.post("/calendar/sync", async (req, res) => {
    const { repo, user } = context(req);
    const schedule = await loadSchedule(repo, user.email, deps.now());
    res.json(await importCalendar(deps, repo, schedule));
  });
  return router;
}
