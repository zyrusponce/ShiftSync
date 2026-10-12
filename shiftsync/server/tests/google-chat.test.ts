// Sign in with Google, CalenBud chat, and Google Calendar edits/exports.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { item, startHarness, type Harness } from "./harness";
import * as fixtures from "./fixtures";

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(() => h.close());
const student = () => fixtures.student(h);

const publicPost = async (path: string, body: unknown) => {
  const response = await fetch(`${h.base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
};
async function googleLogin(
  code: string,
  verifier = crypto.randomBytes(32).toString("base64url"),
) {
  const codeChallenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const start = await publicPost("/api/auth/google/start", {
    returnUrl: "shiftsync://oauth/login",
    codeChallenge,
  });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const state = new URL(start.body.authUrl).searchParams.get("state")!;
  const callback = await fetch(
    `${h.base}/api/google/callback?state=${encodeURIComponent(state)}&code=${code}`,
    { redirect: "manual" },
  );
  assert.equal(callback.status, 302);
  return { location: new URL(callback.headers.get("location")!), verifier };
}
const finish = (login: Awaited<ReturnType<typeof googleLogin>>) =>
  publicPost("/api/auth/google/complete", {
    handle: login.location.searchParams.get("handle"),
    codeVerifier: login.verifier,
  });

test("sign in with Google creates the account and connects Calendar and Gmail", async () => {
  const first = await googleLogin("login-1");
  assert.equal(first.location.searchParams.get("status"), "ok");
  // Only the app that started the sign-in (holding the verifier) can finish it.
  const stolen = await publicPost("/api/auth/google/complete", {
    handle: first.location.searchParams.get("handle"),
    codeVerifier: crypto.randomBytes(32).toString("base64url"),
  });
  assert.equal(stolen.status, 401);
  assert.equal((await finish(first)).status, 401, "handles are single use");

  const done = await finish(await googleLogin("login-2"));
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const session = done.body;
  assert.equal(session.user.email, "student@gmail.example");
  assert.equal(session.user.displayName, "Gina Student");
  const me = h.as(session.accessToken);
  const status = (await me.call("GET", "/api/google/status")).body;
  assert.deepEqual(
    [status.connected, status.calendar, status.gmail],
    [true, true, true],
  );
  const settings = (await me.call("GET", "/api/preferences")).body;
  assert.equal(settings.profile.name, "Gina Student");
  // Signing in again returns the same account.
  const repeat = await finish(await googleLogin("login-3"));
  assert.equal(repeat.body.user.id, session.user.id);
});

test("Google sign-in reports a disabled provider and rejects unsafe requests", async () => {
  const disabled = await googleLogin("disabled");
  assert.equal(disabled.location.searchParams.get("status"), "error");
  assert.equal(disabled.location.searchParams.get("reason"), "not_enabled");
  const challenge = crypto
    .createHash("sha256")
    .update("x".repeat(43))
    .digest("base64url");
  const foreign = await publicPost("/api/auth/google/start", {
    returnUrl: "https://evil.example/steal",
    codeChallenge: challenge,
  });
  assert.equal(foreign.status, 400);
  const weak = await publicPost("/api/auth/google/start", {
    returnUrl: "shiftsync://oauth/login",
    codeChallenge: "short",
  });
  assert.equal(weak.status, 400);
});

test("CalenBud answers from the real schedule and falls back to rules", async () => {
  const s = await student();
  const ask = (text: string) =>
    s.a.call("POST", "/api/ai/chat", { messages: [{ role: "user", text }] });
  h.aiMode.current = { kind: "down" };
  const offline = await ask("What do I have tomorrow?");
  assert.equal(offline.status, 200, JSON.stringify(offline.body));
  assert.equal(offline.body.source, "rules");
  assert.equal(offline.body.fallbackReason, "AI_SERVICE_UNAVAILABLE");
  assert.match(offline.body.reply, /Evening shift/);

  let prompt = "";
  h.aiMode.current = {
    kind: "ok",
    reply: (_system, sent) => {
      prompt = sent;
      return {
        reply:
          "Tomorrow you have Exam review from 10:00 AM to 12:00 PM, Statistics class from 1:00 PM to 3:00 PM and your Evening shift from 4:00 PM to 8:00 PM.",
        action: { type: "none" },
      };
    },
  };
  const grounded = await ask("What do I have tomorrow?");
  assert.equal(grounded.body.source, "ai", JSON.stringify(grounded.body));
  assert.equal(grounded.body.action, null);
  const facts = JSON.parse(prompt).facts;
  assert.ok(
    facts.schedule.some(
      (e: any) => e.title === "Statistics class" && e.fixed === true,
    ),
  );
  assert.ok(facts.freeTime.length > 0);

  h.aiMode.current = {
    kind: "ok",
    reply: () => ({
      reply: "You're free at 5:30 AM tomorrow!",
      action: { type: "none" },
    }),
  };
  const invented = await ask("When am I free tomorrow?");
  assert.equal(invented.body.source, "rules");
  assert.equal(invented.body.fallbackReason, "AI_OUTPUT_REJECTED");

  const misordered = await s.a.call("POST", "/api/ai/chat", {
    messages: [{ role: "assistant", text: "Hi" }],
  });
  assert.equal(misordered.status, 400);
});

test("CalenBud turns a described shift change into a reviewable proposal only", async () => {
  const s = await student();
  const proposal = {
    type: "change_shift",
    shiftId: s.shift.id,
    date: "2026-10-13",
    start: "09:00",
    end: "13:00",
  };
  h.aiMode.current = {
    kind: "ok",
    reply: () => ({
      reply:
        "Got it! Let's review moving your Evening shift to 9:00 AM to 1:00 PM before anything is saved.",
      action: proposal,
    }),
  };
  const answer = await s.a.call("POST", "/api/ai/chat", {
    messages: [{ role: "user", text: "My shift tomorrow moved to 9am" }],
  });
  assert.equal(answer.body.source, "ai", JSON.stringify(answer.body));
  assert.deepEqual(answer.body.action, {
    ...proposal,
    title: "Evening shift",
  });
  const stored = (await s.a.call("GET", "/api/events")).body.items.find(
    (i: any) => i.id === s.shift.id,
  );
  assert.equal(stored.start, "16:00", "the chat never changes the schedule");

  const guessed = await s.a.call("POST", "/api/ai/chat", {
    messages: [{ role: "user", text: "My shift changed" }],
  });
  assert.equal(guessed.body.action, null, "unstated times are not proposed");
});

test("editing a Google-linked event updates that event; Add to Calendar adds once", async () => {
  const s = await student();
  await fixtures.connectGoogle(h, s.a);
  h.google.events.length = 0;
  h.google.events.push({
    id: "gev-edit",
    etag: '"e1"',
    summary: "Library study",
    start: { dateTime: "2026-10-13T08:00:00+08:00" },
    end: { dateTime: "2026-10-13T09:00:00+08:00" },
  });
  await s.a.call("POST", "/api/calendar/sync");
  const imported = (await s.a.call("GET", "/api/events")).body.items.find(
    (e: any) => e.googleEventId === "gev-edit",
  );
  const edited = await s.a.call("PATCH", `/api/events/${imported.id}`, {
    start: "07:00",
    end: "08:00",
    expectedVersion: imported.version,
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.deepEqual(edited.body.calendar, {
    status: "synced",
    updated: 1,
    created: 0,
  });
  assert.ok(h.google.calls.includes('patch:gev-edit:"e1"'));
  assert.equal(h.google.events[0].start!.dateTime, "2026-10-12T23:00:00.000Z");
  const resync = await s.a.call("POST", "/api/calendar/sync");
  assert.equal(resync.body.unchanged, 1);
  assert.deepEqual(resync.body.needsReview, []);
  // A change made in Google meanwhile is never overwritten.
  h.google.events[0].etag = '"changed-in-google"';
  const clash = await s.a.call("PATCH", `/api/events/${imported.id}`, {
    start: "07:30",
    end: "08:30",
  });
  assert.equal(clash.body.calendar.status, "failed");
  assert.match(clash.body.calendar.message, /changed in Google Calendar/);
  assert.equal(h.google.events[0].start!.dateTime, "2026-10-12T23:00:00.000Z");

  const inserts = () => h.google.calls.filter((c) => c === "insert").length;
  const before = inserts();
  const added = await s.a.call("POST", `/api/calendar/events/${s.lecture.id}`);
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.ok(added.body.item.googleEventId);
  const twice = await s.a.call("POST", `/api/calendar/events/${s.lecture.id}`);
  assert.equal(twice.body.created, false);
  assert.equal(inserts() - before, 1);

  const stranger = h.user(`no-google-${crypto.randomUUID()}@example.com`);
  const own = item({ title: "Gym" });
  await stranger.call("POST", "/api/events", own);
  const refused = await stranger.call("POST", `/api/calendar/events/${own.id}`);
  assert.equal(refused.body.error.code, "GOOGLE_NOT_CONNECTED");
});
