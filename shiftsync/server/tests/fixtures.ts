// Shared API test fixtures: a working student with contacts and a day of
// commitments, a shift change that conflicts, and a Google connection.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { allDay, item, type Harness } from "./harness";

export const DAY = "2026-10-13";
export const overlaps = (
  a: { date: string; start: string; end: string },
  date: string,
  start: string,
  end: string,
) => a.date === date && a.start < end && start < a.end;

export async function student(
  h: Harness,
  email = `ana-${crypto.randomUUID()}@example.com`,
) {
  const a = h.user(email);
  const settings = await a.call("PATCH", "/api/preferences", {
    profile: { name: "Ana Santos", organization: "", roles: ["Student"] },
    onboarded: true,
    preferences: { timeZone: "Asia/Manila" },
    availability: allDay,
  });
  assert.equal(settings.status, 200, JSON.stringify(settings.body));
  const supervisor = {
    id: crypto.randomUUID(),
    name: "Dana Cruz",
    email: "manager@example.com",
    role: "Work",
  };
  const professor = {
    id: crypto.randomUUID(),
    name: "Prof. Reyes",
    email: "professor@example.com",
    role: "School",
  };
  for (const contact of [supervisor, professor])
    assert.equal((await a.call("POST", "/api/contacts", contact)).status, 201);
  const shift = item({
    kind: "shift",
    category: "Work",
    title: "Evening shift",
    start: "16:00",
    end: "20:00",
    location: "Main Branch",
    contactIds: [supervisor.id],
  });
  const lecture = item({
    category: "Class",
    title: "Statistics class",
    start: "13:00",
    end: "15:00",
    location: "Room 118",
    contactIds: [professor.id],
  });
  const review = item({
    category: "Study",
    title: "Exam review",
    start: "10:00",
    end: "12:00",
    priority: "High",
    deadline: "2026-10-14T09:00",
    splittable: true,
    minBlockMinutes: 60,
  });
  for (const event of [shift, lecture, review]) {
    const created = await a.call("POST", "/api/events", event);
    assert.equal(created.status, 201, JSON.stringify(created.body));
  }
  return { a, supervisor, professor, shift, lecture, review };
}
export type Student = Awaited<ReturnType<typeof student>>;

/** Moves the shift so it overlaps both the review (flexible) and the class (fixed). */
export async function moveShift(s: Student) {
  const moved = await s.a.call("PATCH", `/api/events/${s.shift.id}`, {
    start: "09:00",
    end: "14:00",
    expectedVersion: 1,
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  const conflicts = (await s.a.call("GET", "/api/conflicts")).body
    .conflicts as any[];
  const withClass = conflicts.find(
    (c) => c.eventIds.includes(s.lecture.id) && c.eventIds.includes(s.shift.id),
  );
  const withReview = conflicts.find(
    (c) => c.eventIds.includes(s.review.id) && c.eventIds.includes(s.shift.id),
  );
  return { withClass, withReview };
}

export async function connectGoogle(h: Harness, a: Student["a"]) {
  const start = await a.call("POST", "/api/google/connect", {
    services: ["calendar", "gmail"],
    returnUrl: "shiftsync://oauth/google",
  });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const state = new URL(start.body.authUrl).searchParams.get("state")!;
  const callback = await fetch(
    `${h.base}/api/google/callback?state=${encodeURIComponent(state)}&code=abc`,
    { redirect: "manual" },
  );
  assert.equal(callback.status, 302);
  const location = new URL(callback.headers.get("location")!);
  assert.equal(location.protocol, "shiftsync:");
  assert.equal(location.searchParams.get("status"), "ok");
  const done = await a.call("POST", "/api/google/complete", {
    handle: location.searchParams.get("handle"),
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.calendar && done.body.gmail, true);
}
