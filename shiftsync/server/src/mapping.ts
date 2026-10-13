// Conversions between database rows (UTC instants) and the shared app model
// (local dates and times in the user's time zone).
import type {
  Contact,
  ContactRole,
  Priority,
  ScheduleItem,
} from "../../src/domain/types";
import type { EmailNotification } from "../../src/domain/contract";
import { isFixed, DEFAULT_MIN_BLOCK } from "../../src/domain/policy";
import { localStamp, utcToZoned, zonedToUtc } from "../../src/domain/time";
import type {
  ContactRow,
  EventRow,
  EventWrite,
  NotificationRow,
} from "./repo/types";

const CATEGORY_TO_DB = {
  Work: "work",
  Class: "class",
  Study: "study",
  Personal: "personal",
  Important: "important",
  Other: "other",
} as const;
const CATEGORY_FROM_DB = Object.fromEntries(
  Object.entries(CATEGORY_TO_DB).map(([app, db]) => [db, app]),
) as Record<EventRow["category"], ScheduleItem["category"]>;
const PRIORITY_TO_DB: Record<Priority, 1 | 2 | 3> = {
  Low: 1,
  Medium: 2,
  High: 3,
};
const PRIORITY_FROM_DB: Record<number, Priority> = {
  1: "Low",
  2: "Medium",
  3: "High",
};
const lower = <T extends string>(value: T) =>
  value.toLowerCase() as Lowercase<T>;
const title = <T extends string>(value: T) =>
  (value[0].toUpperCase() + value.slice(1)) as Capitalize<T>;

export const roleToDb = (role: ContactRole) =>
  lower(role) as ContactRow["role"];
export const roleFromDb = (role: ContactRow["role"]) =>
  title(role) as ContactRole;

/** Row values for an item whose local times are in `timeZone`. */
export function itemToRow(item: ScheduleItem, timeZone: string): EventWrite {
  const deadline = item.deadline?.split("T");
  return {
    id: item.id,
    title: item.title.trim(),
    kind: item.kind,
    category: CATEGORY_TO_DB[item.category],
    start_at: zonedToUtc(item.date, item.start, timeZone).toISOString(),
    end_at: zonedToUtc(item.date, item.end, timeZone).toISOString(),
    timezone: timeZone,
    is_fixed: isFixed(item),
    priority: PRIORITY_TO_DB[item.priority],
    deadline_at: deadline
      ? zonedToUtc(deadline[0], deadline[1], timeZone).toISOString()
      : null,
    is_splittable: item.splittable ?? false,
    minimum_block_minutes: item.minBlockMinutes ?? DEFAULT_MIN_BLOCK,
    recurrence: lower(item.repeat),
    exception_dates: [...new Set(item.exceptions ?? [])].sort(),
    completed: item.completed,
    completed_dates: [...new Set(item.completedDates ?? [])].sort(),
    status: lower(item.status),
    details: {
      location: item.location,
      notes: item.notes,
      participants: item.participants,
      reminder: item.reminder,
      position: item.position,
      swapRequested: item.swapRequested,
    },
    google_event_id: item.googleEventId ?? null,
    google_calendar_id: item.googleCalendarId ?? null,
  };
}

/** The app item for a row, in the user's current time zone. */
export function rowToItem(
  row: EventRow,
  contactIds: string[],
  timeZone: string,
): ScheduleItem {
  const start = utcToZoned(row.start_at, timeZone);
  let end = utcToZoned(row.end_at, timeZone).time;
  // The app keeps each item within one day. A row created in another zone
  // can cross midnight here; it is shown ending at the end of its day.
  if (utcToZoned(row.end_at, timeZone).date !== start.date) end = "23:59";
  const details = row.details ?? ({} as EventRow["details"]);
  const item: ScheduleItem = {
    id: row.id,
    kind: row.kind,
    title: row.title,
    date: start.date,
    start: start.time,
    end,
    category: CATEGORY_FROM_DB[row.category],
    location: details.location ?? "",
    notes: details.notes ?? "",
    participants: details.participants ?? "",
    reminder: details.reminder ?? "None",
    repeat: title(row.recurrence),
    priority: PRIORITY_FROM_DB[row.priority] ?? "Medium",
    completed: row.completed,
    status: title(row.status),
    position: details.position ?? "",
    swapRequested: !!details.swapRequested,
    fixed: row.is_fixed,
    splittable: row.is_splittable,
    minBlockMinutes: row.minimum_block_minutes,
    contactIds,
    version: row.version,
  };
  if (row.exception_dates?.length) item.exceptions = [...row.exception_dates];
  if (row.recurrence !== "never" && row.kind === "task")
    item.completedDates = [...(row.completed_dates ?? [])];
  if (row.deadline_at) item.deadline = localStamp(row.deadline_at, timeZone);
  if (row.google_event_id) item.googleEventId = row.google_event_id;
  if (row.google_calendar_id) item.googleCalendarId = row.google_calendar_id;
  return item;
}

export function rowsToItems(
  rows: EventRow[],
  links: { event_id: string; contact_id: string }[],
  timeZone: string,
): ScheduleItem[] {
  const byEvent = new Map<string, string[]>();
  for (const link of links)
    byEvent.set(link.event_id, [
      ...(byEvent.get(link.event_id) ?? []),
      link.contact_id,
    ]);
  return rows.map((row) =>
    rowToItem(row, (byEvent.get(row.id) ?? []).sort(), timeZone),
  );
}

export const contactFromRow = (row: ContactRow): Contact => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: roleFromDb(row.role),
});

export const notificationFromRow = (
  row: NotificationRow,
): EmailNotification => ({
  id: row.id,
  conflictId: row.conflict_key,
  contactId: row.contact_id,
  recipientEmail: row.recipient_email,
  recipientName: row.recipient_name,
  recipientRole: roleFromDb(row.recipient_role),
  subject: row.subject,
  body: row.body,
  source: row.source,
  status: row.status,
  gmailDraftId: row.gmail_draft_id,
  gmailMessageId: row.gmail_message_id,
  errorCode: row.error_code,
  sentAt: row.sent_at,
  updatedAt: row.updated_at,
});
