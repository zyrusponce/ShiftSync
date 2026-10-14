import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ConfigError, parseEnvFile, readEnv } from "../src/env";
import {
  decryptSecret,
  encryptSecret,
  signState,
  verifyState,
} from "../src/services/crypto";
import { buildRawEmail } from "../src/services/google";
import {
  geminiClient,
  openRouterClient,
  AiUnavailable,
} from "../src/services/ai";
import { groundingProblem, type Facts } from "../src/services/communication";
import { itemToRow, rowToItem } from "../src/mapping";
import type { EventRow } from "../src/repo/types";
import { emailHighlights, renderEmailHtml } from "../src/services/emailFormat";
import { newItem } from "../../src/domain/seed";
import type { Conflict } from "../../src/domain/types";

test("existing VITE_* names are accepted without renaming", () => {
  const parsed = parseEnvFile(
    '# comment\nVITE_google_gemini_api_key =abc123\nVITE_SUPABASE_URL=https://ref.supabase.co/\nVITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_x"\nVITE_GOOGLE_CLIENT_ID=id.apps.googleusercontent.com\n',
  );
  assert.equal(parsed.VITE_google_gemini_api_key, "abc123");
  const env = readEnv(parsed);
  assert.equal(env.supabaseUrl, "https://ref.supabase.co");
  assert.equal(env.supabaseKey, "sb_publishable_x");
  assert.equal(env.geminiApiKey, "abc123");
  assert.equal(env.google, null);
  assert.deepEqual(env.googleMissing, [
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY",
  ]);
  // Canonical names win over aliases.
  assert.equal(
    readEnv({ ...parsed, GEMINI_API_KEY: "canonical" }).geminiApiKey,
    "canonical",
  );
});

test("startup validation reports every missing or malformed setting", () => {
  assert.throws(() => readEnv({}), ConfigError);
  assert.throws(
    () =>
      readEnv({
        SUPABASE_URL: "http://example.com",
        SUPABASE_PUBLISHABLE_KEY: "k",
        GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY: "short",
      }),
    /https[\s\S]*32 bytes/,
  );
  const full = readEnv({
    SUPABASE_URL: "https://ref.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "k",
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_REDIRECT_URI: "https://api.example.com/api/google/callback",
    GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY: crypto
      .randomBytes(32)
      .toString("base64"),
  });
  assert.ok(full.google);
  assert.equal(full.google!.tokenKey.length, 32);
});

test("stored Google tokens are encrypted and tamper-evident", () => {
  const key = crypto.randomBytes(32);
  const sealed = encryptSecret("refresh-token", key);
  assert.ok(!sealed.includes("refresh-token"));
  assert.equal(decryptSecret(sealed, key), "refresh-token");
  assert.throws(() => decryptSecret(sealed, crypto.randomBytes(32)));
  const state = signState({ uid: "u", exp: Date.now() + 1000 }, key);
  assert.equal(verifyState<{ uid: string; exp: number }>(state, key)?.uid, "u");
  assert.equal(
    verifyState(
      state.replace(/.$/, (c) => (c === "A" ? "B" : "A")),
      key,
    ),
    null,
  );
  assert.equal(verifyState(signState({ exp: Date.now() - 1 }, key), key), null);
});

test("only the canonical spelling of a signature verifies", () => {
  // The last base64url character of a 32-byte HMAC carries 2 unused bits.
  // Flipping only those leaves the decoded bytes unchanged, which used to
  // let roughly 1 in 16 "tampered" tokens through and made the test above
  // flaky. Every possible respelling of the last character must now fail.
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  for (let n = 0; n < 50; n++) {
    const key = crypto.randomBytes(32);
    const state = signState({ uid: "u", exp: Date.now() + 60_000 }, key);
    assert.ok(verifyState(state, key));
    for (const c of alphabet)
      if (c !== state.at(-1))
        assert.equal(verifyState(state.slice(0, -1) + c, key), null);
  }
});

test("emails are plain-text RFC 2822 messages safe from header injection", () => {
  const raw = Buffer.from(
    buildRawEmail({
      to: "prof@example.com",
      toName: "Prof. Réyes",
      subject: "Hi\r\nBcc: evil@example.com",
      body: "Line 1\nLine 2",
    }),
    "base64url",
  ).toString("utf8");
  const [headers, body] = raw.split("\r\n\r\n");
  assert.match(headers, /^To: =\?UTF-8\?B\?.+\?= <prof@example\.com>$/m);
  assert.doesNotMatch(headers, /^Bcc:/m);
  assert.equal(
    Buffer.from(body, "base64").toString("utf8"),
    "Line 1\r\nLine 2",
  );
  assert.throws(() =>
    buildRawEmail({
      to: "a@b.c>\r\nBcc: x@y.z",
      toName: "",
      subject: "s",
      body: "b",
    }),
  );
});

test("AI text must only use verified times, dates and weekdays", () => {
  const facts: Facts = {
    dates: ["2026-10-13"],
    times: [9 * 60, 14 * 60, 13 * 60, 15 * 60],
    summary: {},
  };
  assert.equal(
    groundingProblem(
      "My shift is 9:00 AM to 2 PM on Tuesday, October 13.",
      facts,
    ),
    null,
  );
  assert.match(
    groundingProblem("Could I start at 10:30 AM?", facts) ?? "",
    /unverified time/,
  );
  assert.match(
    groundingProblem("Class is at 16:00.", facts) ?? "",
    /unverified time/,
  );
  assert.match(
    groundingProblem("See you Oct 14.", facts) ?? "",
    /unverified date/,
  );
  assert.match(
    groundingProblem("See you on Friday.", facts) ?? "",
    /unverified weekday/,
  );
  assert.match(
    groundingProblem("See you tomorrow.", facts) ?? "",
    /relative date/,
  );
  assert.match(
    groundingProblem("Email me at ana@example.com", facts) ?? "",
    /email address/,
  );
  assert.match(groundingProblem("Hi [Name],", facts) ?? "", /placeholder/);
});

test("Gemini client sends the key in a header and reports outages", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const ok = geminiClient("secret-key", "gemini-test", (async (
    url: string,
    init: RequestInit,
  ) => {
    seen = { url, init };
    return new Response(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: '{"explanation":"ok"}' }] } },
        ],
      }),
    );
  }) as typeof fetch);
  assert.deepEqual(
    await ok.generateJson({ system: "s", prompt: "p", schema: {} }),
    { explanation: "ok" },
  );
  assert.ok(!seen!.url.includes("secret-key"), "the key never goes in the URL");
  assert.equal(
    (seen!.init.headers as Record<string, string>)["x-goog-api-key"],
    "secret-key",
  );
  const down = geminiClient(
    "k",
    "m",
    (async () => new Response("", { status: 503 })) as unknown as typeof fetch,
    1000,
    { retryDelayMs: 0 },
  );
  const urls: string[] = [];
  const recovers = geminiClient(
    "k",
    "primary",
    (async (url: string) => {
      urls.push(url);
      return urls.length === 1
        ? new Response("", { status: 503 })
        : new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }],
            }),
          );
    }) as unknown as typeof fetch,
    1000,
    { retryDelayMs: 0 },
  );
  assert.deepEqual(
    await recovers.generateJson({ system: "s", prompt: "p", schema: {} }),
    { a: 1 },
  );
  const tried: string[] = [];
  const fallsBack = geminiClient(
    "k",
    "primary",
    (async (url: string) => {
      tried.push(url);
      return url.includes("/primary:")
        ? new Response("", { status: 503 })
        : new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: '{"b":2}' }] } }],
            }),
          );
    }) as unknown as typeof fetch,
    1000,
    { fallbackModels: ["backup"], retryDelayMs: 0 },
  );
  assert.deepEqual(
    await fallsBack.generateJson({ system: "s", prompt: "p", schema: {} }),
    { b: 2 },
  );
  assert.ok(tried.at(-1)!.includes("/backup:"));
  await assert.rejects(
    down.generateJson({ system: "s", prompt: "p", schema: {} }),
    AiUnavailable,
  );
  const offline = geminiClient("k", "m", (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch);
  await assert.rejects(
    offline.generateJson({ system: "s", prompt: "p", schema: {} }),
    AiUnavailable,
  );
  assert.equal(geminiClient(null, "m").available, false);
});

test("OpenRouter client uses a bearer header, retries and reports outages", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const ok = openRouterClient(
    "or-key",
    "vendor/model",
    (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"explanation":"ok"}' } }],
        }),
      );
    }) as unknown as typeof fetch,
    1000,
    { fallbackModels: ["vendor/backup"] },
  );
  assert.deepEqual(
    await ok.generateJson({
      system: "s",
      prompt: "p",
      schema: { type: "object" },
    }),
    { explanation: "ok" },
  );
  assert.ok(!seen!.url.includes("or-key"), "the key never goes in the URL");
  assert.equal(
    (seen!.init.headers as Record<string, string>).Authorization,
    "Bearer or-key",
  );
  const sent = JSON.parse(seen!.init.body as string);
  assert.deepEqual(sent.models, ["vendor/model", "vendor/backup"]);
  assert.equal(sent.response_format.type, "json_schema");

  let calls = 0;
  const recovers = openRouterClient(
    "k",
    "m",
    (async () => {
      calls++;
      return calls === 1
        ? new Response("", { status: 503 })
        : new Response(
            JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] }),
          );
    }) as unknown as typeof fetch,
    1000,
    { retryDelayMs: 0 },
  );
  assert.deepEqual(
    await recovers.generateJson({ system: "s", prompt: "p", schema: {} }),
    { a: 1 },
  );
  const down = openRouterClient(
    "k",
    "m",
    (async () => new Response("", { status: 401 })) as unknown as typeof fetch,
    1000,
    { retryDelayMs: 0 },
  );
  await assert.rejects(
    down.generateJson({ system: "s", prompt: "p", schema: {} }),
    AiUnavailable,
  );
  assert.equal(openRouterClient(null, "m").available, false);
});

test("events are stored in UTC and read back in the user's time zone", () => {
  const item = {
    id: crypto.randomUUID(),
    kind: "event" as const,
    title: "Exam review",
    date: "2026-10-13",
    start: "09:00",
    end: "11:00",
    category: "Study" as const,
    location: "Library",
    notes: "",
    participants: "",
    reminder: "None",
    repeat: "Weekly" as const,
    exceptions: ["2026-10-20"],
    priority: "High" as const,
    completed: false,
    status: "Confirmed" as const,
    position: "",
    swapRequested: false,
    deadline: "2026-10-14T09:00",
    splittable: true,
    minBlockMinutes: 45,
  };
  const row = itemToRow(item, "Asia/Manila");
  assert.equal(row.start_at, "2026-10-13T01:00:00.000Z");
  assert.equal(row.deadline_at, "2026-10-14T01:00:00.000Z");
  assert.equal(row.category, "study");
  assert.equal(row.is_fixed, false);
  const stored = {
    ...row,
    user_id: "u",
    version: 3,
    created_at: "",
    updated_at: "",
    google_etag: null,
    google_synced_at: null,
  } as EventRow;
  const back = rowToItem(stored, ["c1"], "Asia/Manila");
  assert.deepEqual(
    {
      date: back.date,
      start: back.start,
      end: back.end,
      deadline: back.deadline,
      repeat: back.repeat,
      exceptions: back.exceptions,
    },
    {
      date: "2026-10-13",
      start: "09:00",
      end: "11:00",
      deadline: "2026-10-14T09:00",
      repeat: "Weekly",
      exceptions: ["2026-10-20"],
    },
  );
  assert.equal(back.version, 3);
  assert.deepEqual(back.contactIds, ["c1"]);
});

const emailConflict = (): Conflict => ({
  id: "2026-10-16:a:b",
  date: "2026-10-16",
  first: {
    ...newItem("shift", "2026-10-16"),
    title: "Evening Shift",
    start: "13:00",
    end: "19:00",
  },
  second: {
    ...newItem("event", "2026-10-16"),
    title: "Calculus <b>",
    category: "Class",
    start: "15:00",
    end: "17:00",
  },
  severity: "High",
  type: "overlap",
  minutes: 120,
  reason: "Overlaps",
});
const emailBody = [
  "Hi Dana,",
  "",
  "I'm writing about a schedule conflict with Evening Shift on Friday, October 16. It overlaps with Calculus <b>.",
  "",
  "• Date: Friday, October 16",
  "• Evening Shift (work shift): 1:00 PM–7:00 PM",
  "",
  "Evening Shift starts at 1:00 PM. Could I start at 5:00 PM instead? Thanks for considering it.",
  "",
  "Thank you,",
  "Ana",
].join("\n");

test("email HTML bolds the conflict's real details once, and escapes everything", () => {
  const html = renderEmailHtml(emailBody, emailHighlights(emailConflict()));
  // User-provided titles can't inject markup.
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /<strong>Calculus &lt;b&gt;<\/strong>/);
  assert.match(html, /<strong>schedule conflict<\/strong>/);
  assert.match(html, /<strong>Friday, October 16<\/strong>/);
  // Bold once: the title's second mention stays plain.
  assert.equal(html.match(/<strong>Evening Shift<\/strong>/g)?.length, 1);
  // The first question is the request; it is bold as a whole.
  assert.match(html, /<strong>Could I start at 5:00 PM instead\?<\/strong>/);
  // Bullets become a list with bold labels.
  assert.match(
    html,
    /<li[^>]*><strong>Evening Shift \(work shift\):<\/strong> 1:00 PM–7:00 PM<\/li>/,
  );
  // Greeting and sign-off are never emphasised.
  assert.match(html, /<p[^>]*>Hi Dana,<\/p>/);
  assert.match(html, /<p[^>]*>Thank you,<br>Ana<\/p>/);
});

test("without the conflict, only ShiftSync-formatted dates and times are bold", () => {
  const html = renderEmailHtml(emailBody, []);
  assert.match(html, /<strong>Friday, October 16<\/strong>/);
  assert.match(html, /<strong>1:00 PM<\/strong>/);
  assert.doesNotMatch(html, /<strong>Evening Shift<\/strong>/);
});

test("emails with HTML are multipart, keeping the plain text unchanged", () => {
  const raw = Buffer.from(
    buildRawEmail({
      to: "prof@example.com",
      toName: "Prof",
      subject: "Conflict",
      body: "Line 1\nLine 2",
      html: "<p><strong>Line 1</strong></p>",
    }),
    "base64url",
  ).toString("utf8");
  const boundary =
    /^Content-Type: multipart\/alternative; boundary="([^"]+)"$/m.exec(raw)![1];
  const parts = raw.split(`--${boundary}`).slice(1, 3);
  const decode = (part: string) =>
    Buffer.from(
      part.split("\r\n\r\n")[1].replace(/\r\n/g, ""),
      "base64",
    ).toString("utf8");
  assert.match(parts[0], /Content-Type: text\/plain; charset=UTF-8/);
  assert.equal(decode(parts[0]), "Line 1\r\nLine 2");
  assert.match(parts[1], /Content-Type: text\/html; charset=UTF-8/);
  assert.equal(decode(parts[1]), "<p><strong>Line 1</strong></p>");
  assert.ok(raw.trimEnd().endsWith(`--${boundary}--`));
});
