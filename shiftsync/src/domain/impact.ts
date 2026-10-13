// Shift Impact Analysis: previews every commitment a proposed shift change
// affects, without changing the stored schedule.
import type { AvailabilityDay, Preferences, ScheduleItem, Slot } from "./types";
import {
  addDays,
  blocksTime,
  formatDate,
  formatTime,
  itemsOnDate,
  minutes,
  occursOn,
} from "./schedule";
import { isFixed, priorityRank, requiredGap, type PairType } from "./policy";
import {
  DEFAULT_HORIZON_DAYS,
  generateRecovery,
  localNow,
  parseDeadline,
  type LocalNow,
  type RecoveryResult,
} from "./recovery";

export type PairIssue =
  | { type: "overlap"; minutes: number }
  | { type: "buffer"; gap: number; required: number };
/** Overlap or too-short gap between two commitments on the same day. */
export function pairIssue(
  a: ScheduleItem,
  b: ScheduleItem,
  preferences: Preferences,
): PairIssue | null {
  const overlap =
    Math.min(minutes(a.end), minutes(b.end)) -
    Math.max(minutes(a.start), minutes(b.start));
  if (overlap > 0) return { type: "overlap", minutes: overlap };
  if (a.kind === "unavailable" || b.kind === "unavailable") return null;
  const gap =
    minutes(a.start) >= minutes(b.end)
      ? minutes(a.start) - minutes(b.end)
      : minutes(b.start) - minutes(a.end);
  const required = requiredGap(a, b, preferences);
  return gap < required ? { type: "buffer", gap, required } : null;
}
export const conflictId = (date: string, a: string, b: string) =>
  `${date}:${[a, b].sort().join(":")}`;

export type ImpactEntry = {
  conflictId: string;
  date: string;
  item: ScheduleItem;
  type: "direct" | "buffer";
  /** Overlapping minutes, or the actual gap for buffer issues. */
  minutes: number;
  requiredGap: number;
  fixed: boolean;
  pairType: PairType;
  /** reschedule: flexible; communicate: fixed; review: the student's own blocked time. */
  action: "reschedule" | "communicate" | "review";
  /** The same pair already had this problem before the change. */
  preexisting: boolean;
  description: string;
};
export type PlannedRecovery = {
  conflictId: string;
  eventId: string;
  occurrenceDate: string;
  title: string;
  result: RecoveryResult;
};
export type KnockOn = {
  conflictId: string;
  eventId: string;
  occurrenceDate: string;
  message: string;
};
export type ImpactReport = {
  shift: {
    id: string;
    title: string;
    before: Slot | null;
    after: Slot;
    repeat: ScheduleItem["repeat"];
  };
  window: { from: string; to: string };
  direct: ImpactEntry[];
  buffer: ImpactEntry[];
  /** Problems the old shift time caused that the new time removes. */
  cleared: { conflictId: string; date: string; item: ScheduleItem }[];
  /** A sequential, non-overlapping recovery preview for flexible events. */
  plan: PlannedRecovery[];
  /** Hypothetical effects of that plan. These are not existing conflicts. */
  knockOn: KnockOn[];
  counts: {
    affected: number;
    reschedule: number;
    communicate: number;
    noFeasibleSlot: number;
  };
};
export type ImpactInput = {
  items: ScheduleItem[];
  /** The shift with its proposed date and times; same id when editing. */
  proposed: ScheduleItem;
  availability: AvailabilityDay[];
  preferences: Preferences;
  now?: LocalNow;
  horizonDays?: number;
};

const slotOf = (item: ScheduleItem): Slot => ({
  date: item.date,
  start: item.start,
  end: item.end,
});
const describe = (item: ScheduleItem, issue: PairIssue, shift: string) =>
  issue.type === "overlap"
    ? `${item.title} (${formatTime(item.start)}–${formatTime(item.end)}) overlaps ${shift} by ${issue.minutes} minutes.`
    : `Only ${issue.gap} minutes between ${shift} and ${item.title}; you need ${issue.required} for breaks and travel.`;

export function analyzeShiftImpact(input: ImpactInput): ImpactReport {
  const { proposed, preferences } = input;
  const now = input.now ?? localNow();
  const horizon = Math.max(
    1,
    input.horizonDays ??
      preferences.planningHorizonDays ??
      DEFAULT_HORIZON_DAYS,
  );
  const original = input.items.find((item) => item.id === proposed.id) ?? null;
  const after = [
    ...input.items.filter((item) => item.id !== proposed.id),
    proposed,
  ];
  const others = input.items.filter((item) => item.id !== proposed.id);
  const earliest =
    original && original.date < proposed.date ? original.date : proposed.date;
  const from = earliest > now.date ? earliest : now.date;
  const to = addDays(from, horizon - 1);
  const direct: ImpactEntry[] = [];
  const buffer: ImpactEntry[] = [];
  const cleared: ImpactReport["cleared"] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const newOn = proposed.status !== "Cancelled" && occursOn(proposed, date);
    const oldOn =
      !!original && original.status !== "Cancelled" && occursOn(original, date);
    if (!newOn && !oldOn) continue;
    for (const other of itemsOnDate(others, date).filter(blocksTime)) {
      const id = conflictId(date, proposed.id, other.id);
      const issue = newOn ? pairIssue(proposed, other, preferences) : null;
      const before = oldOn ? pairIssue(original!, other, preferences) : null;
      if (!issue) {
        if (before) cleared.push({ conflictId: id, date, item: other });
        continue;
      }
      const fixed = isFixed(other);
      const entry: ImpactEntry = {
        conflictId: id,
        date,
        item: other,
        type: issue.type === "overlap" ? "direct" : "buffer",
        minutes: issue.type === "overlap" ? issue.minutes : issue.gap,
        requiredGap: requiredGap(proposed, other, preferences),
        fixed,
        pairType:
          fixed && isFixed(proposed)
            ? "fixed_fixed"
            : fixed || isFixed(proposed)
              ? "fixed_flexible"
              : "flexible_flexible",
        action:
          other.kind === "unavailable"
            ? "review"
            : fixed
              ? "communicate"
              : "reschedule",
        preexisting: !!before,
        description: describe(other, issue, proposed.title || "the shift"),
      };
      (entry.type === "direct" ? direct : buffer).push(entry);
    }
  }
  // Recover the most urgent flexible commitments first; each recovery
  // reserves its time so later ones cannot collide with it.
  const urgency = (entry: ImpactEntry) => {
    const deadline = parseDeadline(entry.item.deadline);
    return deadline
      ? Date.parse(`${deadline.date}T00:00:00Z`) / 60000 + deadline.minutes
      : Infinity;
  };
  const queue = [...direct, ...buffer]
    .filter((entry) => entry.action === "reschedule")
    .sort(
      (a, b) =>
        (urgency(a) === urgency(b) ? 0 : urgency(a) < urgency(b) ? -1 : 1) ||
        priorityRank[b.item.priority] - priorityRank[a.item.priority] ||
        a.date.localeCompare(b.date) ||
        a.item.start.localeCompare(b.item.start),
    );
  const plan: PlannedRecovery[] = [];
  const knockOn: KnockOn[] = [];
  const reserved: (Slot & { title: string })[] = [];
  for (const entry of queue) {
    const common = {
      target: entry.item,
      occurrenceDate: entry.date,
      items: after,
      availability: input.availability,
      preferences,
      now,
      horizonDays: horizon,
    };
    const planned = generateRecovery({ ...common, reserved });
    const alone = reserved.length ? generateRecovery(common) : planned;
    const ref = {
      conflictId: entry.conflictId,
      eventId: entry.item.id,
      occurrenceDate: entry.date,
    };
    if (alone.status === "OK" && planned.status !== "OK")
      knockOn.push({
        ...ref,
        message: `If the earlier recoveries are approved, no time is left for ${entry.item.title}.`,
      });
    else if (
      alone.status === "OK" &&
      planned.status === "OK" &&
      alone.options[0].key !== planned.options[0].key
    ) {
      const best = alone.options[0].blocks[0];
      const taker = reserved.find(
        (slot) =>
          slot.date === best.date &&
          minutes(slot.start) < minutes(best.end) &&
          minutes(best.start) < minutes(slot.end),
      );
      const next = planned.options[0].blocks[0];
      knockOn.push({
        ...ref,
        message: `${entry.item.title}'s best time (${formatDate(best.date, true)}, ${formatTime(best.start)}) ${taker ? `would be used by ${taker.title}` : "is needed by an earlier recovery"}, so it moves to ${formatDate(next.date, true)}, ${formatTime(next.start)} instead.`,
      });
    }
    if (planned.status === "OK")
      reserved.push(
        ...planned.options[0].blocks.map((block) => ({
          ...block,
          title: entry.item.title,
        })),
      );
    plan.push({ ...ref, title: entry.item.title, result: planned });
  }
  const all = [...direct, ...buffer];
  return {
    shift: {
      id: proposed.id,
      title: proposed.title,
      before: original ? slotOf(original) : null,
      after: slotOf(proposed),
      repeat: proposed.repeat,
    },
    window: { from, to },
    direct,
    buffer,
    cleared,
    plan,
    knockOn,
    counts: {
      affected: new Set(all.map((entry) => `${entry.date}:${entry.item.id}`))
        .size,
      reschedule: all.filter((entry) => entry.action === "reschedule").length,
      communicate: all.filter((entry) => entry.action === "communicate").length,
      noFeasibleSlot: plan.filter((value) => value.result.status !== "OK")
        .length,
    },
  };
}
