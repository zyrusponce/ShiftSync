// Deterministic schedule recovery. Hard constraints filter every candidate
// before scoring, so a high score can never rescue an invalid time.
import type {
  AvailabilityDay,
  Preferences,
  RecoveryWeights,
  ScheduleItem,
  Slot,
} from "./types";
import {
  addDays,
  blocksTime,
  dateKey,
  formatDate,
  formatTime,
  itemsOnDate,
  minutes,
  occursOn,
  parseDate,
  timeKey,
} from "./schedule";
import { breakMinutes, isFixed, minBlock, requiredGap } from "./policy";

export const DEFAULT_WEIGHTS: RecoveryWeights = {
  deadline: 0.35,
  preference: 0.25,
  closeness: 0.2,
  breakTravel: 0.2,
};
export const DEFAULT_HORIZON_DAYS = 7;
const STEP = 15;
const MAX_OPTIONS = 3;
const MAX_SPLIT_BLOCKS = 4;
const DAY = 1440;

/** "Now" as wall-clock time in the user's time zone. */
export type LocalNow = { date: string; minutes: number };
export function localNow(now = new Date()): LocalNow {
  const seconds = now.getSeconds() > 0 || now.getMilliseconds() > 0 ? 1 : 0;
  return {
    date: dateKey(now),
    minutes: now.getHours() * 60 + now.getMinutes() + seconds,
  };
}

export type ScoreComponents = RecoveryWeights;
export type RecoveryOption = {
  /** Stable identity of the proposal, used to detect duplicates. */
  key: string;
  eventId: string;
  occurrenceDate: string;
  kind: "move" | "split";
  blocks: Slot[];
  score: number;
  components: ScoreComponents;
  rank: number;
  explanation: string;
};
export type SearchWindow = { from: string; to: string };
export type RecoveryResult =
  | {
      status: "OK";
      eventId: string;
      occurrenceDate: string;
      options: RecoveryOption[];
      window: SearchWindow;
    }
  | {
      status: "NO_FEASIBLE_SLOT" | "NOT_MOVABLE";
      eventId: string;
      occurrenceDate: string;
      reason: string;
      window: SearchWindow;
    };
export type RecoveryInput = {
  target: ScheduleItem;
  occurrenceDate: string;
  items: ScheduleItem[];
  availability: AvailabilityDay[];
  preferences: Preferences;
  now?: LocalNow;
  horizonDays?: number;
  /** Blocks already claimed by other planned moves. */
  reserved?: Slot[];
  maxOptions?: number;
};

type Context = {
  target: ScheduleItem;
  occurrenceDate: string;
  duration: number;
  others: ScheduleItem[];
  availability: AvailabilityDay[];
  preferences: Preferences;
  now: LocalNow;
  reserved: Slot[];
  deadline: { date: string; minutes: number } | null;
  weights: RecoveryWeights;
};
type Window = { date: string; start: number; end: number };

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const round = (value: number) => Math.round(value * 10000) / 10000;
const dayIndex = (from: string, date: string) => {
  const [a, b] = [from, date].map((value) => {
    const [y, m, d] = value.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86400000);
};
export function parseDeadline(value?: string) {
  const match = value?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);
  return match ? { date: match[1], minutes: minutes(match[2]) } : null;
}
export function formatDuration(total: number): string {
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} min`;
  const h = `${hours} hr${hours === 1 ? "" : "s"}`;
  return rest ? `${h} ${rest} min` : h;
}
const slotText = (slot: Slot) =>
  `${formatDate(slot.date, true)}, ${formatTime(slot.start)}–${formatTime(slot.end)}`;
export const optionKey = (eventId: string, date: string, blocks: Slot[]) =>
  `${eventId}@${date}>${blocks.map((b) => `${b.date}T${b.start}-${b.end}`).join("+")}`;

function weightsOf(preferences: Preferences): RecoveryWeights {
  const w = preferences.recoveryWeights ?? DEFAULT_WEIGHTS;
  const valid = Object.values(w).every(
    (value) => Number.isFinite(value) && value >= 0,
  );
  const sum = valid
    ? w.deadline + w.preference + w.closeness + w.breakTravel
    : 0;
  if (!sum) return DEFAULT_WEIGHTS;
  return {
    deadline: w.deadline / sum,
    preference: w.preference / sum,
    closeness: w.closeness / sum,
    breakTravel: w.breakTravel / sum,
  };
}
function context(input: RecoveryInput): Context {
  return {
    target: input.target,
    occurrenceDate: input.occurrenceDate,
    duration: minutes(input.target.end) - minutes(input.target.start),
    others: input.items.filter((item) => item.id !== input.target.id),
    availability: input.availability,
    preferences: input.preferences,
    now: input.now ?? localNow(),
    reserved: input.reserved ?? [],
    deadline: parseDeadline(input.target.deadline),
    weights: weightsOf(input.preferences),
  };
}
/** Commitments that stay in place on a date while the target moves. */
function commitmentsOn(ctx: Context, date: string): ScheduleItem[] {
  const list = itemsOnDate(ctx.others, date).filter(blocksTime);
  // The rest of a recurring series stays where it is.
  if (
    ctx.target.repeat !== "Never" &&
    date !== ctx.occurrenceDate &&
    occursOn(ctx.target, date)
  )
    list.push(ctx.target);
  return list;
}
/** Bounds on a date where a block may sit, before checking commitments. */
function dayBounds(ctx: Context, date: string): [number, number] | null {
  if (date < ctx.now.date) return null;
  const day = ctx.availability.find(
    (value) => value.day === parseDate(date).getDay(),
  );
  if (!day?.enabled) return null;
  let lo = minutes(day.start);
  let hi = minutes(day.end);
  if (date === ctx.now.date) lo = Math.max(lo, ctx.now.minutes);
  if (ctx.deadline) {
    if (date > ctx.deadline.date) return null;
    if (date === ctx.deadline.date) hi = Math.min(hi, ctx.deadline.minutes);
  }
  return hi > lo ? [lo, hi] : null;
}
function clashes(
  ctx: Context,
  date: string,
  start: number,
  end: number,
  commitments: ScheduleItem[],
  extra: Slot[] = [],
): boolean {
  if (
    commitments.some((value) => {
      const gap = requiredGap(ctx.target, value, ctx.preferences);
      return (
        start < minutes(value.end) + gap && end + gap > minutes(value.start)
      );
    })
  )
    return true;
  const brk = breakMinutes(ctx.preferences);
  return [...ctx.reserved, ...extra].some(
    (slot) =>
      slot.date === date &&
      start < minutes(slot.end) + brk &&
      end + brk > minutes(slot.start),
  );
}
export function searchWindow(
  target: ScheduleItem,
  occurrenceDate: string,
  now: LocalNow,
  horizonDays = DEFAULT_HORIZON_DAYS,
): SearchWindow {
  const from = now.date;
  let to = addDays(from, Math.max(1, horizonDays) - 1);
  if (occurrenceDate >= to) to = addDays(occurrenceDate, 1);
  const deadline = parseDeadline(target.deadline);
  if (deadline && deadline.date < to) to = deadline.date;
  return { from, to };
}
function datesIn(window: SearchWindow): string[] {
  const dates: string[] = [];
  for (let date = window.from; date <= window.to; date = addDays(date, 1))
    dates.push(date);
  return dates;
}

/** Share of [start, end) inside the student's preferred study period. */
function preferenceFit(ctx: Context, start: number, end: number): number {
  const [lo, hi] =
    ctx.preferences.preferredPeriod === "Morning"
      ? [0, 12 * 60]
      : ctx.preferences.preferredPeriod === "Evening"
        ? [17 * 60, DAY]
        : [0, DAY];
  return clamp((Math.min(end, hi) - Math.max(start, lo)) / (end - start));
}
function score(ctx: Context, blocks: Slot[]): ScoreComponents {
  const abs = (date: string, value: number) =>
    dayIndex(ctx.now.date, date) * DAY + value;
  const originStart = abs(ctx.occurrenceDate, minutes(ctx.target.start));
  const each = blocks.map((block) => {
    const start = minutes(block.start);
    const end = minutes(block.end);
    let deadline = 1;
    if (ctx.deadline) {
      const limit = abs(ctx.deadline.date, ctx.deadline.minutes);
      const span = limit - ctx.now.minutes;
      deadline = span > 0 ? clamp((limit - abs(block.date, end)) / span) : 0;
    }
    const preference = preferenceFit(ctx, start, end);
    const shift = Math.abs(abs(block.date, start) - originStart);
    const closeness = 1 / (1 + shift / 720);
    const neighbours = [
      ...commitmentsOn(ctx, block.date).map((item) => ({
        start: minutes(item.start),
        end: minutes(item.end),
        need: requiredGap(ctx.target, item, ctx.preferences),
      })),
      ...[...ctx.reserved, ...blocks]
        .filter((slot) => slot.date === block.date && slot !== block)
        .map((slot) => ({
          start: minutes(slot.start),
          end: minutes(slot.end),
          need: breakMinutes(ctx.preferences),
        })),
    ];
    const spare = neighbours.map((n) =>
      n.end <= start ? start - n.end - n.need : n.start - end - n.need,
    );
    const breakTravel = spare.length
      ? clamp(0.25 + (0.75 * Math.min(...spare)) / 60)
      : 1;
    return { deadline, preference, closeness, breakTravel };
  });
  const mean = (key: keyof ScoreComponents) =>
    round(each.reduce((sum, value) => sum + value[key], 0) / each.length);
  return {
    deadline: mean("deadline"),
    preference: mean("preference"),
    closeness: mean("closeness"),
    breakTravel: mean("breakTravel"),
  };
}
const total = (ctx: Context, c: ScoreComponents) =>
  round(
    ctx.weights.deadline * c.deadline +
      ctx.weights.preference * c.preference +
      ctx.weights.closeness * c.closeness +
      ctx.weights.breakTravel * c.breakTravel,
  );

function nearest(ctx: Context, block: Slot) {
  const start = minutes(block.start);
  const end = minutes(block.end);
  let best: { title: string; gap: number; before: boolean } | null = null;
  for (const item of commitmentsOn(ctx, block.date)) {
    const before = minutes(item.end) <= start;
    const gap = before ? start - minutes(item.end) : minutes(item.start) - end;
    if (gap >= 0 && (!best || gap < best.gap))
      best = { title: item.title, gap, before };
  }
  return best;
}
function explain(
  ctx: Context,
  kind: "move" | "split",
  blocks: Slot[],
  c: ScoreComponents,
) {
  const clauses: string[] = [];
  const length = blocks.reduce(
    (sum, b) => sum + minutes(b.end) - minutes(b.start),
    0,
  );
  if (kind === "move") {
    const block = blocks[0];
    clauses.push(
      `keeps the full ${formatDuration(length)}${block.date === ctx.occurrenceDate ? " on the same day" : ""}`,
    );
  } else
    clauses.push(
      `splits the ${formatDuration(length)} into ${blocks.length} blocks (each at least ${formatDuration(minBlock(ctx.target))}) so no study time is lost`,
    );
  if (ctx.deadline) {
    const last = blocks[blocks.length - 1];
    const slack =
      dayIndex(last.date, ctx.deadline.date) * DAY +
      ctx.deadline.minutes -
      minutes(last.end);
    clauses.push(
      slack >= DAY
        ? `finishes ${Math.floor(slack / DAY)} day${slack >= 2 * DAY ? "s" : ""} before the deadline`
        : `finishes ${formatDuration(slack)} before the deadline`,
    );
  }
  const period = ctx.preferences.preferredPeriod;
  if (period !== "Any")
    clauses.push(
      c.preference >= 1
        ? `fits your preferred ${period.toLowerCase()} hours`
        : c.preference <= 0
          ? `is outside your preferred ${period.toLowerCase()} hours`
          : `is partly in your preferred ${period.toLowerCase()} hours`,
    );
  if (kind === "move") {
    const near = nearest(ctx, blocks[0]);
    clauses.push(
      near
        ? `leaves ${formatDuration(near.gap)} ${near.before ? "after" : "before"} ${near.title}`
        : "has nothing else scheduled that day around it",
    );
  }
  const sentence =
    clauses.length > 1
      ? `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`
      : clauses[0];
  const when = blocks.map(slotText).join("; ");
  return `${when}. This ${sentence[0].toLowerCase()}${sentence.slice(1)}.`;
}

function rank(
  ctx: Context,
  options: Omit<RecoveryOption, "rank">[],
  max: number,
) {
  const sorted = [...options].sort(
    (a, b) =>
      b.score - a.score ||
      a.blocks[0].date.localeCompare(b.blocks[0].date) ||
      a.blocks[0].start.localeCompare(b.blocks[0].start),
  );
  const picked: Omit<RecoveryOption, "rank">[] = [];
  for (const option of sorted) {
    if (picked.length >= max) break;
    // Skip near-duplicates that overlap an option already offered.
    const overlaps = picked.some((other) =>
      other.blocks.some((a) =>
        option.blocks.some(
          (b) =>
            a.date === b.date &&
            minutes(a.start) < minutes(b.end) &&
            minutes(b.start) < minutes(a.end),
        ),
      ),
    );
    if (!overlaps) picked.push(option);
  }
  return picked.map((option, index) => ({ ...option, rank: index + 1 }));
}

function freeWindows(ctx: Context, window: SearchWindow): Window[] {
  const result: Window[] = [];
  for (const date of datesIn(window)) {
    const bounds = dayBounds(ctx, date);
    if (!bounds) continue;
    const blocked = [
      ...commitmentsOn(ctx, date).map((item) => {
        const gap = requiredGap(ctx.target, item, ctx.preferences);
        return [minutes(item.start) - gap, minutes(item.end) + gap];
      }),
      ...ctx.reserved
        .filter((slot) => slot.date === date)
        .map((slot) => {
          const gap = breakMinutes(ctx.preferences);
          return [minutes(slot.start) - gap, minutes(slot.end) + gap];
        }),
    ].sort((a, b) => a[0] - b[0]);
    let cursor = bounds[0];
    for (const [start, end] of [...blocked, [bounds[1], bounds[1]]]) {
      const from = Math.ceil(cursor / STEP) * STEP;
      const to = Math.min(start, bounds[1]);
      if (to - from > 0) result.push({ date, start: from, end: to });
      cursor = Math.max(cursor, end);
      if (cursor >= bounds[1]) break;
    }
  }
  return result;
}
function allocate(ctx: Context, windows: Window[]): Slot[] | null {
  const min = minBlock(ctx.target);
  let remaining = ctx.duration;
  const blocks: Slot[] = [];
  for (const w of windows) {
    if (remaining <= 0 || blocks.length >= MAX_SPLIT_BLOCKS) break;
    let take = Math.min(remaining, w.end - w.start);
    if (take < min) continue;
    const rest = remaining - take;
    if (rest > 0 && rest < min) take = remaining - min;
    if (take < min) continue;
    blocks.push({
      date: w.date,
      start: timeKey(w.start),
      end: timeKey(w.start + take),
    });
    remaining -= take;
  }
  return remaining === 0 && blocks.length > 1 ? blocks : null;
}

export function generateRecovery(input: RecoveryInput): RecoveryResult {
  const ctx = context(input);
  const { target, occurrenceDate } = input;
  const window = searchWindow(
    target,
    occurrenceDate,
    ctx.now,
    input.horizonDays,
  );
  const base = { eventId: target.id, occurrenceDate, window };
  if (isFixed(target))
    return {
      ...base,
      status: "NOT_MOVABLE",
      reason: `${target.title} is a fixed commitment, so ShiftSync will not move it automatically.`,
    };
  if (!(ctx.duration > 0))
    return {
      ...base,
      status: "NO_FEASIBLE_SLOT",
      reason: "This event has no valid duration.",
    };
  if (
    ctx.deadline &&
    (ctx.deadline.date < ctx.now.date ||
      (ctx.deadline.date === ctx.now.date &&
        ctx.deadline.minutes <= ctx.now.minutes))
  )
    return {
      ...base,
      status: "NO_FEASIBLE_SLOT",
      reason: `The deadline for ${target.title} has already passed, so there is no time left to recover it.`,
    };
  const max = Math.max(
    1,
    Math.min(MAX_OPTIONS, input.maxOptions ?? MAX_OPTIONS),
  );
  const candidates: Omit<RecoveryOption, "rank">[] = [];
  for (const date of datesIn(window)) {
    const bounds = dayBounds(ctx, date);
    if (!bounds) continue;
    const commitments = commitmentsOn(ctx, date);
    for (
      let start = Math.ceil(bounds[0] / STEP) * STEP;
      start + ctx.duration <= bounds[1];
      start += STEP
    ) {
      const end = start + ctx.duration;
      if (date === occurrenceDate && start === minutes(target.start)) continue;
      if (clashes(ctx, date, start, end, commitments)) continue;
      const blocks = [{ date, start: timeKey(start), end: timeKey(end) }];
      const components = score(ctx, blocks);
      candidates.push({
        key: optionKey(target.id, occurrenceDate, blocks),
        eventId: target.id,
        occurrenceDate,
        kind: "move",
        blocks,
        components,
        score: total(ctx, components),
        explanation: "",
      });
    }
  }
  let options = rank(ctx, candidates, max);
  if (!options.length && target.splittable) {
    const windows = freeWindows(ctx, window);
    const byTime = allocate(ctx, windows);
    const fit = (w: Window) =>
      preferenceFit(ctx, w.start, Math.min(w.end, w.start + ctx.duration));
    const byPreference = allocate(
      ctx,
      [...windows].sort(
        (a, b) =>
          fit(b) - fit(a) || a.date.localeCompare(b.date) || a.start - b.start,
      ),
    );
    const plans = [byTime, byPreference].filter(
      (plan): plan is Slot[] => !!plan,
    );
    const split = plans.map((blocks) => {
      const components = score(ctx, blocks);
      return {
        key: optionKey(target.id, occurrenceDate, blocks),
        eventId: target.id,
        occurrenceDate,
        kind: "split" as const,
        blocks,
        components,
        score: total(ctx, components),
        explanation: "",
      };
    });
    options = rank(
      ctx,
      split.filter(
        (value, i) => split.findIndex((o) => o.key === value.key) === i,
      ),
      max,
    );
  }
  if (!options.length) {
    const range = `${formatDate(window.from, true)} and ${formatDate(window.to, true)}`;
    const reason = target.splittable
      ? `No free ${formatDuration(ctx.duration)} window, or set of blocks of at least ${formatDuration(minBlock(target))}, fits between ${range} without breaking your availability, breaks, travel time${ctx.deadline ? " or deadline" : ""}.`
      : `No free ${formatDuration(ctx.duration)} window fits between ${range} without breaking your availability, breaks, travel time${ctx.deadline ? " or deadline" : ""}. Marking it splittable may allow shorter blocks.`;
    return { ...base, status: "NO_FEASIBLE_SLOT", reason };
  }
  return {
    ...base,
    status: "OK",
    options: options.map((option) => ({
      ...option,
      explanation: explain(ctx, option.kind, option.blocks, option.components),
    })),
  };
}

/**
 * Rechecks a proposal against the current schedule just before saving it.
 * Returns a reason when the plan is no longer valid.
 */
export function validatePlan(
  input: Omit<RecoveryInput, "reserved" | "maxOptions"> & { blocks: Slot[] },
): string | null {
  const ctx = context(input);
  const { target, occurrenceDate, blocks } = input;
  if (!occursOn(target, occurrenceDate))
    return `${target.title} is no longer scheduled on ${formatDate(occurrenceDate, true)}.`;
  if (isFixed(target))
    return `${target.title} is fixed and cannot be moved automatically.`;
  if (!blocks.length) return "The plan has no time blocks.";
  if (blocks.length > 1 && !target.splittable)
    return `${target.title} is not marked splittable.`;
  if (blocks.length > MAX_SPLIT_BLOCKS) return "The plan has too many blocks.";
  const length = blocks.reduce(
    (sum, b) => sum + minutes(b.end) - minutes(b.start),
    0,
  );
  if (length !== ctx.duration)
    return `The plan does not keep the full ${formatDuration(ctx.duration)}.`;
  for (const [index, block] of blocks.entries()) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(block.date) ||
      ![block.start, block.end].every((t) =>
        /^([01]\d|2[0-3]):[0-5]\d$/.test(t),
      )
    )
      return "The plan has an invalid time.";
    const start = minutes(block.start);
    const end = minutes(block.end);
    if (end <= start) return "The plan has an invalid time.";
    if (blocks.length > 1 && end - start < minBlock(target))
      return `Each block must be at least ${formatDuration(minBlock(target))}.`;
    const bounds = dayBounds(ctx, block.date);
    if (!bounds || start < bounds[0] || end > bounds[1])
      return `${slotText(block)} is in the past, outside your availability, or after the deadline.`;
    const siblings = blocks.filter((_, i) => i !== index);
    if (
      clashes(
        ctx,
        block.date,
        start,
        end,
        commitmentsOn(ctx, block.date),
        siblings,
      )
    )
      return `${slotText(block)} now conflicts with your schedule.`;
  }
  return null;
}

export type AppliedPlan = {
  items: ScheduleItem[];
  updated: string[];
  created: string[];
};
/** Applies an approved plan. Recurring series keep their other dates. */
export function applyPlan(
  items: ScheduleItem[],
  targetId: string,
  occurrenceDate: string,
  blocks: Slot[],
  newId: () => string,
): AppliedPlan {
  const target = items.find((item) => item.id === targetId);
  if (!target || !occursOn(target, occurrenceDate))
    throw new Error("This event is no longer on your schedule.");
  const title = (index: number) =>
    blocks.length > 1
      ? `${target.title} (part ${index + 1} of ${blocks.length})`
      : target.title;
  const copy = (block: Slot, index: number): ScheduleItem => ({
    ...target,
    ...block,
    id: newId(),
    title: title(index),
    repeat: "Never",
    exceptions: [],
    completed: false,
    completedDates: undefined,
    googleEventId: undefined,
    googleCalendarId: undefined,
    version: undefined,
  });
  if (target.repeat === "Never") {
    const created = blocks.slice(1).map((block, i) => copy(block, i + 1));
    return {
      items: [
        ...items.map((item) =>
          item.id === targetId
            ? { ...item, ...blocks[0], title: title(0) }
            : item,
        ),
        ...created,
      ],
      updated: [targetId],
      created: created.map((item) => item.id),
    };
  }
  const created = blocks.map(copy);
  return {
    items: [
      ...items.map((item) =>
        item.id === targetId
          ? {
              ...item,
              exceptions: [
                ...new Set([...(item.exceptions ?? []), occurrenceDate]),
              ],
            }
          : item,
      ),
      ...created,
    ],
    updated: [targetId],
    created: created.map((item) => item.id),
  };
}
