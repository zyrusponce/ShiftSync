import type {
  ScheduleItem,
  AvailabilityDay,
  Preferences,
  Conflict,
  Slot,
} from "./types";

export const dateKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const parseDate = (date: string) => new Date(`${date}T12:00:00`);
export function addDays(date: string, days: number): string {
  const value = parseDate(date);
  value.setDate(value.getDate() + days);
  return dateKey(value);
}
export const minutes = (time: string) =>
  Number(time.split(":")[0]) * 60 + Number(time.split(":")[1]);
export const timeKey = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
export function formatTime(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}
export const formatDate = (date: string, short = false) =>
  parseDate(date).toLocaleDateString("en-US", {
    weekday: short ? "short" : "long",
    month: short ? "short" : "long",
    day: "numeric",
  });
const active = (item: ScheduleItem) =>
  item.status !== "Cancelled" && !item.completed;
const blocksTime = (item: ScheduleItem) => active(item) && item.kind !== "task";

export function validateItem(item: ScheduleItem): string | null {
  if (!item.title.trim()) return "Give this a title so it is easy to find.";
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(item.date) ||
    Number.isNaN(parseDate(item.date).getTime()) ||
    dateKey(parseDate(item.date)) !== item.date
  )
    return "Choose a valid date.";
  if (
    ![item.start, item.end].every((time) =>
      /^([01]\d|2[0-3]):[0-5]\d$/.test(time),
    )
  )
    return "Choose valid start and end times.";
  if (minutes(item.end) <= minutes(item.start))
    return "End time must be after start time. Split overnight shifts into two days.";
  return null;
}
export function occursOn(item: ScheduleItem, date: string): boolean {
  if (
    item.date > date ||
    item.status === "Cancelled" ||
    item.exceptions?.includes(date)
  )
    return false;
  if (item.date === date) return true;
  if (item.repeat === "Daily") return true;
  return (
    item.repeat === "Weekly" &&
    parseDate(item.date).getDay() === parseDate(date).getDay()
  );
}
export function itemsOnDate(
  items: ScheduleItem[],
  date: string,
): ScheduleItem[] {
  return items
    .filter((item) => occursOn(item, date))
    .sort((a, b) => a.start.localeCompare(b.start));
}
export function findConflicts(
  items: ScheduleItem[],
  availability: AvailabilityDay[],
  preferences: Preferences,
  from: string,
  days = 14,
): Conflict[] {
  const result: Conflict[] = [];
  for (let n = 0; n < days; n++) {
    const date = addDays(from, n);
    const events = itemsOnDate(items, date).filter(blocksTime);
    const available = availability.find(
      (day) => day.day === parseDate(date).getDay(),
    );
    events.forEach((first, i) => {
      if (
        first.kind !== "unavailable" &&
        (!available?.enabled ||
          minutes(first.start) < minutes(available.start) ||
          minutes(first.end) > minutes(available.end))
      ) {
        result.push({
          id: `${date}:${first.id}:availability`,
          date,
          first,
          severity: "Low",
          minutes: 0,
          reason: "This event is outside your availability.",
        });
      }
      events.slice(i + 1).forEach((second) => {
        if (first.kind === "unavailable" && second.kind === "unavailable")
          return;
        const intersection =
          Math.min(minutes(first.end), minutes(second.end)) -
          Math.max(minutes(first.start), minutes(second.start));
        const id = `${date}:${[first.id, second.id].sort().join(":")}`;
        if (intersection > 0)
          result.push({
            id,
            date,
            first,
            second,
            severity: "High",
            minutes: intersection,
            reason: `These events overlap by ${intersection} minute${intersection === 1 ? "" : "s"}.`,
          });
        else {
          const gap = minutes(second.start) - minutes(first.end);
          const buffer = Math.max(
            preferences.bufferMinutes,
            preferences.avoidBackToBack ? 15 : 0,
          );
          if (
            gap >= 0 &&
            gap < buffer &&
            first.kind !== "unavailable" &&
            second.kind !== "unavailable"
          )
            result.push({
              id,
              date,
              first,
              second,
              severity: "Medium",
              minutes: gap,
              reason: `Only ${gap} minutes between events. You prefer a ${buffer}-minute buffer.`,
            });
        }
      });
    });
  }
  return result.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      { High: 0, Medium: 1, Low: 2 }[a.severity] -
        { High: 0, Medium: 1, Low: 2 }[b.severity],
  );
}
export function suggestSlots(
  item: ScheduleItem,
  items: ScheduleItem[],
  availability: AvailabilityDay[],
  preferences: Preferences,
  from: string,
  count = 3,
  now = new Date(),
): Slot[] {
  const slots: Slot[] = [];
  const duration = minutes(item.end) - minutes(item.start);
  if (duration <= 0 || !Number.isFinite(duration) || count < 1) return slots;
  const buffer = Math.max(
    preferences.bufferMinutes,
    preferences.avoidBackToBack ? 15 : 0,
  );
  const today = dateKey(now);
  const searchFrom = from < today ? today : from;
  const otherItems = items.filter((value) => value.id !== item.id);
  for (let n = 0; n < 14 && slots.length < count; n++) {
    const date = addDays(searchFrom, n);
    const day = availability.find(
      (value) => value.day === parseDate(date).getDay(),
    );
    if (!day?.enabled) continue;
    const commitments = itemsOnDate(otherItems, date).filter(blocksTime);
    let first = minutes(day.start);
    if (date === today)
      first = Math.max(
        first,
        now.getHours() * 60 + now.getMinutes() + (now.getSeconds() > 0 ? 1 : 0),
      );
    let last = minutes(day.end);
    if (preferences.preferredPeriod === "Morning")
      last = Math.min(last, 12 * 60);
    if (preferences.preferredPeriod === "Evening")
      first = Math.max(first, 17 * 60);
    for (
      let start = Math.ceil(first / 15) * 15;
      start + duration <= last && slots.length < count;
      start += 15
    ) {
      const end = start + duration;
      if (
        commitments.some(
          (value) =>
            start < minutes(value.end) + buffer &&
            end + buffer > minutes(value.start),
        )
      )
        continue;
      if (item.repeat !== "Never") {
        const candidate = {
          ...item,
          date,
          start: timeKey(start),
          end: timeKey(end),
        };
        if (
          findConflicts(
            [...otherItems, candidate],
            availability,
            preferences,
            date,
            14,
          ).some(
            (conflict) =>
              conflict.first.id === item.id || conflict.second?.id === item.id,
          )
        )
          continue;
      }
      slots.push({ date, start: timeKey(start), end: timeKey(end) });
      start += Math.max(0, duration - 15);
    }
  }
  return slots;
}
export function searchItems(
  items: ScheduleItem[],
  query: string,
): ScheduleItem[] {
  const needle = query.trim().toLowerCase();
  return items
    .filter((item) =>
      [
        item.title,
        item.date,
        formatDate(item.date),
        item.location,
        item.notes,
        item.kind,
        item.category,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    )
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start),
    );
}
export function rescheduleOccurrence(
  items: ScheduleItem[],
  id: string,
  occurrenceDate: string,
  slot: Slot,
  newId: string,
): ScheduleItem[] {
  const original = items.find((item) => item.id === id);
  if (!original || !occursOn(original, occurrenceDate))
    throw new Error("This occurrence is no longer on your schedule.");
  const moved = {
    ...original,
    ...slot,
    repeat: "Never" as const,
    exceptions: [],
  };
  const error = validateItem(moved);
  if (error) throw new Error(error);
  if (original.repeat === "Never")
    return items.map((item) => (item.id === id ? moved : item));
  if (!newId.trim() || items.some((item) => item.id === newId))
    throw new Error("Please try moving this event again.");
  return [
    ...items.map((item) =>
      item.id === id
        ? {
            ...item,
            exceptions: [
              ...new Set([...(item.exceptions ?? []), occurrenceDate]),
            ],
          }
        : item,
    ),
    { ...moved, id: newId },
  ];
}
export function listShiftOccurrences(
  items: ScheduleItem[],
  from: string,
  days: number,
): { item: ScheduleItem; date: string }[] {
  return Array.from({ length: days }, (_, n) => addDays(from, n)).flatMap(
    (date) =>
      itemsOnDate(items, date)
        .filter((item) => item.kind === "shift")
        .map((item) => ({ item, date })),
  );
}
export function answerScheduleQuestion(
  question: string,
  items: ScheduleItem[],
  availability: AvailabilityDay[],
  preferences: Preferences,
  today = dateKey(),
  now = new Date(),
): string {
  const query = question.toLowerCase();
  if (/conflict|overlap|optimi[sz]|organize|plan.*week/.test(query)) {
    const conflicts = findConflicts(items, availability, preferences, today, 7);
    return conflicts.length
      ? `I found ${conflicts.length} scheduling issue${conflicts.length === 1 ? "" : "s"} in the next week. ${conflicts[0].first.title}: ${conflicts[0].reason} Open Conflicts to review alternatives. I will only change your schedule when you choose an option.`
      : "You are all in sync! I found no scheduling conflicts in the next week. You can add events or update your availability whenever you need.";
  }
  if (/free|better time|fit|available/.test(query)) {
    const draft: ScheduleItem = {
      id: "assistant-probe",
      kind: "event",
      title: "Meeting",
      date: today,
      start: "09:00",
      end: "10:00",
      category: "Work",
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
    };
    const requested = query.match(
      /\b(1[0-2]|[1-9])(?::([0-5]\d))?\s*(am|pm)\b/,
    );
    if (requested) {
      const hour =
        (Number(requested[1]) % 12) + (requested[3] === "pm" ? 12 : 0);
      const requestedMinutes = hour * 60 + Number(requested[2] ?? 0);
      draft.date = /tomorrow/.test(query) ? addDays(today, 1) : today;
      draft.start = timeKey(requestedMinutes);
      draft.end = timeKey(requestedMinutes + 60);
      if (validateItem(draft))
        return "That one-hour meeting would run past midnight. Choose an earlier start time or split it across two days.";
      if (new Date(`${draft.date}T${draft.start}:00`) < now)
        return "That time has already passed. Ask me for available times ahead of you.";
      const issue = findConflicts(
        [...items, draft],
        availability,
        preferences,
        draft.date,
        1,
      ).find(
        (conflict) =>
          conflict.first.id === draft.id || conflict.second?.id === draft.id,
      );
      if (issue) {
        const other = issue.first.id === draft.id ? issue.second : issue.first;
        return `A one-hour meeting at ${formatTime(draft.start)} on ${formatDate(draft.date, true)} needs another time. ${other ? `${other.title}: ` : ""}${issue.reason} Ask “When am I free?” for alternatives. Nothing has been added to your schedule.`;
      }
      return `You have room for a one-hour meeting at ${formatTime(draft.start)} on ${formatDate(draft.date, true)}. It fits your availability and existing commitments. This is a suggestion; use Add Event to save it.`;
    }
    const slots = suggestSlots(
      draft,
      items,
      availability,
      preferences,
      today,
      3,
      now,
    );
    return slots.length
      ? `Here are available one-hour options based on your availability and buffer time:\n\n${slots.map((slot) => `${formatDate(slot.date, true)} · ${formatTime(slot.start)}–${formatTime(slot.end)}`).join("\n")}\n\nThese are suggestions. Use Add Event to choose a time.`
      : "I could not find an available hour in the next two weeks with your current preferences. Try a shorter event or adjust your availability.";
  }
  if (/weekend|week/.test(query)) {
    const days = Array.from({ length: 7 }, (_, n) => addDays(today, n));
    const events = days.flatMap((date) =>
      itemsOnDate(items, date)
        .filter(
          (value) =>
            value.kind !== "unavailable" &&
            !value.completed &&
            (!/shift/.test(query) || value.kind === "shift") &&
            (!/weekend/.test(query) ||
              [0, 6].includes(parseDate(date).getDay())),
        )
        .map((value) => ({ value, date })),
    );
    return events.length
      ? `Here is your ${/weekend/.test(query) ? "upcoming weekend" : "next seven days"}:\n\n${events
          .slice(0, 10)
          .map(
            ({ value, date }) =>
              `${formatDate(date, true)} · ${value.title}, ${formatTime(value.start)}`,
          )
          .join("\n")}`
      : "Your schedule is clear for that period.";
  }
  if (/today|tomorrow|schedule|what do|what.*have/.test(query)) {
    const date = /tomorrow/.test(query) ? addDays(today, 1) : today;
    const events = itemsOnDate(items, date).filter(
      (value) => value.kind !== "unavailable" && !value.completed,
    );
    return events.length
      ? `${formatDate(date)}:\n\n${events.map((value) => `${value.title} · ${formatTime(value.start)}–${formatTime(value.end)}`).join("\n")}`
      : `Your calendar is clear on ${formatDate(date)}. A little breathing room!`;
  }
  return "I can check your saved schedule, find conflicts, and suggest available one-hour times. Try “What do I have tomorrow?” or “When am I free?” For now, I use local scheduling rules rather than a connected AI service.";
}
