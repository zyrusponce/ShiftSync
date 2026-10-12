// Google Calendar import, availability checks and pushes of approved
// recoveries. External events are never overwritten silently: updates use
// the event's etag, and local edits are flagged for review instead of being
// replaced by Google's copy.
import crypto from "node:crypto";
import type {
  CalendarSyncReport,
  CalendarSyncResponse,
} from "../../../src/domain/contract";
import {
  addDays,
  formatDate,
  formatTime,
  minutes,
} from "../../../src/domain/schedule";
import { utcToZoned, zonedToUtc } from "../../../src/domain/time";
import type { Slot } from "../../../src/domain/types";
import type { Schedule } from "../context";
import { AppError, type Logger } from "../http";
import type { EventRow, Repo } from "../repo/types";
import {
  GoogleApiError,
  PRIMARY,
  googleAccess,
  type GoogleApi,
  type GoogleEvent,
} from "./google";

type Google = {
  google: GoogleApi;
  tokenKey: Buffer | null;
  log: Logger;
  now: () => Date;
};
const SYNC_DAYS_BACK = 30;
const SYNC_DAYS = 90;
const TOLERANCE_MS = 5000;

function localTimes(event: GoogleEvent, timeZone: string) {
  if (!event.start?.dateTime || !event.end?.dateTime) return null;
  const start = utcToZoned(event.start.dateTime, timeZone);
  const end = utcToZoned(event.end.dateTime, timeZone);
  if (start.date !== end.date || end.time <= start.time) return null;
  return { date: start.date, start: start.time, end: end.time };
}
/** A single-day all-day event: Google gives plain dates with an exclusive end. */
function allDayDate(event: GoogleEvent): string | null {
  const start = event.start?.date;
  const end = event.end?.date;
  return start && end && end === addDays(start, 1) ? start : null;
}
const inRange = (schedule: Schedule, from: string, to: string) => ({
  timeMin: zonedToUtc(from, "00:00", schedule.timeZone).toISOString(),
  timeMax: zonedToUtc(addDays(to, 1), "00:00", schedule.timeZone).toISOString(),
});
const syncError = (error: unknown) =>
  error instanceof GoogleApiError && error.status === 0
    ? "Google Calendar could not be reached."
    : "Google Calendar rejected the request.";

export async function importCalendar(
  deps: Google,
  repo: Repo,
  schedule: Schedule,
): Promise<CalendarSyncResponse> {
  const { token } = await googleAccess(
    deps.google,
    deps.tokenKey,
    repo,
    "calendar",
    deps.now(),
  );
  const from = addDays(schedule.now.date, -SYNC_DAYS_BACK);
  const { timeMin, timeMax } = inRange(
    schedule,
    from,
    addDays(schedule.now.date, SYNC_DAYS),
  );
  let events: GoogleEvent[];
  try {
    events = await deps.google.listEvents(token, PRIMARY, timeMin, timeMax);
  } catch (error) {
    const message = syncError(error);
    await repo.saveGoogleConnection({ calendar_last_sync_error: message });
    throw new AppError(
      "SYNC_FAILED",
      `${message} Your ShiftSync schedule was not changed.`,
    );
  }
  const result: CalendarSyncResponse = {
    imported: 0,
    updated: 0,
    unchanged: 0,
    skipped: [],
    needsReview: [],
  };
  const skip = (reason: string) => {
    const entry = result.skipped.find((s) => s.reason === reason);
    if (entry) entry.count++;
    else result.skipped.push({ reason, count: 1 });
  };
  const byGoogleId = new Map(
    schedule.rows
      .filter((row) => row.google_event_id)
      .map((row) => [row.google_event_id!, row]),
  );
  const ownIds = new Set(schedule.rows.map((row) => row.id));
  const stamp = deps.now().toISOString();
  for (const event of events) {
    const linked = byGoogleId.get(event.id);
    if (event.status === "cancelled") {
      if (linked)
        result.needsReview.push(
          `${linked.title} was cancelled in Google Calendar`,
        );
      continue;
    }
    const shiftsyncId = event.extendedProperties?.private?.shiftsyncId;
    if (shiftsyncId && ownIds.has(shiftsyncId) && !linked) {
      skip("Created by ShiftSync");
      continue;
    }
    const times = localTimes(event, schedule.timeZone);
    const day = times ? null : allDayDate(event);
    if (!times && !day) {
      skip(
        event.start?.date
          ? "Multi-day all-day events"
          : "Events that cross midnight",
      );
      continue;
    }
    // All-day events become tasks due that day, so they show on the calendar
    // without blocking time or creating conflicts.
    const start_at = day
      ? zonedToUtc(day, "00:00", schedule.timeZone).toISOString()
      : new Date(event.start!.dateTime!).toISOString();
    const end_at = day
      ? zonedToUtc(day, "23:59", schedule.timeZone).toISOString()
      : new Date(event.end!.dateTime!).toISOString();
    const title = (event.summary?.trim() || "Busy").slice(0, 120);
    if (linked) {
      if (linked.google_etag === event.etag) {
        result.unchanged++;
        continue;
      }
      const editedLocally =
        !linked.google_synced_at ||
        new Date(linked.updated_at).getTime() -
          new Date(linked.google_synced_at).getTime() >
          TOLERANCE_MS;
      if (editedLocally) {
        result.needsReview.push(
          `${linked.title} changed in both ShiftSync and Google Calendar`,
        );
        continue;
      }
      await repo.updateEvent(linked.id, {
        title,
        start_at,
        end_at,
        details: {
          ...linked.details,
          location: (event.location ?? "").slice(0, 200),
        },
        google_etag: event.etag ?? null,
        google_synced_at: stamp,
      });
      result.updated++;
      continue;
    }
    try {
      await repo.insertEvent({
        id: crypto.randomUUID(),
        title,
        kind: day ? "task" : "event",
        category: "other",
        start_at,
        end_at,
        timezone: schedule.timeZone,
        // External commitments are treated as fixed until the student says otherwise.
        is_fixed: !day,
        priority: 2,
        deadline_at: null,
        is_splittable: false,
        minimum_block_minutes: 30,
        recurrence: "never",
        exception_dates: [],
        completed: false,
        completed_dates: [],
        status: "confirmed",
        details: {
          location: (event.location ?? "").slice(0, 200),
          notes: "",
          participants: "",
          reminder: "None",
          position: "",
          swapRequested: false,
        },
        google_event_id: event.id,
        google_calendar_id: PRIMARY,
        google_etag: event.etag ?? null,
        google_synced_at: stamp,
      });
      result.imported++;
    } catch (error) {
      if (error instanceof AppError && error.code === "DUPLICATE_EVENT")
        skip("Already in ShiftSync");
      else throw error;
    }
  }
  await repo.saveGoogleConnection({
    calendar_last_sync_at: stamp,
    calendar_last_sync_error: null,
  });
  return result;
}

/**
 * Checks proposed blocks against the live Google Calendar. Returns why a
 * block is no longer free, or null. If Google cannot be reached the check is
 * skipped and the caller reports the sync result separately.
 */
export async function calendarProblem(
  deps: Google,
  repo: Repo,
  schedule: Schedule,
  blocks: Slot[],
): Promise<string | null> {
  const connection = await repo.getGoogleConnection();
  if (!connection || connection.status !== "active") return null;
  let token: string;
  try {
    ({ token } = await googleAccess(
      deps.google,
      deps.tokenKey,
      repo,
      "calendar",
      deps.now(),
    ));
  } catch {
    return null;
  }
  const dates = blocks.map((b) => b.date).sort();
  const { timeMin, timeMax } = inRange(
    schedule,
    dates[0],
    dates[dates.length - 1],
  );
  let events: GoogleEvent[];
  try {
    events = await deps.google.listEvents(token, PRIMARY, timeMin, timeMax);
  } catch {
    deps.log.warn("calendar_revalidation_skipped");
    return null;
  }
  const known = new Set(
    schedule.rows.map((row) => row.google_event_id).filter(Boolean),
  );
  const ownIds = new Set(schedule.rows.map((row) => row.id));
  for (const event of events) {
    if (event.status === "cancelled" || known.has(event.id)) continue;
    if (ownIds.has(event.extendedProperties?.private?.shiftsyncId ?? ""))
      continue;
    if ((event as { transparency?: string }).transparency === "transparent")
      continue;
    const times = localTimes(event, schedule.timeZone);
    if (!times) continue;
    const clash = blocks.find(
      (b) =>
        b.date === times.date &&
        minutes(b.start) < minutes(times.end) &&
        minutes(times.start) < minutes(b.end),
    );
    if (clash)
      return `${event.summary?.trim() || "An event"} in your Google Calendar now overlaps ${formatDate(clash.date, true)}, ${formatTime(clash.start)}–${formatTime(clash.end)}.`;
  }
  return null;
}

/** Pushes an approved recovery to the linked Google event, if any. */
export async function pushRecovery(
  deps: Google,
  repo: Repo,
  original: EventRow,
  changed: EventRow[],
  createdIds: string[],
): Promise<CalendarSyncReport> {
  if (!original.google_event_id || !original.google_calendar_id)
    return { status: "not_linked" };
  let token: string;
  try {
    ({ token } = await googleAccess(
      deps.google,
      deps.tokenKey,
      repo,
      "calendar",
      deps.now(),
    ));
  } catch (error) {
    if (error instanceof AppError) return { status: "not_connected" };
    return {
      status: "failed",
      message:
        "Google Calendar could not be reached. Your ShiftSync schedule was updated.",
    };
  }
  const calendarId = original.google_calendar_id;
  const stamp = () => deps.now().toISOString();
  let updated = 0;
  let created = 0;
  try {
    const main = changed.find((row) => row.id === original.id);
    if (main) {
      const event = await deps.google.patchEvent(
        token,
        calendarId,
        original.google_event_id,
        {
          summary: main.title,
          start: { dateTime: main.start_at },
          end: { dateTime: main.end_at },
        },
        original.google_etag ?? undefined,
      );
      await repo.updateEvent(main.id, {
        google_etag: event.etag ?? null,
        google_synced_at: stamp(),
      });
      updated++;
    }
    for (const row of changed.filter((r) => createdIds.includes(r.id))) {
      const body = {
        summary: row.title,
        location: row.details.location || undefined,
        start: { dateTime: row.start_at },
        end: { dateTime: row.end_at },
        extendedProperties: { private: { shiftsyncId: row.id } },
      };
      // A retry finds the event it already created instead of adding another.
      const event =
        (await deps.google.findByShiftSyncId(token, calendarId, row.id)) ??
        (await deps.google.insertEvent(token, calendarId, body));
      await repo.updateEvent(row.id, {
        google_event_id: event.id,
        google_calendar_id: calendarId,
        google_etag: event.etag ?? null,
        google_synced_at: stamp(),
      });
      created++;
    }
    return { status: "synced", updated, created };
  } catch (error) {
    const status = error instanceof GoogleApiError ? error.status : 0;
    const message =
      status === 412
        ? "This event was changed in Google Calendar, so ShiftSync did not overwrite it. Your ShiftSync schedule was updated."
        : status === 404 || status === 410
          ? "This event no longer exists in Google Calendar. Your ShiftSync schedule was updated."
          : "Google Calendar was not updated. Your ShiftSync schedule was updated.";
    deps.log.warn("calendar_push_failed", { status });
    return { status: "failed", message };
  }
}

const pushFailure = (error: unknown) => {
  const status = error instanceof GoogleApiError ? error.status : 0;
  return status === 412
    ? "This event was changed in Google Calendar, so ShiftSync did not overwrite it. Your ShiftSync change was saved."
    : status === 404 || status === 410
      ? "This event no longer exists in Google Calendar. Your ShiftSync change was saved."
      : "Google Calendar was not updated. Your ShiftSync change was saved.";
};

/**
 * Sends a student's edit of a Google-linked event to that same Google
 * event. Returns null when there is nothing to send. The event's etag
 * guards against overwriting a change made in Google meanwhile.
 */
export async function pushEventEdit(
  deps: Google,
  repo: Repo,
  before: EventRow,
  after: EventRow,
): Promise<CalendarSyncReport | null> {
  if (!after.google_event_id || !after.google_calendar_id) return null;
  if (after.recurrence !== "never") return null;
  const changed =
    before.start_at !== after.start_at ||
    before.end_at !== after.end_at ||
    before.title !== after.title ||
    before.details.location !== after.details.location;
  if (!changed) return null;
  let token: string;
  try {
    ({ token } = await googleAccess(
      deps.google,
      deps.tokenKey,
      repo,
      "calendar",
      deps.now(),
    ));
  } catch (error) {
    if (error instanceof AppError) return { status: "not_connected" };
    return { status: "failed", message: pushFailure(error) };
  }
  try {
    const event = await deps.google.patchEvent(
      token,
      after.google_calendar_id,
      after.google_event_id,
      {
        summary: after.title,
        location: after.details.location || undefined,
        start: { dateTime: after.start_at },
        end: { dateTime: after.end_at },
      },
      before.google_etag ?? undefined,
    );
    await repo.updateEvent(after.id, {
      google_etag: event.etag ?? null,
      google_synced_at: deps.now().toISOString(),
    });
    return { status: "synced", updated: 1, created: 0 };
  } catch (error) {
    deps.log.warn("calendar_edit_push_failed", {
      status: error instanceof GoogleApiError ? error.status : null,
    });
    return { status: "failed", message: pushFailure(error) };
  }
}

/** Adds a ShiftSync event to the student's Google Calendar once. */
export async function exportEvent(
  deps: Google,
  repo: Repo,
  row: EventRow,
): Promise<{ row: EventRow; created: boolean }> {
  if (row.google_event_id) return { row, created: false };
  if (row.recurrence !== "never")
    throw new AppError(
      "VALIDATION_ERROR",
      "Repeating events can't be added to Google Calendar from ShiftSync yet.",
    );
  const { token } = await googleAccess(
    deps.google,
    deps.tokenKey,
    repo,
    "calendar",
    deps.now(),
  );
  try {
    // A retry finds the event it already created instead of adding another.
    const event =
      (await deps.google.findByShiftSyncId(token, PRIMARY, row.id)) ??
      (await deps.google.insertEvent(token, PRIMARY, {
        summary: row.title,
        location: row.details.location || undefined,
        start: { dateTime: row.start_at },
        end: { dateTime: row.end_at },
        extendedProperties: { private: { shiftsyncId: row.id } },
      }));
    const linked = await repo.updateEvent(row.id, {
      google_event_id: event.id,
      google_calendar_id: PRIMARY,
      google_etag: event.etag ?? null,
      google_synced_at: deps.now().toISOString(),
    });
    return { row: linked ?? row, created: true };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "SYNC_FAILED",
      "Google Calendar couldn't add this event. Nothing changed in Google.",
    );
  }
}
