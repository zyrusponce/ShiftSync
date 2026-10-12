// Sign in with Google. One consent screen signs the student in and connects
// Google Calendar and Gmail. The result comes back through the app's deep
// link as a one-time handle that only this app instance can redeem: it must
// also send the PKCE verifier, whose hash it gave the server at the start.
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import type { Session } from "../domain/contract";
import { ApiError, api } from "./api";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function base64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += ALPHABET[n & 63];
  }
  return out;
}

/** Resolves to a session, or null if the student closed the Google page. */
export async function signInWithGoogle(): Promise<Session | null> {
  const verifier = base64url(Crypto.getRandomBytes(32));
  const challenge = (
    await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      verifier,
      {
        encoding: Crypto.CryptoEncoding.BASE64,
      },
    )
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const returnUrl = Linking.createURL("oauth/login");
  const { authUrl } = await api.googleLoginStart(returnUrl, challenge);
  const result = await WebBrowser.openAuthSessionAsync(authUrl, returnUrl);
  if (result.type !== "success") return null;
  const params = Linking.parse(result.url).queryParams ?? {};
  if (params.status === "cancelled") return null;
  if (params.status !== "ok" || typeof params.handle !== "string")
    throw params.reason === "not_enabled"
      ? new ApiError(
          "GOOGLE_NOT_CONFIGURED",
          "Google sign-in isn't enabled for ShiftSync yet. Use your email for now.",
        )
      : new ApiError(
          "UNAUTHORIZED",
          "Google sign-in didn't finish. Please try again.",
        );
  return api.googleLoginComplete(params.handle, verifier);
}
