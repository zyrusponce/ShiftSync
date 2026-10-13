// Deterministic explanations and email templates. They are the fallback
// whenever AI is off or unavailable, on the device and on the server alike.
import type { ImpactReport } from "./impact";
import { isFixed } from "./policy";
import { formatDate, formatTime } from "./schedule";
import type { Conflict, ContactRole, ScheduleItem } from "./types";

const both = (conflict: Conflict) =>
  [conflict.first, conflict.second].filter(
    (item): item is ScheduleItem => !!item,
  );

export function conflictExplanation(conflict: Conflict): string {
  const items = both(conflict);
  const describe = (item: ScheduleItem) =>
    `${item.title} (${formatTime(item.start)}–${formatTime(item.end)}, ${isFixed(item) ? "fixed" : "flexible"})`;
  const intro =
    conflict.type === "overlap"
      ? `On ${formatDate(conflict.date)}, ${describe(items[0])} and ${describe(items[1])} overlap by ${conflict.minutes} minutes.`
      : conflict.type === "buffer"
        ? `On ${formatDate(conflict.date)}, there are only ${conflict.minutes} minutes between ${describe(items[0])} and ${describe(items[1])}, less than your break and travel time.`
        : `On ${formatDate(conflict.date)}, ${describe(items[0])} is outside your available hours.`;
  const fixed = items.filter(isFixed);
  const next =
    items.length < 2
      ? "You can move it or update your availability."
      : fixed.length === 2
        ? "Both are fixed, so ShiftSync will not move either one. You can contact your employer or professor to work out a solution."
        : fixed.length === 1
          ? `${fixed[0].title} is fixed, so ShiftSync looks for new times for ${items.find((i) => !isFixed(i))!.title}.`
          : "Both are flexible, so ShiftSync suggests moving the lower-priority one.";
  return `${intro} ${next}`;
}

export function impactExplanation(report: ImpactReport): string {
  const entries = [...report.direct, ...report.buffer];
  const when = `${formatDate(report.shift.after.date, true)}, ${formatTime(report.shift.after.start)}–${formatTime(report.shift.after.end)}`;
  if (!entries.length)
    return `Moving ${report.shift.title} to ${when} does not affect your other commitments.`;
  const plan = report.plan.map((p) =>
    p.result.status === "OK"
      ? `${p.title}: ${p.result.options[0].explanation}`
      : `${p.title}: ${p.result.reason}`,
  );
  return [...entries.map((e) => e.description), ...plan].join(" ");
}

export type Recipient = {
  name: string;
  role: ContactRole;
  relatedEvent: ScheduleItem;
};
export function templateDraft(
  conflict: Conflict,
  recipient: Recipient,
  studentName: string,
): { subject: string; body: string } {
  const theirs = recipient.relatedEvent;
  const other = both(conflict).find((item) => item.id !== theirs.id) ?? theirs;
  const when = (item: ScheduleItem) =>
    `${formatTime(item.start)}–${formatTime(item.end)}`;
  const date = formatDate(conflict.date);
  const ask =
    recipient.role === "Work"
      ? "Would it be possible to adjust my hours or swap this shift? I'm happy to help find a solution that works for the team."
      : recipient.role === "School"
        ? "Could you let me know what options I have, such as attending another section or making up the work? I want to stay on track with the class."
        : "Could we find another arrangement? I'm happy to work around your schedule.";
  return {
    subject: `Schedule conflict on ${date}: ${theirs.title}`,
    body: [
      `Hi ${recipient.name.trim() || "there"},`,
      "",
      `I'm writing about ${theirs.title} on ${date} (${when(theirs)}). It now ${conflict.type === "overlap" ? "overlaps with" : "leaves too little time to get to"} ${other.title} (${when(other)}), which I'm also committed to.`,
      "",
      ask,
      "",
      "Thank you for your understanding,",
      studentName.trim() || "Your student",
    ].join("\n"),
  };
}
