// What ShiftSync should tell the phone's notification system. Pure functions
// only: the native side (services/notifications.ts) schedules and presents.
import {
  addDays,
  dateKey,
  formatDate,
  formatTime,
  itemsOnDate,
} from "./schedule";
import type { Conflict, Preferences, ScheduleItem } from "./types";

/** Where tapping a notification takes the student. */
export type NotificationTarget =
  | { kind: "conflict"; conflictId: string | null }
  /** A null item opens the Shifts tab (several changes, or one removed). */
  | { kind: "shift"; itemId: string | null; date: string | null }
  | { kind: "reminder"; itemId: string; date: string }
  | { kind: "sync" };

export const REMINDER_LEADS = [
  "5 minutes before",
  "15 minutes before",
  "30 minutes before",
  "1 hour before",
  "1 day before",
] as const;
/** Minutes before the start, or null for "None" and unknown values. */
export function reminderLead(reminder: string): number | null {
  const match = /^(\d+)\s+(minute|hour|day)s?\s+before$/i.exec(reminder.trim());
  if (!match) return null;
  const unit = { minute: 1, hour: 60, day: 1440 }[
    match[2].toLowerCase() as "minute" | "hour" | "day"
  ];
  return Number(match[1]) * unit;
}

export type PlannedReminder = {
  /** Stable, so an unchanged reminder is never cancelled and rescheduled. */
  id: string;
  fireAt: Date;
  title: string;
  body: string;
  target: NotificationTarget;
};
const at = (date: string, time: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  // Local wall-clock time on the phone, which follows the account time zone.
  return new Date(y, m - 1, d, hh, mm);
};
function leadText(minutes: number) {
  if (minutes % 1440 === 0)
    return minutes === 1440 ? "tomorrow" : `in ${minutes / 1440} days`;
  if (minutes % 60 === 0)
    return minutes === 60 ? "in 1 hour" : `in ${minutes / 60} hours`;
  return `in ${minutes} minutes`;
}

/**
 * Reminders to have scheduled on the phone right now, soonest first. The
 * window is short because the OS caps pending notifications (64 on iOS);
 * the plan is rebuilt whenever the schedule changes or the app opens.
 */
export function planReminders(
  items: ScheduleItem[],
  preferences: Pick<Preferences, "reminders" | "shiftNotifications">,
  now: Date,
  options: { leadOverride?: number | null; days?: number; limit?: number } = {},
): PlannedReminder[] {
  const days = options.days ?? 7;
  const until = now.getTime() + days * 86_400_000;
  const plans: PlannedReminder[] = [];
  const today = dateKey(now);
  // One extra day so "1 day before" reminders near the window edge count.
  for (let n = 0; n <= days + 1; n++) {
    const date = addDays(today, n);
    for (const item of itemsOnDate(items, date)) {
      if (item.kind === "unavailable" || item.completed) continue;
      if (
        item.kind === "shift"
          ? !preferences.shiftNotifications
          : !preferences.reminders
      )
        continue;
      const own = reminderLead(item.reminder);
      // "None" always wins; the override only retimes reminders that are on.
      if (own === null) continue;
      const lead = options.leadOverride ?? own;
      const time = item.kind === "task" ? item.end : item.start;
      const fireAt = new Date(at(date, time).getTime() - lead * 60_000);
      if (fireAt.getTime() <= now.getTime() || fireAt.getTime() > until)
        continue;
      const when = `${leadText(lead)}, at ${formatTime(time)}`;
      plans.push({
        id: `reminder:${item.id}:${date}:${time}:${lead}`,
        fireAt,
        title:
          item.kind === "shift"
            ? "Upcoming Shift"
            : item.kind === "task"
              ? "Task Due Soon"
              : "Upcoming Commitment",
        body:
          item.kind === "task"
            ? `“${item.title}” is due ${when}.`
            : `${item.title} starts ${when}.`,
        target: { kind: "reminder", itemId: item.id, date },
      });
    }
  }
  plans.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  return plans.slice(0, options.limit ?? 48);
}

/**
 * Genuine overlaps that haven't been announced yet. `announced` is what was
 * already notified; anything no longer active is dropped from it, so a
 * conflict that is resolved and later comes back is announced again.
 */
export function conflictsToAnnounce(
  active: Conflict[],
  announced: string[],
): { fresh: Conflict[]; announced: string[] } {
  const overlaps = active.filter((conflict) => conflict.type === "overlap");
  const known = new Set(announced);
  return {
    fresh: overlaps.filter((conflict) => !known.has(conflict.id)),
    announced: overlaps.map((conflict) => conflict.id),
  };
}
export function conflictNotice(fresh: Conflict[]) {
  if (fresh.length === 1) {
    const [{ first, second, date }] = fresh;
    const kinds = [first, second]
      .filter((item): item is ScheduleItem => !!item)
      .map(describe);
    return {
      title: "Schedule Conflict Detected",
      body: `Your ${kinds[0]} overlaps with ${kinds[1] ? `a ${kinds[1]}` : "another commitment"} on ${formatDate(date, true)}. Review your calendar to resolve it.`,
      target: {
        kind: "conflict",
        conflictId: fresh[0].id,
      } as NotificationTarget,
    };
  }
  return {
    title: "Schedule Conflicts Detected",
    body: `${fresh.length} commitments overlap in your schedule. Review your calendar to resolve them.`,
    target: { kind: "conflict", conflictId: null } as NotificationTarget,
  };
}
function describe(item: ScheduleItem) {
  if (item.kind === "shift") return "work shift";
  if (item.category === "Class") return "class";
  if (item.kind === "task") return "task";
  return "event";
}

export type ShiftChange = {
  item: ScheduleItem;
  change: "moved" | "cancelled" | "removed";
};
/** Shifts that existed before and now have different times or are gone. */
export function shiftChanges(
  before: ScheduleItem[],
  after: ScheduleItem[],
): ShiftChange[] {
  const next = new Map(after.map((item) => [item.id, item]));
  const changes: ShiftChange[] = [];
  for (const old of before) {
    if (old.kind !== "shift") continue;
    const now = next.get(old.id);
    if (!now) changes.push({ item: old, change: "removed" });
    else if (now.status === "Cancelled" && old.status !== "Cancelled")
      changes.push({ item: now, change: "cancelled" });
    else if (
      now.date !== old.date ||
      now.start !== old.start ||
      now.end !== old.end ||
      now.repeat !== old.repeat ||
      JSON.stringify(now.exceptions ?? []) !==
        JSON.stringify(old.exceptions ?? [])
    )
      changes.push({ item: now, change: "moved" });
  }
  return changes;
}
export function shiftNotice(changes: ShiftChange[]) {
  if (changes.length === 1) {
    const [{ item, change }] = changes;
    return {
      title: change === "moved" ? "Shift Updated" : "Shift Cancelled",
      body:
        change === "moved"
          ? `${item.title} is now ${formatDate(item.date, true)}, ${formatTime(item.start)}–${formatTime(item.end)}. Check ShiftSync for affected commitments.`
          : `${item.title} on ${formatDate(item.date, true)} was ${change === "removed" ? "removed" : "cancelled"}. Check ShiftSync for affected commitments.`,
      target:
        change === "removed"
          ? ({ kind: "shift", itemId: null, date: null } as NotificationTarget)
          : ({
              kind: "shift",
              itemId: item.id,
              date: item.date,
            } as NotificationTarget),
    };
  }
  return {
    title: "Shifts Updated",
    body: `${changes.length} of your work shifts changed. Check ShiftSync for affected commitments.`,
    target: { kind: "shift", itemId: null, date: null } as NotificationTarget,
  };
}
