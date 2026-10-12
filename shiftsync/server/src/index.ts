import path from "node:path";
import { createApp } from "./app";
import { ConfigError, loadEnvFiles, readEnv, type Env } from "./env";
import { createLogger } from "./http";
import { supabaseRepoFactory } from "./repo/supabase";
import { geminiClient } from "./services/ai";
import { supabaseAuth } from "./services/auth";
import { googleRestApi } from "./services/google";

const log = createLogger();
// server/.env first, then the app's .env, whose existing keys are reused.
loadEnvFiles([
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../.env"),
]);
let env: Env;
try {
  env = readEnv();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
if (!env.geminiApiKey)
  log.warn("ai_disabled", {
    reason: "No Gemini key; explanations and drafts use templates.",
  });
if (!env.google) log.warn("google_disabled", { missing: env.googleMissing });

const app = createApp({
  auth: supabaseAuth(env.supabaseUrl, env.supabaseKey),
  repoFor: supabaseRepoFactory(env.supabaseUrl, env.supabaseKey),
  ai: geminiClient(env.geminiApiKey, env.geminiModel, fetch, 25000, {
    fallbackModels: env.geminiFallbackModels,
  }),
  google: googleRestApi(env.google),
  tokenKey: env.google?.tokenKey ?? null,
  stateKey: env.stateKey,
  returnUrlPrefixes: env.returnUrlPrefixes,
  now: () => new Date(),
  log,
  trustProxy: env.trustProxy,
});
const server = app.listen(env.port, env.host, () =>
  log.info("listening", {
    host: env.host,
    port: env.port,
    ai: !!env.geminiApiKey,
    google: !!env.google,
  }),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    log.info("shutting_down", { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
