// Test harness: the real Express app with an in-memory repo and fakes for
// Supabase Auth, Gemini and Google, served on an ephemeral port.
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp, type Deps } from "../src/app";
import { AppError, silentLogger } from "../src/http";
import { createMemoryDb, memoryRepoFactory } from "../src/repo/memory";
import { AiUnavailable, type AiClient } from "../src/services/ai";
import type { AuthService, VerifiedUser } from "../src/services/auth";
import {
  GoogleApiError,
  SCOPES,
  type EventBody,
  type GoogleApi,
  type GoogleEvent,
} from "../src/services/google";

export type AiMode =
  | { kind: "ok"; reply: (system: string, prompt: string) => unknown }
  | { kind: "down" };
export function fakeAi(mode: {
  current: AiMode;
}): AiClient & { calls: number } {
  const ai = {
    available: true,
    calls: 0,
    async generateJson({ system, prompt }: { system: string; prompt: string }) {
      ai.calls++;
      if (mode.current.kind === "down") throw new AiUnavailable("down");
      return mode.current.reply(system, prompt);
    },
  };
  return ai;
}

export type FakeGoogle = GoogleApi & {
  calls: string[];
  events: GoogleEvent[];
  drafts: Map<string, string>;
  sent: { id: string; raw: string }[];
  failSend: number | null;
};
export function fakeGoogle(): FakeGoogle {
  let counter = 0;
  const next = (prefix: string) => `${prefix}${++counter}`;
  const google: FakeGoogle = {
    configured: true,
    calls: [],
    events: [],
    drafts: new Map(),
    sent: [],
    failSend: null,
    authUrl: (state, services) =>
      `https://accounts.example/auth?state=${encodeURIComponent(state)}&services=${services.join(",")}`,
    async exchangeCode(code) {
      google.calls.push(`exchange:${code}`);
      return {
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresAt: new Date(Date.now() + 3600_000),
        scopes: ["openid", "email", SCOPES.calendar, SCOPES.gmail],
        email: "student@gmail.example",
        name: "Gina Student",
        idToken: `id-token:${code}`,
      };
    },
    async refresh() {
      google.calls.push("refresh");
      return {
        accessToken: "access-2",
        refreshToken: null,
        expiresAt: new Date(Date.now() + 3600_000),
        scopes: [],
        email: null,
        name: null,
        idToken: null,
      };
    },
    async revoke() {
      google.calls.push("revoke");
    },
    async listEvents() {
      google.calls.push("listEvents");
      return structuredClone(google.events);
    },
    async getEvent(_t, _c, id) {
      return google.events.find((e) => e.id === id) ?? null;
    },
    async patchEvent(_t, _c, id, body: EventBody, etag) {
      google.calls.push(`patch:${id}:${etag ?? "-"}`);
      const event = google.events.find((e) => e.id === id);
      if (!event) throw new GoogleApiError(404, "notFound");
      if (etag && event.etag !== etag)
        throw new GoogleApiError(412, "conditionNotMet");
      Object.assign(event, {
        start: body.start,
        end: body.end,
        summary: body.summary,
        etag: `"${next("etag")}"`,
      });
      return structuredClone(event);
    },
    async insertEvent(_t, _c, body) {
      google.calls.push("insert");
      const event: GoogleEvent = {
        id: next("g"),
        etag: `"${next("etag")}"`,
        ...body,
      };
      google.events.push(event);
      return structuredClone(event);
    },
    async findByShiftSyncId(_t, _c, id) {
      return (
        google.events.find(
          (e) => e.extendedProperties?.private?.shiftsyncId === id,
        ) ?? null
      );
    },
    async createDraft(_t, raw) {
      const id = next("draft");
      google.calls.push(`createDraft:${id}`);
      google.drafts.set(id, raw);
      return { id };
    },
    async updateDraft(_t, id, raw) {
      google.calls.push(`updateDraft:${id}`);
      if (!google.drafts.has(id)) throw new GoogleApiError(404, "notFound");
      google.drafts.set(id, raw);
      return { id };
    },
    async sendDraft(_t, id) {
      google.calls.push(`sendDraft:${id}`);
      if (google.failSend !== null)
        throw new GoogleApiError(google.failSend, "failed");
      const raw = google.drafts.get(id)!;
      google.drafts.delete(id);
      const message = { id: next("msg"), raw };
      google.sent.push(message);
      return { id: message.id };
    },
    async sendMessage(_t, raw) {
      google.calls.push("sendMessage");
      if (google.failSend !== null)
        throw new GoogleApiError(google.failSend, "failed");
      const message = { id: next("msg"), raw };
      google.sent.push(message);
      return { id: message.id };
    },
  };
  return google;
}

export type Harness = Awaited<ReturnType<typeof startHarness>>;
export async function startHarness(options: { now?: Date } = {}) {
  const users = new Map<string, VerifiedUser>();
  const googleIds = new Map<string, string>();
  const auth: AuthService = {
    async signUp() {
      return { status: "confirm_email" };
    },
    async signIn() {
      throw new Error("not used");
    },
    async refresh() {
      throw new Error("not used");
    },
    async signOut() {},
    async verify(token) {
      return users.get(token) ?? null;
    },
    // Mirrors Supabase signInWithIdToken: one account per Google email.
    async signInWithGoogle(idToken) {
      if (idToken === "id-token:disabled")
        throw new AppError(
          "GOOGLE_NOT_CONFIGURED",
          "Google sign-in isn't enabled.",
        );
      const email = "student@gmail.example";
      const id = googleIds.get(email) ?? crypto.randomUUID();
      googleIds.set(email, id);
      const accessToken = crypto.randomBytes(16).toString("hex");
      users.set(accessToken, { id, email });
      return {
        accessToken,
        refreshToken: "refresh-session",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        user: { id, email, displayName: "" },
      };
    },
  };
  const db = createMemoryDb();
  const aiMode: { current: AiMode } = { current: { kind: "down" } };
  const ai = fakeAi(aiMode);
  const google = fakeGoogle();
  let clock = options.now ?? new Date("2026-10-12T00:00:00+08:00");
  const deps: Deps = {
    auth,
    repoFor: memoryRepoFactory(db),
    ai,
    google,
    tokenKey: crypto.randomBytes(32),
    stateKey: crypto.randomBytes(32),
    returnUrlPrefixes: ["shiftsync://"],
    now: () => clock,
    log: silentLogger,
  };
  const server = createApp(deps).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const caller =
    (token: string) =>
    async (
      method: string,
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) => {
      const response = await fetch(`${base}${path}`, {
        method,
        redirect: "manual",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      return { status: response.status, body: json, headers: response.headers };
    };
  const user = (email: string) => {
    const token = crypto.randomBytes(16).toString("hex");
    const id = crypto.randomUUID();
    users.set(token, { id, email });
    return { id, email, token, call: caller(token) };
  };
  return {
    base,
    db,
    ai,
    aiMode,
    google,
    deps,
    user,
    /** Calls the API with any access token (e.g. one from Google sign-in). */
    as: (token: string) => ({ call: caller(token) }),
    setClock: (date: Date) => {
      clock = date;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let seq = 0;
export const key = () => `test-key-${Date.now()}-${++seq}`;
export const item = (values: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  kind: "event",
  title: "Event",
  date: "2026-10-13",
  start: "09:00",
  end: "10:00",
  category: "Personal",
  location: "",
  notes: "",
  participants: "",
  reminder: "None",
  repeat: "Never",
  priority: "Medium",
  completed: false,
  status: "Confirmed",
  position: "",
  swapRequested: false,
  ...values,
});
export const allDay = Array.from({ length: 7 }, (_, day) => ({
  day,
  enabled: true,
  start: "07:00",
  end: "22:00",
}));
