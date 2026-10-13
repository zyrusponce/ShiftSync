import { test } from "node:test";
import assert from "node:assert/strict";
import { newItem } from "../src/domain/seed";
import {
  conflictNotice,
  conflictsToAnnounce,
  planReminders,
  reminderLead,
  shiftChanges,
  shiftNotice,
} from "../src/domain/notify";
import type { Conflict, ScheduleItem } from "../src/domain/types";

const on = { reminders: true, shiftNotifications: true };
// 2026-10-13 08:00 local time.
const now = new Date(2026, 9, 13, 8, 0);
const item = (values: Partial<ScheduleItem> = {}): ScheduleItem => ({
  ...newItem("event", "2026-10-13"),
  title: "Algebra",
  category: "Class",
  start: "10:00",
  end: "11:00",
  reminder: "30 minutes before",
  ...values,
});

test("reminder text becomes minutes before", () => {
  assert.equal(reminderLead("5 minutes before"), 5);
  assert.equal(reminderLead("1 hour before"), 60);
  assert.equal(reminderLead("1 day before"), 1440);
  assert.equal(reminderLead("None"), null);
  assert.equal(reminderLead("whenever"), null);
});

test("reminders fire before the start in local time", () => {
  const [plan] = planReminders([item()], on, now);
  assert.equal(plan.fireAt.getTime(), new Date(2026, 9, 13, 9, 30).getTime());
  assert.equal(plan.title, "Upcoming Commitment");
  assert.match(plan.body, /Algebra starts in 30 minutes, at 10:00 AM/);
  assert.deepEqual(plan.target, {
    kind: "reminder",
    itemId: plan.target.kind === "reminder" ? plan.target.itemId : "",
    date: "2026-10-13",
  });
});

test("reminder ids are stable so unchanged reminders are not rescheduled", () => {
  const items = [item()];
  const later = new Date(now.getTime() + 60_000);
  assert.deepEqual(
    planReminders(items, on, now).map((plan) => plan.id),
    planReminders(items, on, later).map((plan) => plan.id),
  );
  // Moving the event changes the id, which replaces the old reminder.
  assert.notEqual(
    planReminders(items, on, now)[0].id,
    planReminders([{ ...items[0], start: "10:30" }], on, now)[0].id,
  );
});

test("past, silenced, cancelled and completed items get no reminder", () => {
  const plans = planReminders(
    [
      item({ start: "08:10" }), // 30 minutes before is already past
      item({ reminder: "None" }),
      item({ status: "Cancelled" }),
      item({ kind: "task", completed: true }),
      item({ kind: "unavailable" }),
    ],
    on,
    now,
  );
  assert.deepEqual(plans, []);
});

test("category preferences silence their reminders", () => {
  const shift = item({ kind: "shift", category: "Work", title: "Cafe" });
  const event = item();
  assert.deepEqual(
    planReminders(
      [shift, event],
      { reminders: false, shiftNotifications: true },
      now,
    ).map((plan) => plan.title),
    ["Upcoming Shift"],
  );
  assert.deepEqual(
    planReminders(
      [shift, event],
      { reminders: true, shiftNotifications: false },
      now,
    ).map((plan) => plan.title),
    ["Upcoming Commitment"],
  );
});

test("the timing override retimes reminders that are on, never ones set to None", () => {
  const plans = planReminders([item(), item({ reminder: "None" })], on, now, {
    leadOverride: 60,
  });
  assert.equal(plans.length, 1);
  assert.equal(
    plans[0].fireAt.getTime(),
    new Date(2026, 9, 13, 9, 0).getTime(),
  );
});

test("tasks remind before they are due and repeats stay within the window", () => {
  const task = item({ kind: "task", title: "Essay", end: "17:00" });
  assert.match(planReminders([task], on, now)[0].body, /“Essay” is due/);
  const daily = item({ repeat: "Daily" });
  const plans = planReminders([daily], on, now, { days: 3 });
  assert.equal(plans.length, 3);
  assert.ok(plans.every((plan, n) => !n || plan.fireAt > plans[n - 1].fireAt));
});

const overlap = (id: string, type: Conflict["type"] = "overlap"): Conflict => ({
  id,
  date: "2026-10-14",
  first: item({ kind: "shift", category: "Work", title: "Cafe" }),
  second: item(),
  severity: "High",
  type,
  minutes: 30,
  reason: "Overlaps",
});

test("each overlap is announced once and again only after it went away", () => {
  const first = conflictsToAnnounce([overlap("a"), overlap("b", "buffer")], []);
  assert.deepEqual(
    first.fresh.map((c) => c.id),
    ["a"],
  );
  // Unchanged: nothing new.
  const same = conflictsToAnnounce([overlap("a")], first.announced);
  assert.deepEqual(same.fresh, []);
  // Resolved, then back again: announced again.
  const gone = conflictsToAnnounce([], same.announced);
  assert.deepEqual(gone.announced, []);
  assert.deepEqual(
    conflictsToAnnounce([overlap("a")], gone.announced).fresh.map((c) => c.id),
    ["a"],
  );
});

test("conflict alerts name what overlaps and open the right place", () => {
  const one = conflictNotice([overlap("a")]);
  assert.equal(one.title, "Schedule Conflict Detected");
  assert.match(one.body, /Your work shift overlaps with a class/);
  assert.deepEqual(one.target, { kind: "conflict", conflictId: "a" });
  const many = conflictNotice([overlap("a"), overlap("b")]);
  assert.match(many.body, /^2 commitments overlap/);
  assert.deepEqual(many.target, { kind: "conflict", conflictId: null });
});

test("only changed or removed existing shifts count as shift changes", () => {
  const shift = item({ kind: "shift", category: "Work", title: "Cafe" });
  const other = item();
  assert.deepEqual(
    shiftChanges([shift, other], [shift, { ...other, start: "12:00" }]),
    [],
  );
  assert.deepEqual(shiftChanges([], [shift]), []);
  // A version bump from the server is not a change.
  assert.deepEqual(shiftChanges([shift], [{ ...shift, version: 4 }]), []);
  const moved = shiftChanges(
    [shift],
    [{ ...shift, start: "13:00", end: "17:00" }],
  );
  assert.equal(moved[0].change, "moved");
  assert.match(shiftNotice(moved).body, /now .*1:00 PM–5:00 PM/);
  assert.equal(shiftChanges([shift], [])[0].change, "removed");
  assert.equal(
    shiftChanges([shift], [{ ...shift, status: "Cancelled" }])[0].change,
    "cancelled",
  );
  assert.deepEqual(shiftNotice(shiftChanges([shift], [])).target, {
    kind: "shift",
    itemId: null,
    date: null,
  });
});
