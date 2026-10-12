import fs from "node:fs";
import crypto from "node:crypto";

/** Minimal .env parser: KEY=value lines, optional quotes, # comments. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed
      .slice(0, index)
      .trim()
      .replace(/^export\s+/, "");
    let value = trimmed.slice(index + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) values[key] = value;
  }
  return values;
}
/** Loads env files in order; real environment variables always win. */
export function loadEnvFiles(files: string[], target = process.env) {
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const [key, value] of Object.entries(
      parseEnvFile(fs.readFileSync(file, "utf8")),
    ))
      if (target[key] === undefined) target[key] = value;
  }
}

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenKey: Buffer;
};
export type Env = {
  port: number;
  host: string;
  supabaseUrl: string;
  supabaseKey: string;
  geminiApiKey: string | null;
  geminiModel: string;
  geminiFallbackModels: string[];
  google: GoogleConfig | null;
  /** Names still needed before Google sign-in can be enabled. */
  googleMissing: string[];
  stateKey: Buffer;
  returnUrlPrefixes: string[];
  trustProxy: boolean;
};
export class ConfigError extends Error {}

// Existing project names are accepted as aliases so working credentials do
// not need to be duplicated. Canonical names are listed first.
const ALIASES = {
  supabaseUrl: [
    "SUPABASE_URL",
    "EXPO_PUBLIC_SUPABASE_URL",
    "VITE_SUPABASE_URL",
  ],
  supabaseKey: [
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
    "EXPO_PUBLIC_SUPABASE_ANON_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  ],
  gemini: ["GEMINI_API_KEY", "VITE_google_gemini_api_key"],
  googleClientId: ["GOOGLE_CLIENT_ID", "VITE_GOOGLE_CLIENT_ID"],
};
const pick = (source: NodeJS.ProcessEnv, names: string[]) =>
  names.map((name) => source[name]?.trim()).find((value) => !!value) ?? null;

function decodeKey(value: string): Buffer | null {
  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  return key.length === 32 ? key : null;
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const problems: string[] = [];
  const supabaseUrl = pick(source, ALIASES.supabaseUrl);
  const supabaseKey = pick(source, ALIASES.supabaseKey);
  if (!supabaseUrl)
    problems.push(
      `Set SUPABASE_URL (or ${ALIASES.supabaseUrl.slice(1).join(" / ")}).`,
    );
  else {
    try {
      const url = new URL(supabaseUrl);
      if (
        url.protocol !== "https:" &&
        !["localhost", "127.0.0.1"].includes(url.hostname)
      )
        problems.push("SUPABASE_URL must use https.");
    } catch {
      problems.push("SUPABASE_URL is not a valid URL.");
    }
  }
  if (!supabaseKey)
    problems.push("Set SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY).");
  const port = Number(source.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    problems.push("PORT must be a valid port number.");

  const clientId = pick(source, ALIASES.googleClientId);
  const clientSecret = source.GOOGLE_CLIENT_SECRET?.trim() || null;
  const redirectUri = source.GOOGLE_REDIRECT_URI?.trim() || null;
  const rawKey = source.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY?.trim() || null;
  const tokenKey = rawKey ? decodeKey(rawKey) : null;
  if (rawKey && !tokenKey)
    problems.push(
      "GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 or hex encoded.",
    );
  if (redirectUri) {
    try {
      new URL(redirectUri);
    } catch {
      problems.push("GOOGLE_REDIRECT_URI is not a valid URL.");
    }
  }
  const googleMissing = [
    !clientId && "GOOGLE_CLIENT_ID",
    !clientSecret && "GOOGLE_CLIENT_SECRET",
    !redirectUri && "GOOGLE_REDIRECT_URI",
    !tokenKey && "GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY",
  ].filter((value): value is string => !!value);
  if (problems.length)
    throw new ConfigError(
      `Invalid server configuration:\n- ${problems.join("\n- ")}`,
    );
  const google =
    clientId && clientSecret && redirectUri && tokenKey
      ? { clientId, clientSecret, redirectUri, tokenKey }
      : null;
  return {
    port,
    host: source.HOST?.trim() || "0.0.0.0",
    supabaseUrl: supabaseUrl!.replace(/\/$/, ""),
    supabaseKey: supabaseKey!,
    geminiApiKey: pick(source, ALIASES.gemini),
    geminiModel: source.GEMINI_MODEL?.trim() || "gemini-3.8-flash",
    geminiFallbackModels: (source.GEMINI_FALLBACK_MODELS ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
    google,
    googleMissing,
    // OAuth state only needs to outlive one sign-in, so a per-process key
    // is enough when none is configured.
    stateKey: tokenKey
      ? Buffer.from(
          crypto.hkdfSync(
            "sha256",
            tokenKey,
            Buffer.alloc(0),
            "shiftsync-oauth-state",
            32,
          ),
        )
      : crypto.randomBytes(32),
    returnUrlPrefixes: (source.APP_RETURN_URL_PREFIXES ?? "shiftsync://,exp://")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    trustProxy: source.TRUST_PROXY === "true",
  };
}
