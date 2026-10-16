import { test } from "node:test";
import assert from "node:assert/strict";
import {
  categoryFromText,
  freeTime,
  parseDates,
  parseTimes,
  validateAddItem,
  validateShiftChange,
} from "../src/domain/assistant";
import { defaultPreferences } from "../src/domain/seed";
import type { ScheduleItem } from "../src/domain/types";

const TODAY = "2026-10-12"; // a Monday
const item = (values: Partial<ScheduleItem>): ScheduleItem => ({
  id: "x",
  kind: "event",
  title: "Event",
  date: TODAY,
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
const shift = item({
  id: "shift-1",
  kind: "shift",
  category: "Work",
  title: "Evening shift",
  date: "2026-10-13",
  start: "16:00",
  end: "20:00",
});

test("times written in messages are recognised", () => {
  assert.deepEqual(parseTimes("moved to 10am"), [600]);
  assert.deepEqual(parseTimes("from 2:30 pm"), [870]);
  assert.deepEqual(parseTimes("10 to 2pm").sort(), [600, 840]);
  assert.deepEqual(parseTimes("9-11am").sort(), [540, 660]);
  assert.deepEqual(parseTimes("at 14:00 or noon").sort(), [720, 840]);
  assert.deepEqual(parseTimes("12am and 12pm").sort(), [0, 720]);
  assert.deepEqual(parseTimes("I have 3 classes"), []);
});

test("dates are resolved relative to today", () => {
  assert.deepEqual(parseDates("my shift tomorrow", TODAY), ["2026-10-13"]);
  assert.deepEqual(parseDates("day after tomorrow", TODAY), ["2026-10-14"]);
  assert.deepEqual(parseDates("tonight", TODAY), [TODAY]);
  assert.deepEqual(parseDates("on Friday", TODAY), ["2026-10-16"]);
  assert.deepEqual(parseDates("this monday", TODAY), [TODAY]);
  assert.deepEqual(parseDates("next monday", TODAY), ["2026-10-19"]);
  assert.deepEqual(parseDates("Oct 20 or 10/21", TODAY), [
    "2026-10-20",
    "2026-10-21",
  ]);
  assert.deepEqual(parseDates("January 5", TODAY), ["2027-01-05"]);
  assert.deepEqual(parseDates("Feb 30", TODAY), []);
});

test("free time respects availability, commitments, breaks and the clock", () => {
  const preferences = { ...defaultPreferences(), bufferMinutes: 15 };
  const availability = Array.from({ length: 7 }, (_, day) => ({
    day,
    enabled: true,
    start: "08:00",
    end: "18:00",
  }));
  const busy = [
    item({ start: "10:00", end: "12:00" }),
    item({ id: "y", kind: "task", start: "13:00", end: "14:00" }),
  ];
  const slots = freeTime(
    busy,
    availability,
    preferences,
    { date: TODAY, minutes: 8 * 60 + 5 },
    1,
  );
  assert.deepEqual(slots, [
    { date: TODAY, start: "08:15", end: "09:45" },
    { date: TODAY, start: "12:15", end: "18:00" },
  ]);
});

test("AI shift changes are accepted only when grounded in the student's words", () => {
  const items = [shift];
  const text = "My shift tomorrow moved to 10am";
  assert.deepEqual(
    validateShiftChange(
      { shiftId: "shift-1", date: "2026-10-13", start: "10:00", end: "14:00" },
      items,
      text,
      TODAY,
    ),
    {
      type: "change_shift",
      shiftId: "shift-1",
      title: "Evening shift",
      date: "2026-10-13",
      start: "10:00",
      end: "14:00",
    },
  );
  // An end time the student never said is replaced by the shift's length.
  assert.equal(
    validateShiftChange(
      { shiftId: "shift-1", date: "2026-10-13", start: "10:00", end: "18:00" },
      items,
      text,
      TODAY,
    )?.end,
    "14:00",
  );
  // An invented start time, unknown shift, unmentioned date or past date is refused.
  assert.equal(
    validateShiftChange(
      { shiftId: "shift-1", date: "2026-10-13", start: "11:00" },
      items,
      text,
      TODAY,
    ),
    null,
  );
  assert.equal(
    validateShiftChange(
      { shiftId: "nope", date: "2026-10-13", start: "10:00" },
      items,
      text,
      TODAY,
    ),
    null,
  );
  assert.equal(
    validateShiftChange(
      { shiftId: "shift-1", date: "2026-10-15", start: "10:00" },
      items,
      text,
      TODAY,
    ),
    null,
  );
  assert.equal(
    validateShiftChange(
      { shiftId: "shift-1", date: "2026-10-13", start: "10:00" },
      [{ ...shift, repeat: "Weekly" }],
      text,
      TODAY,
    ),
    null,
  );
  // Without a date in the message, the shift's own date is used.
  assert.equal(
    validateShiftChange(
      { shiftId: "shift-1", date: "2026-10-13", start: "08:00" },
      items,
      "it starts at 8am now",
      TODAY,
    )?.start,
    "08:00",
  );
});

test("activities are sorted into the category they name", () => {
  assert.equal(categoryFromText("Math class"), "Class");
  assert.equal(categoryFromText("CS 101"), "Class");
  assert.equal(categoryFromText("Physics lab"), "Class");
  assert.equal(categoryFromText("Midterm exam"), "Class");
  assert.equal(categoryFromText("Review for the math exam"), "Study");
  assert.equal(categoryFromText("Work shift at Jollibee"), "Work");
  assert.equal(categoryFromText("OJT"), "Work");
  assert.equal(categoryFromText("Work on my essay"), "Study");
  assert.equal(categoryFromText("Dentist appointment"), null);
});

test("added items get the kind and category of the activity", () => {
  const add = (raw: Record<string, unknown>, text: string) =>
    validateAddItem(
      { date: "2026-10-13", start: "08:00", ...raw },
      `${text} tomorrow at 8am`,
      TODAY,
      60,
    );
  // The model left a class as the default "Personal".
  const lesson = add(
    { title: "Math class", kind: "event", category: "Personal" },
    "add my math class",
  );
  assert.equal(lesson?.kind, "event");
  assert.equal(lesson?.category, "Class");
  // The model called a shift an event.
  const work = add(
    { title: "Shift at Jollibee", kind: "event" },
    "I have a shift at Jollibee",
  );
  assert.equal(work?.kind, "shift");
  assert.equal(work?.category, "Work");
  // The title is bare but the student said what it is.
  assert.equal(
    add({ title: "Calculus" }, "add calculus class")?.category,
    "Class",
  );
  // The model's category stands when the title says nothing either way.
  assert.equal(
    add({ title: "Calculus", category: "Study" }, "calculus")?.category,
    "Study",
  );
  assert.equal(add({ title: "Dentist" }, "dentist")?.category, "Personal");
  const due = add({ title: "Submit lab report", kind: "task" }, "submit");
  assert.equal(due?.kind, "task");
  assert.equal(due?.category, "Study");
});
