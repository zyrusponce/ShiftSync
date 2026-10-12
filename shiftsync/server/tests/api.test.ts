import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { item, key, startHarness, type Harness } from "./harness";
import * as fixtures from "./fixtures";
import { DAY, moveShift, overlaps } from "./fixtures";

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(() => h.close());

const student = (email?: string) => fixtures.student(h, email);
const connectGoogle = (a: fixtures.Student["a"]) =>
  fixtures.connectGoogle(h, a);

test("health and authentication", async () => {
  assert.equal((await fetch(`${h.base}/health`)).status, 200);
  const anonymous = await fetch(`${h.base}/api/events`);
  assert.equal(anonymous.status, 401);
  assert.equal(
    ((await anonymous.json()) as { error: { code: string } }).error.code,
    "UNAUTHORIZED",
  );
  const forged = await fetch(`${h.base}/api/events`, {
    headers: { Authorization: "Bearer forged" },
  });
  assert.equal(forged.status, 401);
});

test("event CRUD: idempotent create, validation, duplicates, versions", async () => {
  const a = h.user("crud@example.com");
  const event = item({ title: "Gym", category: "Personal" });
  const first = await a.call("POST", "/api/events", event);
  assert.equal(first.status, 201);
  assert.equal(first.body.item.version, 1);
  assert.equal(first.body.item.fixed, false);
  const retry = await a.call("POST", "/api/events", event);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.replayed, true);
  const copy = await a.call("POST", "/api/events", {
    ...event,
    id: crypto.randomUUID(),
  });
  assert.equal(copy.status, 409);
  assert.equal(copy.body.error.code, "DUPLICATE_EVENT");
  const backwards = await a.call(
    "POST",
    "/api/events",
    item({ start: "11:00", end: "10:00" }),
  );
  assert.equal(backwards.status, 400);
  assert.match(
    backwards.body.error.message,
    /End time must be after start time/,
  );
  assert.equal(
    (await a.call("POST", "/api/events", item({ id: "not-a-uuid" }))).status,
    400,
  );
  const ghost = await a.call(
    "POST",
    "/api/events",
    item({ contactIds: [crypto.randomUUID()] }),
  );
  assert.equal(ghost.status, 400);
  const updated = await a.call("PATCH", `/api/events/${event.id}`, {
    priority: "High",
    fixed: true,
    expectedVersion: 1,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.item.priority, "High");
  assert.equal(updated.body.item.fixed, true);
  const stale = await a.call("PATCH", `/api/events/${event.id}`, {
    title: "Old edit",
    expectedVersion: 1,
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "VERSION_CONFLICT");
  assert.equal(stale.body.error.details.item.title, "Gym");
  // A new category brings its own fixed/flexible default.
  const recategorized = await a.call("PATCH", `/api/events/${event.id}`, {
    category: "Class",
  });
  assert.equal(recategorized.body.item.fixed, true);
  const study = await a.call("PATCH", `/api/events/${event.id}`, {
    category: "Study",
  });
  assert.equal(study.body.item.fixed, false);
  const filtered = await a.call("GET", "/api/events?category=Study");
  assert.deepEqual(
    filtered.body.items.map((i: any) => i.id),
    [event.id],
  );
  assert.equal((await a.call("DELETE", `/api/events/${event.id}`)).status, 204);
  assert.equal((await a.call("DELETE", `/api/events/${event.id}`)).status, 404);
});

test("15. a user cannot access another user's schedule", async () => {
  const s = await student();
  const intruder = h.user("intruder@example.com");
  assert.deepEqual((await intruder.call("GET", "/api/events")).body.items, []);
  assert.equal(
    (
      await intruder.call("PATCH", `/api/events/${s.review.id}`, {
        title: "Mine",
      })
    ).status,
    404,
  );
  assert.equal(
    (await intruder.call("DELETE", `/api/events/${s.review.id}`)).status,
    404,
  );
  assert.equal(
    (
      await intruder.call("POST", "/api/suggestions", {
        eventId: s.review.id,
        occurrenceDate: DAY,
      })
    ).status,
    404,
  );
  assert.deepEqual(
    (await intruder.call("GET", "/api/contacts")).body.contacts,
    [],
  );
  // Linking someone else's contact is refused.
  const linked = await intruder.call(
    "POST",
    "/api/events",
    item({ contactIds: [s.professor.id] }),
  );
  assert.equal(linked.status, 400);
  const own = await s.a.call("GET", `/api/events`);
  assert.equal(own.body.items.length, 3);
  assert.equal(own.body.timeZone, "Asia/Manila");
});

test("shift impact analysis previews without saving, then recovery is approved once", async () => {
  const s = await student();
  const proposed = { ...s.shift, start: "09:00", end: "14:00" };
  const analysis = await s.a.call("POST", "/api/conflicts/analyze", {
    shift: proposed,
  });
  assert.equal(analysis.status, 200, JSON.stringify(analysis.body));
  const { report } = analysis.body;
  const titles = report.direct.map((e: any) => [e.item.title, e.action]).sort();
  assert.deepEqual(titles, [
    ["Exam review", "reschedule"],
    ["Statistics class", "communicate"],
  ]);
  assert.equal(report.plan.length, 1);
  // Nothing changed yet.
  const stored = (await s.a.call("GET", "/api/events")).body.items.find(
    (i: any) => i.id === s.shift.id,
  );
  assert.equal(stored.start, "16:00");

  const { withReview, withClass } = await moveShift(s);
  assert.equal(withReview.pairType, "fixed_flexible");
  assert.equal(withClass.pairType, "fixed_fixed");
  const generated = await s.a.call("POST", "/api/suggestions", {
    eventId: s.review.id,
    occurrenceDate: DAY,
    conflictId: withReview.id,
  });
  assert.equal(generated.status, 201, JSON.stringify(generated.body));
  const suggestions = generated.body.suggestions as any[];
  assert.ok(suggestions.length >= 1 && suggestions.length <= 3);
  for (const suggestion of suggestions) {
    for (const block of suggestion.blocks) {
      assert.ok(!overlaps(block, DAY, "09:00", "14:00"));
      assert.ok(!overlaps(block, DAY, "13:00", "15:00"));
      assert.ok(`${block.date}T${block.end}` <= "2026-10-14T09:00");
    }
    assert.ok(suggestion.explanation.length > 20);
  }
  const chosen = suggestions[0];
  const k = key();
  const approved = await s.a.call(
    "POST",
    `/api/suggestions/${chosen.suggestionId}/approve`,
    {},
    { "Idempotency-Key": k },
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const moved = approved.body.items.find((i: any) => i.id === s.review.id);
  assert.deepEqual(
    { date: moved.date, start: moved.start, end: moved.end },
    chosen.blocks[0],
  );
  assert.equal(moved.version, 2);
  assert.equal(approved.body.calendar.status, "not_linked");

  // 16. Repeating the approval never applies it twice.
  const replay = await s.a.call(
    "POST",
    `/api/suggestions/${chosen.suggestionId}/approve`,
    {},
    { "Idempotency-Key": k },
  );
  assert.deepEqual(replay.body, approved.body);
  const again = await s.a.call(
    "POST",
    `/api/suggestions/${chosen.suggestionId}/approve`,
    {},
    { "Idempotency-Key": key() },
  );
  assert.equal(again.status, 200);
  assert.equal(again.body.calendar.status, "already_applied");
  const sibling = suggestions[1];
  if (sibling) {
    const superseded = await s.a.call(
      "POST",
      `/api/suggestions/${sibling.suggestionId}/approve`,
      {},
      { "Idempotency-Key": key() },
    );
    assert.equal(superseded.status, 409);
    assert.equal(superseded.body.error.code, "STALE_SUGGESTION");
  }
  const events = (await s.a.call("GET", "/api/events")).body.items;
  assert.equal(events.length, 3);
  const after = (await s.a.call("GET", "/api/conflicts")).body
    .conflicts as any[];
  assert.ok(!after.some((c) => c.eventIds.includes(s.review.id)));
  assert.equal(after.find((c) => c.id === withClass.id).status, "unresolved");
  assert.equal(
    (
      await s.a.call(
        "POST",
        `/api/suggestions/${chosen.suggestionId}/approve`,
        {},
      )
    ).status,
    400,
  );
});

test("7. a slot taken before approval is rejected as stale", async () => {
  const s = await student();
  await moveShift(s);
  const { suggestions } = (
    await s.a.call("POST", "/api/suggestions", {
      eventId: s.review.id,
      occurrenceDate: DAY,
    })
  ).body;
  const [first] = suggestions;
  const intruder = item({
    title: "Dentist",
    category: "Personal",
    fixed: true,
    ...first.blocks[0],
  });
  assert.equal((await s.a.call("POST", "/api/events", intruder)).status, 201);
  const result = await s.a.call(
    "POST",
    `/api/suggestions/${first.suggestionId}/approve`,
    {},
    { "Idempotency-Key": key() },
  );
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, "STALE_SUGGESTION");
  assert.match(result.body.error.message, /conflicts with your schedule/);
  const review = (await s.a.call("GET", "/api/events")).body.items.find(
    (i: any) => i.id === s.review.id,
  );
  assert.equal(review.start, "10:00");
  // Editing the event itself also makes its suggestions stale.
  const fresh = (
    await s.a.call("POST", "/api/suggestions", {
      eventId: s.review.id,
      occurrenceDate: DAY,
    })
  ).body.suggestions;
  await s.a.call("PATCH", `/api/events/${s.review.id}`, {
    notes: "Bring flashcards",
  });
  const edited = await s.a.call(
    "POST",
    `/api/suggestions/${fresh[0].suggestionId}/approve`,
    {},
    { "Idempotency-Key": key() },
  );
  assert.equal(edited.body.error.code, "STALE_SUGGESTION");
});

test("8. fixed events are never offered for automatic rescheduling", async () => {
  const s = await student();
  await moveShift(s);
  const result = await s.a.call("POST", "/api/suggestions", {
    eventId: s.lecture.id,
    occurrenceDate: DAY,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "NOT_MOVABLE");
});

test("9, 10, 14. the student picks recipients; each message is separate and AI-safe", async () => {
  const s = await student();
  const { withClass } = await moveShift(s);
  h.aiMode.current = { kind: "down" };
  const employer = await s.a.call("POST", "/api/ai/draft", {
    conflictId: withClass.id,
    contactId: s.supervisor.id,
  });
  assert.equal(employer.status, 201, JSON.stringify(employer.body));
  assert.equal(employer.body.source, "template");
  assert.equal(employer.body.fallbackReason, "AI_SERVICE_UNAVAILABLE");
  const message = employer.body.notification;
  assert.equal(message.recipientEmail, "manager@example.com");
  assert.equal(message.status, "prepared");
  assert.match(message.body, /Evening shift/);
  assert.match(message.body, /9:00 AM/);
  assert.equal(
    h.google.sent.length,
    0,
    "a conflict never sends email by itself",
  );

  // A grounded AI answer is used; one with an invented time is rejected.
  h.aiMode.current = {
    kind: "ok",
    reply: () => ({
      subject: "Statistics class conflict",
      body: "Dear Prof. Reyes,\n\nMy work shift now runs 9:00 AM to 2:00 PM and overlaps Statistics class (1:00 PM to 3:00 PM). Could we discuss options?\n\nAna Santos",
    }),
  };
  const professor = await s.a.call("POST", "/api/ai/draft", {
    conflictId: withClass.id,
    contactId: s.professor.id,
  });
  assert.equal(professor.body.source, "ai");
  assert.notEqual(professor.body.notification.id, message.id);
  h.aiMode.current = {
    kind: "ok",
    reply: () => ({
      subject: "Conflict",
      body: "Hi Dana, could I come in at 6:00 PM instead? I will be there tomorrow. Thanks, Ana",
    }),
  };
  const invented = await s.a.call("POST", "/api/ai/draft", {
    conflictId: withClass.id,
    contactId: s.supervisor.id,
  });
  assert.equal(invented.body.source, "template");
  assert.equal(invented.body.fallbackReason, "AI_OUTPUT_REJECTED");

  // Only contacts linked to the conflicting events can be recipients.
  const stranger = {
    id: crypto.randomUUID(),
    name: "Someone",
    email: "someone@example.com",
    role: "Other",
  };
  await s.a.call("POST", "/api/contacts", stranger);
  const refused = await s.a.call("POST", "/api/ai/draft", {
    conflictId: withClass.id,
    contactId: stranger.id,
  });
  assert.equal(refused.status, 400);

  const conflicts = (await s.a.call("GET", "/api/conflicts")).body
    .conflicts as any[];
  assert.equal(
    conflicts.find((c) => c.id === withClass.id).status,
    "draft_prepared",
  );
  const listed = (
    await s.a.call(
      "GET",
      `/api/notifications?conflictId=${encodeURIComponent(withClass.id)}`,
    )
  ).body.notifications;
  assert.equal(listed.length, 3);

  // Explanations keep working with AI down.
  h.aiMode.current = { kind: "down" };
  const explained = await s.a.call("POST", "/api/ai/explain", {
    conflictId: withClass.id,
  });
  assert.equal(explained.body.source, "template");
  assert.match(explained.body.text, /Both are fixed/);
});

test("9-12. Gmail drafts and confirmed sends, with truthful statuses", async () => {
  const s = await student();
  const { withClass } = await moveShift(s);
  h.aiMode.current = { kind: "down" };
  const work = (
    await s.a.call("POST", "/api/ai/draft", {
      conflictId: withClass.id,
      contactId: s.supervisor.id,
    })
  ).body.notification;
  const school = (
    await s.a.call("POST", "/api/ai/draft", {
      conflictId: withClass.id,
      contactId: s.professor.id,
    })
  ).body.notification;
  const disconnected = await s.a.call("POST", "/api/gmail/drafts", {
    notificationId: work.id,
    subject: work.subject,
    body: work.body,
  });
  assert.equal(disconnected.status, 409);
  assert.equal(disconnected.body.error.code, "GOOGLE_NOT_CONNECTED");
  await connectGoogle(s.a);

  const edited = `${work.body}\n\nP.S. I can work the evening shift on Thursday.`;
  const draft = await s.a.call("POST", "/api/gmail/drafts", {
    notificationId: work.id,
    subject: work.subject,
    body: edited,
  });
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  assert.equal(draft.body.notification.status, "draft_saved");
  assert.equal(draft.body.notification.source, "user");
  assert.equal(h.google.sent.length, 0, "saving a draft does not send");

  const unconfirmed = await s.a.call(
    "POST",
    "/api/gmail/send",
    {
      notificationId: work.id,
      subject: work.subject,
      body: edited,
      recipientEmail: work.recipientEmail,
    },
    { "Idempotency-Key": key() },
  );
  assert.equal(unconfirmed.status, 400);
  const redirected = await s.a.call(
    "POST",
    "/api/gmail/send",
    {
      notificationId: work.id,
      subject: work.subject,
      body: edited,
      confirmed: true,
      recipientEmail: "attacker@example.com",
    },
    { "Idempotency-Key": key() },
  );
  assert.equal(redirected.status, 400);
  const noKey = await s.a.call("POST", "/api/gmail/send", {
    notificationId: work.id,
    subject: work.subject,
    body: edited,
    confirmed: true,
    recipientEmail: work.recipientEmail,
  });
  assert.equal(noKey.status, 400);

  // 11. A failed send is reported as failed, never as sent.
  h.google.failSend = 500;
  const failed = await s.a.call(
    "POST",
    "/api/gmail/send",
    {
      notificationId: work.id,
      subject: work.subject,
      body: edited,
      confirmed: true,
      recipientEmail: work.recipientEmail,
    },
    { "Idempotency-Key": key() },
  );
  assert.equal(failed.status, 502);
  assert.equal(failed.body.error.code, "EMAIL_SEND_FAILED");
  assert.equal(failed.body.error.details.notification.status, "failed");
  assert.equal(h.google.sent.length, 0);
  let conflict = (await s.a.call("GET", "/api/conflicts")).body.conflicts.find(
    (c: any) => c.id === withClass.id,
  );
  assert.equal(conflict.status, "draft_prepared");

  h.google.failSend = null;
  const k = key();
  const sent = await s.a.call(
    "POST",
    "/api/gmail/send",
    {
      notificationId: work.id,
      subject: work.subject,
      body: edited,
      confirmed: true,
      recipientEmail: work.recipientEmail,
    },
    { "Idempotency-Key": k },
  );
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.notification.status, "sent");
  assert.ok(sent.body.notification.gmailMessageId);
  assert.equal(h.google.sent.length, 1);
  const raw = Buffer.from(h.google.sent[0].raw, "base64url").toString("utf8");
  assert.match(raw, /^To: "Dana Cruz" <manager@example\.com>/m);
  const bodyText = Buffer.from(
    raw.split("\r\n\r\n")[1].replace(/\r\n/g, ""),
    "base64",
  ).toString("utf8");
  assert.match(bodyText, /Thursday/);
  // Retries never send twice.
  await s.a.call(
    "POST",
    "/api/gmail/send",
    {
      notificationId: work.id,
      subject: work.subject,
      body: edited,
      confirmed: true,
      recipientEmail: work.recipientEmail,
    },
    { "Idempotency-Key": k },
  );
  await s.a.call(
    "POST",
    "/api/gmail/send",
    {
      notificationId: work.id,
      subject: work.subject,
      body: edited,
      confirmed: true,
      recipientEmail: work.recipientEmail,
    },
    { "Idempotency-Key": key() },
  );
  assert.equal(h.google.sent.length, 1);
  // Contacted, not resolved; the other message is untouched.
  conflict = (await s.a.call("GET", "/api/conflicts")).body.conflicts.find(
    (c: any) => c.id === withClass.id,
  );
  assert.equal(conflict.status, "user_contacted");
  const messages = (await s.a.call("GET", "/api/notifications")).body
    .notifications as any[];
  assert.equal(messages.find((m) => m.id === school.id).status, "prepared");
  const resolved = await s.a.call(
    "PATCH",
    `/api/conflicts/${encodeURIComponent(withClass.id)}/status`,
    { status: "resolved" },
  );
  assert.equal(resolved.body.status, "resolved");
});

test("12. Google Calendar updates the same event without duplicates", async () => {
  const s = await student();
  await connectGoogle(s.a);
  h.google.events.length = 0;
  h.google.events.push({
    id: "gev-study",
    etag: '"e1"',
    summary: "Library study",
    location: "Library",
    start: { dateTime: "2026-10-13T08:00:00+08:00" },
    end: { dateTime: "2026-10-13T09:00:00+08:00" },
  });
  const first = await s.a.call("POST", "/api/calendar/sync");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.imported, 1);
  const again = await s.a.call("POST", "/api/calendar/sync");
  assert.equal(again.body.imported, 0);
  assert.equal(again.body.unchanged, 1);
  let events = (await s.a.call("GET", "/api/events")).body.items as any[];
  const imported = events.find((e) => e.googleEventId === "gev-study");
  assert.equal(
    imported.fixed,
    true,
    "imported events are fixed until the student says otherwise",
  );
  await s.a.call("PATCH", `/api/events/${imported.id}`, { category: "Study" });
  await moveShift(s);
  const { suggestions } = (
    await s.a.call("POST", "/api/suggestions", {
      eventId: imported.id,
      occurrenceDate: DAY,
    })
  ).body;
  // An outside event appearing in Google after the suggestion blocks approval.
  const target = suggestions[0].blocks[0];
  h.google.events.push({
    id: "gev-other",
    etag: '"x"',
    summary: "Club meeting",
    start: { dateTime: `${target.date}T${target.start}:00+08:00` },
    end: { dateTime: `${target.date}T${target.end}:00+08:00` },
  });
  const blocked = await s.a.call(
    "POST",
    `/api/suggestions/${suggestions[0].suggestionId}/approve`,
    {},
    { "Idempotency-Key": key() },
  );
  assert.equal(blocked.status, 409);
  assert.match(
    blocked.body.error.message,
    /Club meeting in your Google Calendar/,
  );
  h.google.events.pop();
  const next = (
    await s.a.call("POST", "/api/suggestions", {
      eventId: imported.id,
      occurrenceDate: DAY,
    })
  ).body.suggestions[0];
  const approved = await s.a.call(
    "POST",
    `/api/suggestions/${next.suggestionId}/approve`,
    {},
    { "Idempotency-Key": key() },
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.deepEqual(approved.body.calendar, {
    status: "synced",
    updated: 1,
    created: 0,
  });
  assert.ok(h.google.calls.includes('patch:gev-study:"e1"'));
  assert.ok(!h.google.calls.includes("insert"));
  assert.equal(h.google.events.length, 1);
  assert.equal(
    h.google.events[0].start!.dateTime,
    new Date(
      `${next.blocks[0].date}T${next.blocks[0].start}:00+08:00`,
    ).toISOString(),
  );
  const third = await s.a.call("POST", "/api/calendar/sync");
  assert.equal(third.body.imported, 0);
  events = (await s.a.call("GET", "/api/events")).body.items;
  assert.equal(events.filter((e) => e.googleEventId === "gev-study").length, 1);
  assert.equal(events.length, 4);
});

test("Google changes made elsewhere are never silently overwritten", async () => {
  const s = await student();
  await connectGoogle(s.a);
  h.google.events.length = 0;
  h.google.events.push({
    id: "gev-2",
    etag: '"v1"',
    summary: "Reading",
    start: { dateTime: "2026-10-13T08:00:00+08:00" },
    end: { dateTime: "2026-10-13T09:00:00+08:00" },
  });
  await s.a.call("POST", "/api/calendar/sync");
  const imported = (await s.a.call("GET", "/api/events")).body.items.find(
    (e: any) => e.googleEventId === "gev-2",
  );
  await s.a.call("PATCH", `/api/events/${imported.id}`, { category: "Study" });
  await moveShift(s);
  const [first] = (
    await s.a.call("POST", "/api/suggestions", {
      eventId: imported.id,
      occurrenceDate: DAY,
    })
  ).body.suggestions;
  h.google.events[0].etag = '"v2"';
  const approved = await s.a.call(
    "POST",
    `/api/suggestions/${first.suggestionId}/approve`,
    {},
    { "Idempotency-Key": key() },
  );
  assert.equal(approved.status, 200);
  assert.equal(approved.body.calendar.status, "failed");
  assert.match(approved.body.calendar.message, /changed in Google Calendar/);
  assert.equal(h.google.events[0].start!.dateTime, "2026-10-13T08:00:00+08:00");
});

test("OAuth return addresses and stale handles are rejected", async () => {
  const a = h.user("oauth@example.com");
  const evil = await a.call("POST", "/api/google/connect", {
    services: ["gmail"],
    returnUrl: "https://evil.example/steal",
  });
  assert.equal(evil.status, 400);
  const tampered = await fetch(
    `${h.base}/api/google/callback?state=abc.def&code=x`,
    { redirect: "manual" },
  );
  assert.equal(tampered.status, 400);
  const other = h.user("other@example.com");
  const start = await a.call("POST", "/api/google/connect", {
    services: ["gmail"],
    returnUrl: "shiftsync://oauth/google",
  });
  const state = new URL(start.body.authUrl).searchParams.get("state")!;
  const callback = await fetch(
    `${h.base}/api/google/callback?state=${encodeURIComponent(state)}&code=abc`,
    { redirect: "manual" },
  );
  const handle = new URL(callback.headers.get("location")!).searchParams.get(
    "handle",
  );
  // Another account cannot claim this consent.
  assert.equal(
    (await other.call("POST", "/api/google/complete", { handle })).status,
    400,
  );
  assert.equal(
    (await a.call("POST", "/api/google/complete", { handle })).status,
    400,
    "handles are single use",
  );
  const status = await a.call("GET", "/api/google/status");
  assert.equal(status.body.connected, false);
});

test("partial updates change only the fields sent; null clears a deadline", async () => {
  const a = h.user(`partial-${crypto.randomUUID()}@example.com`);
  const event = item({
    title: "Weekly review",
    category: "Study",
    repeat: "Weekly",
    location: "Library",
    notes: "Bring notes",
    deadline: "2026-10-20T09:00",
  });
  assert.equal((await a.call("POST", "/api/events", event)).status, 201);
  const patched = await a.call("PATCH", `/api/events/${event.id}`, {
    priority: "High",
  });
  assert.equal(patched.status, 200);
  const { item: updated } = patched.body;
  assert.equal(updated.priority, "High");
  assert.equal(updated.repeat, "Weekly");
  assert.equal(updated.location, "Library");
  assert.equal(updated.notes, "Bring notes");
  assert.equal(updated.deadline, "2026-10-20T09:00");
  const cleared = await a.call("PATCH", `/api/events/${event.id}`, {
    deadline: null,
  });
  assert.equal(cleared.body.item.deadline, undefined);
});
