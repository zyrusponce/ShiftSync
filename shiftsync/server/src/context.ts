// Loads a signed-in user's settings and schedule in their own time zone.
import type { AccountSettings } from "../../src/domain/contract";
import {
  isValidAvailability,
  isValidPreferences,
  migratePreferences,
} from "../../src/domain/persistence";
import { findConflicts } from "../../src/domain/schedule";
import { defaultAvailability, defaultPreferences } from "../../src/domain/seed";
import { isValidTimeZone, zonedNow } from "../../src/domain/time";
import type { LocalNow } from "../../src/domain/recovery";
import type { Conflict, ScheduleItem } from "../../src/domain/types";
import { rowsToItems } from "./mapping";
import type { EventRow, ProfileRow, Repo } from "./repo/types";

type Stored = {
  preferences?: Record<string, unknown>;
  availability?: unknown;
  profile?: { organization?: unknown; role?: unknown };
  onboarded?: unknown;
};
const ROLES = ["Student", "Employee", "Manager", "Freelancer", "Other"];

export function settingsFrom(
  profile: ProfileRow | null,
  email: string,
): AccountSettings {
  const stored = (profile?.preferences_json ?? {}) as Stored;
  const timeZone =
    profile && isValidTimeZone(profile.timezone) ? profile.timezone : "UTC";
  const candidate = migratePreferences({
    ...defaultPreferences(),
    ...stored.preferences,
    timeZone,
  });
  const role = String(stored.profile?.role ?? "Student");
  return {
    profile: {
      name: profile?.display_name || email.split("@")[0] || "Student",
      email: profile?.email ?? email,
      organization: String(stored.profile?.organization ?? "").slice(0, 120),
      role: ROLES.includes(role) ? role : "Student",
    },
    onboarded: stored.onboarded === true,
    preferences: isValidPreferences(candidate)
      ? candidate
      : { ...defaultPreferences(), timeZone },
    availability: isValidAvailability(stored.availability)
      ? stored.availability
      : defaultAvailability(),
  };
}

export type Schedule = {
  settings: AccountSettings;
  timeZone: string;
  rows: EventRow[];
  items: ScheduleItem[];
  now: LocalNow;
};
export async function loadSchedule(
  repo: Repo,
  email: string,
  clock: Date,
): Promise<Schedule> {
  const [profile, rows, links] = await Promise.all([
    repo.getProfile(),
    repo.listEvents(),
    repo.listEventContacts(),
  ]);
  const settings = settingsFrom(profile, email);
  const timeZone = settings.preferences.timeZone;
  return {
    settings,
    timeZone,
    rows,
    items: rowsToItems(rows, links, timeZone),
    now: zonedNow(timeZone, clock),
  };
}

/** A conflict that is still detected now. Conflict ids start with their date. */
export function findConflict(
  schedule: Schedule,
  conflictId: string,
): Conflict | null {
  const date = conflictId.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const { items, settings } = schedule;
  return (
    findConflicts(
      items,
      settings.availability,
      settings.preferences,
      date,
      1,
    ).find((conflict) => conflict.id === conflictId) ?? null
  );
}
export const currentConflicts = (schedule: Schedule, days = 14) =>
  findConflicts(
    schedule.items,
    schedule.settings.availability,
    schedule.settings.preferences,
    schedule.now.date,
    days,
  );
