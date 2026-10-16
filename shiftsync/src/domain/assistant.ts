// Deterministic helpers for CalenBud. The AI writes the words; these decide
// what is actually free and which proposed changes are allowed.
import type { AvailabilityDay, Preferences, ScheduleItem, Slot } from "./types";
import type { ChatAction } from "./contract";
import {
  addDays,
  blocksTime,
  itemsOnDate,
  minutes,
  parseDate,
  timeKey,
} from "./schedule";
import { breakMinutes } from "./policy";
import type { LocalNow } from "./recovery";

/** Free windows inside availability, keeping the student's break time. */
export function freeTime(
  items: ScheduleItem[],
  availability: AvailabilityDay[],
  preferences: Preferences,
  now: LocalNow,
  days = 3,
  shortest = 30,
): Slot[] {
  const result: Slot[] = [];
  const gap = breakMinutes(preferences);
  for (let n = 0; n < days; n++) {
    const date = addDays(now.date, n);
    const day = availability.find(
      (value) => value.day === parseDate(date).getDay(),
    );
    if (!day?.enabled) continue;
    let cursor = minutes(day.start);
    if (date === now.date)
      cursor = Math.max(cursor, Math.ceil(now.minutes / 15) * 15);
    const end = minutes(day.end);
    const busy = itemsOnDate(items, date)
      .filter(blocksTime)
      .map((item) => [minutes(item.start) - gap, minutes(item.end) + gap])
      .sort((a, b) => a[0] - b[0]);
    for (const [from, to] of [...busy, [end, end]]) {
      const stop = Math.min(from, end);
      if (stop - cursor >= shortest)
        result.push({ date, start: timeKey(cursor), end: timeKey(stop) });
      cursor = Math.max(cursor, to);
      if (cursor >= end) break;
    }
  }
  return result;
}

const toMinutes = (hour: number, minute: number, meridiem?: string) =>
  ((meridiem ? hour % 12 : hour) + (meridiem?.toLowerCase() === "p" ? 12 : 0)) *
    60 +
  minute;
/** Clock times written in text ("10am", "2:30 pm", "14:00", "noon"). */
export function parseTimes(text: string): number[] {
  const found: number[] = [];
  const ranged = text.replace(
    /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(?:-|–|to)\s*(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?\s*m\b\.?/gi,
    (_match, h1, m1, h2, m2, meridiem: string) => {
      const second = toMinutes(Number(h2), Number(m2 ?? 0), meridiem);
      let first = toMinutes(Number(h1), Number(m1 ?? 0), meridiem);
      // "10 to 2pm" means 10am: the start cannot be after the end.
      if (first >= second)
        first = toMinutes(
          Number(h1),
          Number(m1 ?? 0),
          meridiem.toLowerCase() === "p" ? "a" : "p",
        );
      found.push(first, second);
      return " ";
    },
  );
  const rest = ranged.replace(
    /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?\s*m\b\.?/gi,
    (_match, hour, minute, meridiem: string) => {
      found.push(toMinutes(Number(hour), Number(minute ?? 0), meridiem));
      return " ";
    },
  );
  for (const match of rest.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g))
    found.push(Number(match[1]) * 60 + Number(match[2]));
  if (/\bnoon\b/i.test(rest)) found.push(12 * 60);
  if (/\bmidnight\b/i.test(rest)) found.push(0);
  return [...new Set(found)];
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const pad = (value: number) => String(value).padStart(2, "0");
/** Calendar dates a message refers to, relative to `today`. */
export function parseDates(text: string, today: string): string[] {
  const found = new Set<string>();
  const lower = text.toLowerCase();
  if (/\bday after tomorrow\b/.test(lower)) found.add(addDays(today, 2));
  else if (/\btomorrow\b/.test(lower)) found.add(addDays(today, 1));
  if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(lower))
    found.add(today);
  const todayDay = parseDate(today).getDay();
  for (const match of lower.matchAll(
    /\b(next\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/g,
  )) {
    const target = WEEKDAYS.indexOf(match[2]);
    let ahead = (target - todayDay + 7) % 7;
    if (match[1] && ahead === 0) ahead = 7;
    found.add(addDays(today, ahead));
  }
  const year = Number(today.slice(0, 4));
  const add = (month: number, day: number) => {
    if (month < 1 || month > 12 || day < 1 || day > 31) return;
    let date = `${year}-${pad(month)}-${pad(day)}`;
    if (addDays(date, 0) !== date) return;
    // A date well in the past most likely means next year.
    if (date < addDays(today, -30))
      date = `${year + 1}-${pad(month)}-${pad(day)}`;
    found.add(date);
  };
  for (const match of lower.matchAll(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/g,
  ))
    add(MONTHS.indexOf(match[1]) + 1, Number(match[2]));
  for (const match of lower.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g))
    add(Number(match[1]), Number(match[2]));
  return [...found].sort();
}

/**
 * Accepts an AI-proposed shift change only if it is grounded in what the
 * student wrote: the start time must appear in the message, the end time
 * comes from the message or keeps the shift's length, and the date is one
 * the message names (or the shift's own date). Nothing is saved here; the
 * app opens Shift Impact for the student to review.
 */
export function validateShiftChange(
  raw: { shiftId?: unknown; date?: unknown; start?: unknown; end?: unknown },
  items: ScheduleItem[],
  userText: string,
  today: string,
): Extract<ChatAction, { type: "change_shift" }> | null {
  const shift = items.find(
    (item) =>
      item.id === raw.shiftId &&
      item.kind === "shift" &&
      item.status !== "Cancelled",
  );
  // Recurring shifts are edited as a series in the shift editor instead.
  if (!shift || shift.repeat !== "Never") return null;
  const valid = (value: unknown): value is string =>
    typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!valid(raw.start)) return null;
  const said = parseTimes(userText);
  const start = minutes(raw.start);
  if (!said.includes(start)) return null;
  const length = minutes(shift.end) - minutes(shift.start);
  const end =
    valid(raw.end) &&
    said.includes(minutes(raw.end)) &&
    minutes(raw.end) > start
      ? minutes(raw.end)
      : start + length;
  if (end > 23 * 60 + 59) return null;
  const dates = new Set(parseDates(userText, today));
  if (shift.date >= today) dates.add(shift.date);
  if (typeof raw.date !== "string" || !dates.has(raw.date) || raw.date < today)
    return null;
  const next = { date: raw.date, start: timeKey(start), end: timeKey(end) };
  if (
    next.date === shift.date &&
    next.start === shift.start &&
    next.end === shift.end
  )
    return null;
  return {
    type: "change_shift",
    shiftId: shift.id,
    title: shift.title,
    ...next,
  };
}

const CATEGORIES = [
  "Work",
  "Class",
  "Study",
  "Personal",
  "Important",
  "Other",
] as const;
type Category = (typeof CATEGORIES)[number];
// Checked in order: "review for the math exam" is studying, not a class, and
// "work on my essay" is not a job.
const CATEGORY_WORDS: [Category, RegExp][] = [
  [
    "Study",
    /\b(?:study|studying|review|reviewing|reviewer|homework|assignment|essay|report|thesis|research|reading|aral)\b/i,
  ],
  [
    "Class",
    /\b(?:class(?:es)?|lecture|lab|laboratory|seminar|tutorial|recitation|quiz|exam|midterms?|finals?|course|subject|klase)\b/i,
  ],
  [
    "Work",
    /\b(?:shift|duty|job|part[- ]?time|ojt|internship|trabaho|work(?!\s+on\b))\b/i,
  ],
  // A course code such as "CS 101" or "MATH21".
  ["Class", /\b[A-Z]{2,5}\s?\d{2,3}[A-Z]?\b/],
];
/** The category a title or message clearly names, if any. */
export function categoryFromText(text: string): Category | null {
  return CATEGORY_WORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}
const validTime = (value: unknown): value is string =>
  typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const cleanTitle = (value: unknown, max = 80) =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";

/**
 * A new item the student asked for. The date and start time must come from
 * what they wrote (this message or the last few), never from the model alone.
 * The end time is theirs if stated, otherwise the default duration.
 */
export function validateAddItem(
  raw: Record<string, unknown>,
  userText: string,
  today: string,
  defaultDuration: number,
): Extract<ChatAction, { type: "add_item" }> | null {
  const title = cleanTitle(raw.title);
  if (title.length < 2 || /https?:\/\/|@/.test(title)) return null;
  if (!validTime(raw.start) || typeof raw.date !== "string") return null;
  if (raw.date < today || !parseDates(userText, today).includes(raw.date))
    return null;
  const said = parseTimes(userText);
  const start = minutes(raw.start);
  if (!said.includes(start)) return null;
  const stated =
    validTime(raw.end) &&
    said.includes(minutes(raw.end)) &&
    minutes(raw.end) > start
      ? minutes(raw.end)
      : null;
  const end = stated ?? start + Math.max(15, defaultDuration || 60);
  if (end > 23 * 60 + 59) return null;
  // What the title says wins over the model, which often leaves a class or a
  // shift as "Personal"; the student's own words fill in after that.
  const named = categoryFromText(title);
  const kind =
    raw.kind === "task" || raw.kind === "shift"
      ? raw.kind
      : named === "Work"
        ? "shift"
        : "event";
  const category =
    kind === "shift"
      ? "Work"
      : (named ??
        CATEGORIES.find((value) => value === raw.category) ??
        categoryFromText(userText) ??
        (kind === "task" ? "Important" : "Personal"));
  return {
    type: "add_item",
    kind,
    title,
    date: raw.date,
    start: timeKey(start),
    end: timeKey(end),
    category,
    location: cleanTitle(raw.location, 80),
  };
}

/** How a proposed addition is described to the student, e.g. "Class". */
export const addLabel = (
  action: Extract<ChatAction, { type: "add_item" }>,
) =>
  action.kind === "shift"
    ? "Work shift"
    : action.kind === "task"
      ? `${action.category} task`
      : action.category;

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
/**
 * Removing is destructive, so the item must exist, must not be a repeating
 * series (those are edited in the item screen), and the student's message
 * must name it by a word from its title or by its date.
 */
export function validateRemoveItem(
  raw: Record<string, unknown>,
  items: ScheduleItem[],
  userText: string,
  today: string,
): Extract<ChatAction, { type: "remove_item" }> | null {
  const item = items.find(
    (value) => value.id === raw.itemId && value.status !== "Cancelled",
  );
  if (!item || item.repeat !== "Never") return null;
  const said = new Set(words(userText));
  const named = words(item.title).some((word) => said.has(word));
  const dated = parseDates(userText, today).includes(item.date);
  if (!named && !dated) return null;
  return {
    type: "remove_item",
    itemId: item.id,
    title: item.title,
    date: item.date,
    start: item.start,
    end: item.end,
  };
}
