import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeShiftImpact } from "../src/domain/impact";
import {
  applyPlan,
  generateRecovery,
  validatePlan,
  type LocalNow,
  type RecoveryResult,
} from "../src/domain/recovery";
import { isFixed, resolutionPlan } from "../src/domain/policy";
import { minutes } from "../src/domain/schedule";
import { utcToZoned, zonedToUtc } from "../src/domain/time";
import type {
  AvailabilityDay,
  Preferences,
  ScheduleItem,
  Slot,
} from "../src/domain/types";

const DAY = "2026-10-12";
const NEXT = "2026-10-13";
const now: LocalNow = { date: DAY, minutes: 6 * 60 };
const preferences: Preferences = {
  avoidOverlaps: true,
  avoidBackToBack: false,
  bufferMinutes: 0,
  preferredPeriod: "Any",
  aiEnabled: true,
  suggestions: true,
  conflictSuggestions: true,
  aiFrequency: "Daily",
  defaultView: "Month",
  weekStarts: "Monday",
  defaultDuration: 60,
  timeZone: "Asia/Manila",
  appearance: "Light",
  reminders: true,
  conflictAlerts: true,
  shiftNotifications: true,
  travelMinutes: 0,
  planningHorizonDays: 7,
  recoveryWeights: {
    deadline: 0.35,
    preference: 0.25,
    closeness: 0.2,
    breakTravel: 0.2,
  },
};
const open = (start = "07:00", end = "22:00"): AvailabilityDay[] =>
  Array.from({ length: 7 }, (_, day) => ({ day, enabled: true, start, end }));
let counter = 0;
const item = (values: Partial<ScheduleItem>): ScheduleItem => ({
  id: `item-${++counter}`,
  kind: "event",
  title: "Event",
  date: DAY,
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
const shift = (values: Partial<ScheduleItem> = {}) =>
  item({ kind: "shift", category: "Work", title: "Work shift", ...values });
const study = (values: Partial<ScheduleItem> = {}) =>
  item({ category: "Study", title: "Study", ...values });
const ok = (result: RecoveryResult) => {
  assert.equal(result.status, "OK", "reason" in result ? result.reason : "");
  return result.status === "OK" ? result.options : [];
};
const overlaps = (a: Slot, b: { date: string; start: string; end: string }) =>
  a.date === b.date &&
  minutes(a.start) < minutes(b.end) &&
  minutes(b.start) < minutes(a.end);

test("defaults: shifts and classes are fixed, study is flexible, overrides win", () => {
  assert.equal(isFixed(shift()), true);
  assert.equal(isFixed(item({ category: "Class" })), true);
  assert.equal(isFixed(study()), false);
  assert.equal(isFixed(item({ category: "Personal" })), false);
  assert.equal(isFixed(item({ category: "Personal", fixed: true })), true);
  assert.equal(isFixed(shift({ fixed: false })), false);
});

test("1. a shift overlapping flexible study gets valid recovery times", () => {
  const original = shift({ start: "13:00", end: "17:00" });
  const session = study({ title: "Essay", start: "09:00", end: "11:00" });
  const report = analyzeShiftImpact({
    items: [original, session],
    proposed: { ...original, start: "08:00", end: "12:00" },
    availability: open(),
    preferences,
    now,
  });
  assert.equal(report.direct.length, 1);
  assert.equal(report.direct[0].item.id, session.id);
  assert.equal(report.direct[0].action, "reschedule");
  assert.equal(report.direct[0].minutes, 120);
  const options = ok(report.plan[0].result);
  assert.ok(options.length >= 1 && options.length <= 3);
  for (const option of options) {
    assert.equal(option.kind, "move");
    const [block] = option.blocks;
    assert.equal(minutes(block.end) - minutes(block.start), 120);
    assert.ok(!overlaps(block, { date: DAY, start: "08:00", end: "12:00" }));
    assert.ok(option.explanation.length > 20);
  }
  assert.deepEqual(
    options.map((o) => o.rank),
    options.map((_, i) => i + 1),
  );
});

test("2. a shift overlapping a fixed class is never rescheduled automatically", () => {
  const original = shift({ start: "16:00", end: "20:00" });
  const lecture = item({
    category: "Class",
    title: "Statistics",
    start: "13:00",
    end: "15:00",
  });
  const report = analyzeShiftImpact({
    items: [original, lecture],
    proposed: { ...original, start: "12:00", end: "16:00" },
    availability: open(),
    preferences,
    now,
  });
  assert.equal(report.direct[0].pairType, "fixed_fixed");
  assert.equal(report.direct[0].action, "communicate");
  assert.equal(report.plan.length, 0);
  assert.equal(report.counts.communicate, 1);
  const result = generateRecovery({
    target: lecture,
    occurrenceDate: DAY,
    items: [original, lecture],
    availability: open(),
    preferences,
    now,
  });
  assert.equal(result.status, "NOT_MOVABLE");
});

test("3. two flexible events: lower priority moves, ties ask the student", () => {
  const high = study({ priority: "High" });
  const low = item({ priority: "Low" });
  const plan = resolutionPlan(high, low);
  assert.equal(plan.action, "reschedule");
  assert.equal(plan.action === "reschedule" && plan.move.id, low.id);
  const tie = resolutionPlan(study(), item({}));
  assert.equal(tie.action, "choose");
  assert.equal(resolutionPlan(shift(), study()).action, "reschedule");
  assert.equal(
    resolutionPlan(shift(), item({ category: "Class" })).action,
    "communicate",
  );
});

test("4. one shift change affects several commitments, recovered without collisions", () => {
  const prefs = { ...preferences, travelMinutes: 30 };
  const original = shift({
    start: "13:00",
    end: "17:00",
    location: "Main Branch",
  });
  const review = study({
    title: "Exam review",
    start: "09:00",
    end: "11:00",
    priority: "High",
    deadline: `${NEXT}T09:00`,
    location: "Library",
  });
  const assignment = study({
    title: "Assignment session",
    start: "12:00",
    end: "13:00",
    location: "Library",
  });
  const lecture = item({
    category: "Class",
    title: "Class",
    start: "14:00",
    end: "16:00",
    location: "Room 204",
  });
  const morning = item({
    title: "Breakfast",
    category: "Personal",
    start: "07:00",
    end: "07:30",
  });
  const report = analyzeShiftImpact({
    items: [original, review, assignment, lecture, morning],
    proposed: { ...original, start: "08:00", end: "12:00" },
    availability: open(),
    preferences: prefs,
    now,
  });
  assert.deepEqual(
    report.direct.map((e) => e.item.title),
    ["Exam review"],
  );
  assert.deepEqual(
    report.buffer.map((e) => e.item.title),
    ["Assignment session"],
  );
  assert.equal(report.buffer[0].requiredGap, 30);
  assert.deepEqual(
    report.cleared.map((e) => e.item.title),
    ["Class"],
  );
  assert.equal(report.counts.affected, 2);
  // Urgent deadline work is planned first, and planned blocks never collide.
  assert.equal(report.plan[0].title, "Exam review");
  const chosen = report.plan.map((p) => ok(p.result)[0].blocks[0]);
  assert.ok(!overlaps(chosen[0], chosen[1]));
  const review0 = chosen[0];
  assert.ok(`${review0.date}T${review0.end}` <= `${NEXT}T09:00`);
  for (const block of chosen) {
    assert.ok(!overlaps(block, { date: DAY, start: "07:30", end: "12:30" }));
    assert.ok(!overlaps(block, { date: DAY, start: "13:30", end: "16:30" }));
  }
});

test("4b. knock-on effects are reported as hypothetical, not as conflicts", () => {
  // Only one free hour remains before both deadlines, so recovering the
  // urgent session leaves no room for the other one.
  const original = shift({ start: "18:00", end: "21:00" });
  const first = study({
    title: "Urgent",
    start: "08:00",
    end: "09:00",
    priority: "High",
    deadline: `${DAY}T12:00`,
  });
  const second = study({
    title: "Later",
    start: "09:00",
    end: "10:00",
    deadline: `${DAY}T12:00`,
  });
  const report = analyzeShiftImpact({
    items: [original, first, second],
    proposed: { ...original, start: "08:00", end: "11:00" },
    availability: open("07:00", "22:00"),
    preferences,
    now: { date: DAY, minutes: 11 * 60 },
  });
  assert.equal(report.direct.length, 2);
  assert.equal(report.plan[0].result.status, "OK");
  assert.equal(report.plan[1].result.status, "NO_FEASIBLE_SLOT");
  assert.equal(report.knockOn.length, 1);
  assert.match(report.knockOn[0].message, /no time is left for Later/);
});

test("5. no valid replacement time returns NO_FEASIBLE_SLOT", () => {
  const lecture = item({ category: "Class", start: "08:00", end: "18:00" });
  const session = study({
    start: "12:00",
    end: "14:00",
    deadline: `${DAY}T20:00`,
  });
  const result = generateRecovery({
    target: session,
    occurrenceDate: DAY,
    items: [lecture, session],
    availability: open("07:00", "19:00"),
    preferences,
    now,
  });
  assert.equal(result.status, "NO_FEASIBLE_SLOT");
  assert.match("reason" in result ? result.reason : "", /splittable/);
  const passed = generateRecovery({
    target: study({ deadline: `${DAY}T05:00` }),
    occurrenceDate: DAY,
    items: [],
    availability: open(),
    preferences,
    now,
  });
  assert.equal(passed.status, "NO_FEASIBLE_SLOT");
  assert.match("reason" in passed ? passed.reason : "", /already passed/);
});

test("6. a splittable study session is split into valid blocks", () => {
  const lecture = item({ category: "Class", start: "08:00", end: "18:00" });
  const session = study({
    start: "12:00",
    end: "14:00",
    deadline: `${DAY}T20:00`,
    splittable: true,
    minBlockMinutes: 60,
  });
  const items = [lecture, session];
  const options = ok(
    generateRecovery({
      target: session,
      occurrenceDate: DAY,
      items,
      availability: open("07:00", "19:00"),
      preferences,
      now,
    }),
  );
  assert.equal(options[0].kind, "split");
  assert.deepEqual(options[0].blocks, [
    { date: DAY, start: "07:00", end: "08:00" },
    { date: DAY, start: "18:00", end: "19:00" },
  ]);
  const applied = applyPlan(
    items,
    session.id,
    DAY,
    options[0].blocks,
    () => "copy-1",
  );
  assert.equal(applied.items.length, 3);
  assert.deepEqual(
    applied.items
      .filter((i) => i.category === "Study")
      .map((i) => [i.title, i.start]),
    [
      ["Study (part 1 of 2)", "07:00"],
      ["Study (part 2 of 2)", "18:00"],
    ],
  );
  // Blocks shorter than the minimum are not offered.
  const strict = generateRecovery({
    target: { ...session, minBlockMinutes: 90 },
    occurrenceDate: DAY,
    items,
    availability: open("07:00", "19:00"),
    preferences,
    now,
  });
  assert.equal(strict.status, "NO_FEASIBLE_SLOT");
  // Unsplittable sessions are never split.
  const whole = generateRecovery({
    target: { ...session, splittable: false },
    occurrenceDate: DAY,
    items,
    availability: open("07:00", "19:00"),
    preferences,
    now,
  });
  assert.equal(whole.status, "NO_FEASIBLE_SLOT");
});

test("7. a slot taken before approval fails revalidation", () => {
  const session = study({ start: "09:00", end: "10:00" });
  const busy = shift({ start: "08:00", end: "12:00" });
  const items = [busy, session];
  const [option] = ok(
    generateRecovery({
      target: session,
      occurrenceDate: DAY,
      items,
      availability: open(),
      preferences,
      now,
    }),
  );
  const input = {
    target: session,
    occurrenceDate: DAY,
    availability: open(),
    preferences,
    now,
    blocks: option.blocks,
  };
  assert.equal(validatePlan({ ...input, items }), null);
  const intruder = item({ title: "Dentist", ...option.blocks[0] });
  assert.match(
    validatePlan({ ...input, items: [...items, intruder] }) ?? "",
    /conflicts/,
  );
  // Time passing also makes a suggestion stale.
  const later = { date: option.blocks[0].date, minutes: 23 * 60 };
  assert.ok(validatePlan({ ...input, items, now: later }));
});

test("8. fixed events cannot be moved through recovery or approval", () => {
  const lecture = item({ category: "Class", start: "09:00", end: "11:00" });
  const result = generateRecovery({
    target: lecture,
    occurrenceDate: DAY,
    items: [lecture],
    availability: open(),
    preferences,
    now,
  });
  assert.equal(result.status, "NOT_MOVABLE");
  assert.match(
    validatePlan({
      target: lecture,
      occurrenceDate: DAY,
      items: [lecture],
      availability: open(),
      preferences,
      now,
      blocks: [{ date: DAY, start: "15:00", end: "17:00" }],
    }) ?? "",
    /fixed/,
  );
});

test("recommendations respect deadlines, availability, and return at most three", () => {
  const session = study({
    start: "09:00",
    end: "10:00",
    deadline: `${NEXT}T12:00`,
  });
  const busy = shift({ start: "07:00", end: "15:00" });
  const options = ok(
    generateRecovery({
      target: session,
      occurrenceDate: DAY,
      items: [busy, session],
      availability: open("07:00", "21:00"),
      preferences,
      now,
    }),
  );
  assert.equal(options.length, 3);
  for (const { blocks } of options) {
    const [block] = blocks;
    assert.ok(`${block.date}T${block.end}` <= `${NEXT}T12:00`);
    assert.ok(block.start >= "07:00" && block.end <= "21:00");
    assert.ok(!overlaps(block, { date: DAY, start: "07:00", end: "15:00" }));
  }
  for (let i = 1; i < options.length; i++)
    assert.ok(options[i - 1].score >= options[i].score);
});

test("score weights are configurable and only rank already-valid slots", () => {
  const session = study({ start: "09:00", end: "10:00" });
  const busy = shift({ start: "08:00", end: "12:00" });
  const run = (prefs: Preferences) =>
    ok(
      generateRecovery({
        target: session,
        occurrenceDate: DAY,
        items: [busy, session],
        availability: open(),
        preferences: prefs,
        now,
      }),
    )[0].blocks[0];
  const evening = run({
    ...preferences,
    preferredPeriod: "Evening",
    recoveryWeights: {
      deadline: 0,
      preference: 1,
      closeness: 0,
      breakTravel: 0,
    },
  });
  assert.ok(evening.start >= "17:00");
  const close = run({
    ...preferences,
    preferredPeriod: "Evening",
    recoveryWeights: {
      deadline: 0,
      preference: 0,
      closeness: 1,
      breakTravel: 0,
    },
  });
  assert.equal(close.date, DAY);
  assert.ok(close.start < "17:00");
  assert.ok(!overlaps(close, { date: DAY, start: "08:00", end: "12:00" }));
});

test("travel time is required only between different in-person places", () => {
  const prefs = { ...preferences, travelMinutes: 30 };
  const work = shift({ start: "08:00", end: "12:00", location: "Main Branch" });
  const report = (location: string) =>
    analyzeShiftImpact({
      items: [work, study({ start: "12:15", end: "13:00", location })],
      proposed: work,
      availability: open(),
      preferences: prefs,
      now,
    }).buffer.length;
  assert.equal(report("Library"), 1);
  assert.equal(report("Online"), 0);
  assert.equal(report("main branch"), 0);
});

test("recovering one recurring occurrence keeps the rest of the series", () => {
  const weekly = study({ repeat: "Weekly", start: "09:00", end: "10:00" });
  const applied = applyPlan(
    [weekly],
    weekly.id,
    DAY,
    [{ date: DAY, start: "18:00", end: "19:00" }],
    () => "moved",
  );
  const series = applied.items.find((i) => i.id === weekly.id)!;
  assert.deepEqual(series.exceptions, [DAY]);
  const moved = applied.items.find((i) => i.id === "moved")!;
  assert.equal(moved.repeat, "Never");
  assert.equal(moved.start, "18:00");
  assert.deepEqual(applied.created, ["moved"]);
});

test("time zones: stored UTC instants round-trip to local wall time", () => {
  assert.equal(
    zonedToUtc(DAY, "09:00", "Asia/Manila").toISOString(),
    "2026-10-12T01:00:00.000Z",
  );
  assert.deepEqual(utcToZoned("2026-10-12T01:00:00.000Z", "Asia/Manila"), {
    date: DAY,
    time: "09:00",
  });
  assert.equal(
    zonedToUtc("2026-07-01", "09:00", "America/New_York").toISOString(),
    "2026-07-01T13:00:00.000Z",
  );
  assert.equal(
    zonedToUtc("2026-12-01", "09:00", "America/New_York").toISOString(),
    "2026-12-01T14:00:00.000Z",
  );
  // 02:30 does not exist on spring-forward day; it moves past the gap.
  assert.deepEqual(
    utcToZoned(
      zonedToUtc("2026-03-08", "02:30", "America/New_York"),
      "America/New_York",
    ),
    { date: "2026-03-08", time: "03:30" },
  );
  assert.deepEqual(utcToZoned("2026-10-12T16:30:00.000Z", "Asia/Manila"), {
    date: NEXT,
    time: "00:30",
  });
});
