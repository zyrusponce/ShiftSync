import { test } from "node:test";
import assert from "node:assert/strict";
import {
  answerScheduleQuestion,
  findConflicts,
  itemsOnDate,
  listShiftOccurrences,
  rescheduleOccurrence,
  searchItems,
  suggestSlots,
  validateItem,
  setTaskOccurrenceCompleted,
  listTaskOccurrences,
  setItemRepeat,
} from "../src/domain/schedule";
import type {
  AvailabilityDay,
  Preferences,
  ScheduleItem,
} from "../src/domain/types";

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
const availability: AvailabilityDay[] = Array.from({ length: 7 }, (_, day) => ({
  day,
  enabled: day !== 0,
  start: "08:00",
  end: "18:00",
}));
const clock = new Date("2026-10-08T00:00:00");
const item = (values: Partial<ScheduleItem> = {}): ScheduleItem => ({
  id: "one",
  kind: "event",
  title: "Meeting",
  date: "2026-10-08",
  start: "09:00",
  end: "10:00",
  category: "Work",
  location: "",
  notes: "",
  participants: "",
  reminder: "15 minutes before",
  repeat: "Never",
  priority: "Medium",
  completed: false,
  status: "Confirmed",
  position: "",
  swapRequested: false,
  ...values,
});

test("overlap reports the exact intersection of two appointments", () => {
  const conflicts = findConflicts(
    [item({ end: "11:00" }), item({ id: "two", start: "10:00", end: "12:00" })],
    availability,
    preferences,
    "2026-10-08",
    1,
  );
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].severity, "High");
  assert.equal(conflicts[0].minutes, 60);
});
test("appointments touching at the boundary do not overlap", () => {
  assert.deepEqual(
    findConflicts(
      [item(), item({ id: "two", start: "10:00", end: "11:00" })],
      availability,
      preferences,
      "2026-10-08",
      1,
    ),
    [],
  );
});
test("buffer preference catches a short gap without calling it an overlap", () => {
  const conflicts = findConflicts(
    [item(), item({ id: "two", start: "10:05", end: "11:00" })],
    availability,
    { ...preferences, bufferMinutes: 15 },
    "2026-10-08",
    1,
  );
  assert.equal(conflicts[0].severity, "Medium");
  assert.equal(conflicts[0].minutes, 5);
});
test("tasks and cancelled shifts do not block appointments", () => {
  assert.deepEqual(
    findConflicts(
      [
        item(),
        item({ id: "task", kind: "task" }),
        item({ id: "cancelled", kind: "shift", status: "Cancelled" }),
      ],
      availability,
      preferences,
      "2026-10-08",
      1,
    ),
    [],
  );
});
test("weekly events appear on the correct weekday, never before their start", () => {
  const weekly = item({ repeat: "Weekly" });
  assert.equal(itemsOnDate([weekly], "2026-10-15").length, 1);
  assert.equal(itemsOnDate([weekly], "2026-10-14").length, 0);
  assert.equal(itemsOnDate([weekly], "2026-10-01").length, 0);
});
test("daily recurrence crosses month boundaries", () => {
  assert.equal(
    itemsOnDate([item({ date: "2026-10-31", repeat: "Daily" })], "2026-11-01")
      .length,
    1,
  );
});
test("unavailable days are reported as preference conflicts", () => {
  const result = findConflicts(
    [item({ date: "2026-10-11" })],
    availability,
    preferences,
    "2026-10-11",
    1,
  );
  assert.equal(result[0].severity, "Low");
  assert.match(result[0].reason, /availability/i);
});
test("recommendations respect occupied slots, duration, and buffer", () => {
  const moving = item({ id: "moving", start: "09:30", end: "10:30" });
  const slots = suggestSlots(
    moving,
    [item({ start: "08:00", end: "10:00" }), moving],
    availability,
    { ...preferences, bufferMinutes: 15 },
    "2026-10-08",
    1,
    clock,
  );
  assert.deepEqual(slots, [
    { date: "2026-10-08", start: "10:15", end: "11:15" },
  ]);
});
test("recommendations skip unavailable days and dates blocked by unavailable time", () => {
  const block = item({
    id: "block",
    kind: "unavailable",
    date: "2026-10-10",
    start: "08:00",
    end: "18:00",
  });
  assert.deepEqual(
    suggestSlots(
      item({ date: "2026-10-10" }),
      [block],
      availability,
      preferences,
      "2026-10-10",
      1,
      clock,
    ),
    [{ date: "2026-10-12", start: "08:00", end: "09:00" }],
  );
});
test("recommendations never mutate the source event or schedule", () => {
  const event = item();
  const original = structuredClone(event);
  suggestSlots(
    event,
    [event],
    availability,
    preferences,
    "2026-10-08",
    3,
    clock,
  );
  assert.deepEqual(event, original);
});
test("invalid times, reversed duration, blank titles, and impossible dates are rejected", () => {
  for (const values of [
    { title: "  " },
    { start: "25:00" },
    { end: "08:00" },
    { date: "2026-02-30" },
  ]) {
    assert.equal(typeof validateItem(item(values)), "string");
  }
  assert.equal(validateItem(item()), null);
});
test("search finds date, title, and location with case insensitive trimmed input", () => {
  const event = item({ title: "Team meeting", location: "Main Branch" });
  assert.equal(searchItems([event], "  TEAM ").length, 1);
  assert.equal(searchItems([event], "2026-10-08").length, 1);
  assert.equal(searchItems([event], "branch").length, 1);
  assert.equal(searchItems([event], "dentist").length, 0);
});

test("available-time recommendations exclude elapsed times today", () => {
  assert.deepEqual(
    suggestSlots(
      item(),
      [],
      availability,
      preferences,
      "2026-10-08",
      1,
      new Date("2026-10-08T15:07:00"),
    ),
    [{ date: "2026-10-08", start: "15:15", end: "16:15" }],
  );
});
test("recommendations starting on a past date skip to the current date", () => {
  assert.deepEqual(
    suggestSlots(
      item(),
      [],
      availability,
      preferences,
      "2026-10-07",
      1,
      new Date("2026-10-08T17:45:00"),
    ),
    [{ date: "2026-10-09", start: "08:00", end: "09:00" }],
  );
});
test("moving one weekly occurrence preserves the past and subsequent series", () => {
  const series = item({ repeat: "Weekly" });
  const moved = rescheduleOccurrence(
    [series],
    series.id,
    "2026-10-15",
    { date: "2026-10-16", start: "11:00", end: "12:00" },
    "moved",
  );
  assert.equal(itemsOnDate(moved, "2026-10-08").length, 1);
  assert.equal(itemsOnDate(moved, "2026-10-15").length, 0);
  assert.equal(itemsOnDate(moved, "2026-10-16")[0].start, "11:00");
  assert.equal(itemsOnDate(moved, "2026-10-22").length, 1);
  assert.equal(itemsOnDate(moved, "2026-10-23").length, 0);
  assert.equal(series.date, "2026-10-08");
});
test("moving a nonrecurring item does not create duplicates", () => {
  const moved = rescheduleOccurrence(
    [item()],
    "one",
    "2026-10-08",
    { date: "2026-10-09", start: "11:00", end: "12:00" },
    "unused",
  );
  assert.equal(moved.length, 1);
  assert.equal(moved[0].id, "one");
  assert.equal(moved[0].date, "2026-10-09");
});
test("weekly recommendations also check the next recurring occurrence", () => {
  const recurring = item({ repeat: "Weekly" });
  const busyNextWeek = item({
    id: "busy",
    date: "2026-10-15",
    start: "08:00",
    end: "10:00",
  });
  assert.deepEqual(
    suggestSlots(
      recurring,
      [busyNextWeek],
      availability,
      preferences,
      "2026-10-08",
      1,
      clock,
    ),
    [{ date: "2026-10-08", start: "10:00", end: "11:00" }],
  );
});
test("daily recommendations do not suggest series that occur on unavailable days", () => {
  assert.deepEqual(
    suggestSlots(
      item({ repeat: "Daily" }),
      [],
      availability,
      preferences,
      "2026-10-08",
      1,
      clock,
    ),
    [],
  );
});
test("recurring shifts expose upcoming and completed dated occurrences", () => {
  const shift = item({ kind: "shift", repeat: "Weekly", date: "2026-10-01" });
  assert.deepEqual(
    listShiftOccurrences([shift], "2026-10-08", 14).map((value) => value.date),
    ["2026-10-08", "2026-10-15"],
  );
  assert.deepEqual(
    listShiftOccurrences([shift], "2026-10-01", 7).map((value) => value.date),
    ["2026-10-01"],
  );
});

test("assistant answers tomorrow using saved events rather than canned schedule data", () => {
  const response = answerScheduleQuestion(
    "What do I have tomorrow?",
    [
      item({ title: "Today only" }),
      item({ id: "tomorrow", title: "Dentist", date: "2026-10-09" }),
    ],
    availability,
    preferences,
    "2026-10-08",
  );
  assert.match(response, /Dentist/);
  assert.doesNotMatch(response, /Today only/);
});
test("assistant evaluates the requested meeting time against existing commitments", () => {
  const response = answerScheduleQuestion(
    "Can I fit a meeting tomorrow at 3 PM?",
    [
      item({
        date: "2026-10-09",
        title: "Work shift",
        start: "14:00",
        end: "18:00",
      }),
    ],
    availability,
    preferences,
    "2026-10-08",
    clock,
  );
  assert.match(response, /Work shift/);
  assert.match(response, /overlap/i);
});

test("free-time questions about tomorrow never return today's slots", () => {
  const response = answerScheduleQuestion(
    "When am I free tomorrow?",
    [],
    availability,
    preferences,
    "2026-10-08",
    clock,
  );
  assert.match(response, /Fri, Oct 9/);
  assert.doesNotMatch(response, /Thu, Oct 8/);
});

test("a fully occupied requested day does not silently suggest another day", () => {
  const response = answerScheduleQuestion(
    "When am I free tomorrow?",
    [item({ date: "2026-10-09", start: "08:00", end: "18:00" })],
    availability,
    preferences,
    "2026-10-08",
    clock,
  );
  assert.match(response, /could not find an available hour.*Fri, Oct 9/i);
  assert.doesNotMatch(response, /Mon, Oct 12|Thu, Oct 8/);
});

test("completing and reopening one recurring task preserves other occurrences", () => {
  const task = item({ kind: "task", repeat: "Daily" });
  const completed = setTaskOccurrenceCompleted(task, "2026-10-08", true);
  assert.equal(itemsOnDate([completed], "2026-10-08")[0].completed, true);
  assert.equal(itemsOnDate([completed], "2026-10-09")[0].completed, false);
  const next = setTaskOccurrenceCompleted(completed, "2026-10-09", true);
  const reopened = setTaskOccurrenceCompleted(next, "2026-10-08", false);
  assert.equal(itemsOnDate([reopened], "2026-10-08")[0].completed, false);
  assert.equal(itemsOnDate([reopened], "2026-10-09")[0].completed, true);
  assert.deepEqual(task, item({ kind: "task", repeat: "Daily" }));
});

test("weekly task completion rejects dates that are not occurrences", () => {
  const task = item({ kind: "task", repeat: "Weekly" });
  assert.throws(() => setTaskOccurrenceCompleted(task, "2026-10-09", true));
  assert.equal(
    itemsOnDate(
      [setTaskOccurrenceCompleted(task, "2026-10-08", true)],
      "2026-10-15",
    )[0].completed,
    false,
  );
});

test("nonrecurring tasks keep their existing completion behavior", () => {
  const task = item({ kind: "task" });
  assert.equal(
    setTaskOccurrenceCompleted(task, task.date, true).completed,
    true,
  );
  assert.equal(
    setTaskOccurrenceCompleted({ ...task, completed: true }, task.date, false)
      .completed,
    false,
  );
});

test("task tabs show dated recurring occurrences and completion history", () => {
  const daily = setTaskOccurrenceCompleted(
    item({ kind: "task", repeat: "Daily", date: "2026-10-07" }),
    "2026-10-07",
    true,
  );
  const overdue = item({ id: "overdue", kind: "task", date: "2026-10-06" });
  const tasks = [daily, overdue];
  assert.deepEqual(
    listTaskOccurrences(tasks, "2026-10-08", "Today").map(({ date }) => date),
    ["2026-10-06", "2026-10-08"],
  );
  const upcoming = listTaskOccurrences(tasks, "2026-10-08", "Upcoming");
  assert.equal(upcoming.length, 14);
  assert.equal(upcoming[0].date, "2026-10-09");
  assert.deepEqual(
    listTaskOccurrences(tasks, "2026-10-08", "Completed").map(
      ({ date }) => date,
    ),
    ["2026-10-07"],
  );
});

test("legacy completed recurring tasks mark only their original occurrence", () => {
  const task = item({ kind: "task", repeat: "Daily", completed: true });
  assert.equal(itemsOnDate([task], task.date)[0].completed, true);
  assert.equal(itemsOnDate([task], "2026-10-09")[0].completed, false);
});

test("stopping task recurrence preserves completion of its remaining date", () => {
  const task = setTaskOccurrenceCompleted(
    item({ kind: "task", repeat: "Daily" }),
    "2026-10-08",
    true,
  );
  const oneOff = setItemRepeat(task, "Never");
  assert.equal(itemsOnDate([oneOff], "2026-10-08")[0].completed, true);
  assert.equal(
    listTaskOccurrences([oneOff], "2026-10-08", "Completed").length,
    1,
  );
  assert.deepEqual(itemsOnDate([oneOff], "2026-10-09"), []);
});

test("enabling task recurrence preserves a completed first date without completing later dates", () => {
  const series = setItemRepeat(
    item({ kind: "task", completed: true }),
    "Daily",
  );
  assert.equal(itemsOnDate([series], "2026-10-08")[0].completed, true);
  assert.equal(itemsOnDate([series], "2026-10-09")[0].completed, false);
  const uncompletedFirst = setTaskOccurrenceCompleted(
    series,
    "2026-10-08",
    false,
  );
  const completedLater = setTaskOccurrenceCompleted(
    uncompletedFirst,
    "2026-10-09",
    true,
  );
  assert.equal(setItemRepeat(completedLater, "Never").completed, false);
});
