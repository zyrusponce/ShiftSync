import type {
  Category,
  ItemKind,
  Preferences,
  Priority,
  ScheduleItem,
} from "./types";

// Defaults from the product rules: work shifts and classes are fixed; study,
// personal and other activities are flexible. Every default is editable.
export function defaultFixed(item: {
  kind: ItemKind;
  category: Category;
}): boolean {
  if (item.kind === "shift" || item.kind === "unavailable") return true;
  if (item.kind === "task") return false;
  return item.category === "Class" || item.category === "Work";
}
export const isFixed = (item: ScheduleItem) => item.fixed ?? defaultFixed(item);

export const DEFAULT_MIN_BLOCK = 30;
export const minBlock = (item: ScheduleItem) =>
  item.minBlockMinutes ?? DEFAULT_MIN_BLOCK;

/** The six categories of the product plan, derived from kind + category. */
export type PlanCategory =
  "work_shift" | "class" | "study_deadline" | "study" | "personal" | "other";
export function planCategory(item: ScheduleItem): PlanCategory {
  if (item.kind === "shift") return "work_shift";
  if (item.category === "Class") return "class";
  if (item.category === "Study")
    return item.deadline ? "study_deadline" : "study";
  if (item.category === "Personal") return "personal";
  return "other";
}
export const planCategoryLabel: Record<PlanCategory, string> = {
  work_shift: "Work shift",
  class: "Class",
  study_deadline: "Deadline study",
  study: "Study session",
  personal: "Personal",
  other: "Other",
};

export const priorityRank: Record<Priority, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
};

const remote = /^(online|remote|zoom|google meet|teams|virtual|home)$/i;
/** Travel applies between two known, different, in-person places. */
export function needsTravel(a: ScheduleItem, b: ScheduleItem): boolean {
  const first = a.location.trim();
  const second = b.location.trim();
  return (
    !!first &&
    !!second &&
    !remote.test(first) &&
    !remote.test(second) &&
    first.toLowerCase() !== second.toLowerCase()
  );
}
export const breakMinutes = (preferences: Preferences) =>
  Math.max(preferences.bufferMinutes, preferences.avoidBackToBack ? 15 : 0);
/** Minutes required between two commitments: a break plus any travel. */
export function requiredGap(
  a: ScheduleItem,
  b: ScheduleItem,
  preferences: Preferences,
): number {
  return (
    breakMinutes(preferences) +
    (needsTravel(a, b) ? (preferences.travelMinutes ?? 0) : 0)
  );
}

export type PairType = "fixed_fixed" | "fixed_flexible" | "flexible_flexible";
export type ResolutionPlan =
  | { pairType: "fixed_fixed"; action: "communicate" }
  | {
      pairType: "fixed_flexible" | "flexible_flexible";
      action: "reschedule";
      move: ScheduleItem;
      keep: ScheduleItem;
    }
  | {
      pairType: "flexible_flexible";
      action: "choose";
      options: [ScheduleItem, ScheduleItem];
    };

/**
 * Decides which side of a conflict may move. Fixed events never move; between
 * two flexible events the lower priority moves, and ties go to the student.
 */
export function resolutionPlan(
  first: ScheduleItem,
  second: ScheduleItem,
): ResolutionPlan {
  const a = isFixed(first);
  const b = isFixed(second);
  if (a && b) return { pairType: "fixed_fixed", action: "communicate" };
  if (a || b)
    return {
      pairType: "fixed_flexible",
      action: "reschedule",
      move: a ? second : first,
      keep: a ? first : second,
    };
  const diff = priorityRank[first.priority] - priorityRank[second.priority];
  if (diff === 0)
    return {
      pairType: "flexible_flexible",
      action: "choose",
      options: [first, second],
    };
  return {
    pairType: "flexible_flexible",
    action: "reschedule",
    move: diff < 0 ? first : second,
    keep: diff < 0 ? second : first,
  };
}
