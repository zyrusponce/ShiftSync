// Account sign-up, sign-in and token checks through Supabase Auth. The app
// only ever talks to this API; it never holds Supabase keys itself.
import crypto from "node:crypto";
import {
  createClient,
  type Session as SupabaseSession,
} from "@supabase/supabase-js";
import type { Session, SignUpResponse } from "../../../src/domain/contract";
import { AppError } from "../http";

export type VerifiedUser = { id: string; email: string };
export interface AuthService {
  signUp(
    email: string,
    password: string,
    displayName: string,
  ): Promise<SignUpResponse>;
  signIn(email: string, password: string): Promise<Session>;
  refresh(refreshToken: string): Promise<Session>;
  signOut(accessToken: string): Promise<void>;
  /** The user an access token belongs to, or null if it is not valid. */
  verify(accessToken: string): Promise<VerifiedUser | null>;
  /** Signs in (or creates) the account for a Google ID token. */
  signInWithGoogle(idToken: string): Promise<Session>;
}

const toSession = (session: SupabaseSession): Session => ({
  accessToken: session.access_token,
  refreshToken: session.refresh_token,
  expiresAt:
    session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
  user: {
    id: session.user.id,
    email: session.user.email ?? "",
    // Email sign-ups set display_name; Google accounts provide full_name.
    displayName: String(
      session.user.user_metadata?.display_name ??
        session.user.user_metadata?.full_name ??
        session.user.user_metadata?.name ??
        "",
    ),
  },
});
const unavailable = () =>
  new AppError(
    "INTERNAL_ERROR",
    "Sign-in is temporarily unavailable. Please try again.",
    undefined,
    503,
  );

export function supabaseAuth(
  url: string,
  key: string,
  fetchImpl: typeof fetch = fetch,
): AuthService {
  // A fresh client per call keeps one user's session out of another's.
  const client = () =>
    createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  // Verified tokens are remembered briefly to avoid a lookup per request.
  const cache = new Map<string, { user: VerifiedUser; until: number }>();
  const hash = (token: string) =>
    crypto.createHash("sha256").update(token).digest("base64url");
  return {
    async signUp(email, password, displayName) {
      const { data, error } = await client().auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
      });
      if (error) {
        if (error.status && error.status >= 500) throw unavailable();
        if (/already registered|already exists/i.test(error.message))
          throw new AppError(
            "VALIDATION_ERROR",
            "An account with this email already exists. Try logging in.",
          );
        if (/password/i.test(error.message))
          throw new AppError(
            "VALIDATION_ERROR",
            "Choose a stronger password (at least 8 characters).",
          );
        if (/rate limit/i.test(error.message))
          throw new AppError(
            "RATE_LIMITED",
            "Too many attempts. Please wait a few minutes and try again.",
          );
        throw new AppError(
          "VALIDATION_ERROR",
          "We couldn't create that account. Check the email and password.",
        );
      }
      return data.session
        ? { status: "signed_in", session: toSession(data.session) }
        : { status: "confirm_email" };
    },
    async signIn(email, password) {
      const { data, error } = await client().auth.signInWithPassword({
        email,
        password,
      });
      if (error || !data.session) {
        if (error?.status && error.status >= 500) throw unavailable();
        if (error && /not confirmed/i.test(error.message))
          throw new AppError(
            "EMAIL_NOT_CONFIRMED",
            "Confirm your email address first, using the link we sent you.",
          );
        throw new AppError(
          "UNAUTHORIZED",
          "That email and password don't match an account.",
        );
      }
      return toSession(data.session);
    },
    async signInWithGoogle(idToken) {
      const { data, error } = await client().auth.signInWithIdToken({
        provider: "google",
        token: idToken,
      });
      if (error || !data.session) {
        if (error?.status && error.status >= 500) throw unavailable();
        if (error && /provider|audience|client id/i.test(error.message))
          throw new AppError(
            "GOOGLE_NOT_CONFIGURED",
            "Google sign-in isn't enabled for ShiftSync accounts yet. Enable the Google provider in Supabase and add this server's Google client ID.",
          );
        throw new AppError(
          "UNAUTHORIZED",
          "Google sign-in didn't finish. Please try again.",
        );
      }
      return toSession(data.session);
    },
    async refresh(refreshToken) {
      const { data, error } = await client().auth.refreshSession({
        refresh_token: refreshToken,
      });
      if (error?.status && error.status >= 500) throw unavailable();
      if (error || !data.session)
        throw new AppError(
          "UNAUTHORIZED",
          "Your session has expired. Please sign in again.",
        );
      return toSession(data.session);
    },
    async signOut(accessToken) {
      cache.delete(hash(accessToken));
      // Revokes the session's refresh tokens; failure leaves them to expire.
      await fetchImpl(`${url}/auth/v1/logout?scope=local`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8000),
      }).catch(() => undefined);
    },
    async verify(accessToken) {
      const id = hash(accessToken);
      const hit = cache.get(id);
      if (hit && hit.until > Date.now()) return hit.user;
      const { data, error } = await client().auth.getUser(accessToken);
      if (error?.status && error.status >= 500) throw unavailable();
      if (error || !data.user) return null;
      const user = { id: data.user.id, email: data.user.email ?? "" };
      if (cache.size > 2000) cache.clear();
      cache.set(id, { user, until: Date.now() + 60_000 });
      return user;
    },
  };
}
