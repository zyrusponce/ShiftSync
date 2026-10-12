import type {
  AppData,
  Contact,
  ConflictStatus,
  Preferences,
  Profile,
  ScheduleItem,
} from "./types";
import { defaultPreferences } from "./seed";
import { dateKey, parseDate, validateItem } from "./schedule";
import { isValidTimeZone } from "./time";

export const CATEGORIES = [
  "Work",
  "Class",
  "Study",
  "Personal",
  "Important",
  "Other",
] as const;
export const CONTACT_ROLES = ["Work", "School", "Other"] as const;
export const CONFLICT_STATUSES: ConflictStatus[] = [
  "unresolved",
  "draft_prepared",
  "user_contacted",
  "resolved",
  "dismissed",
];
export const TRAVEL_OPTIONS = [0, 10, 15, 20, 30, 45, 60];
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 254 && EMAIL_PATTERN.test(value);

export const validDate = (date: unknown): date is string =>
  typeof date === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  !Number.isNaN(parseDate(date).getTime()) &&
  dateKey(parseDate(date)) === date;
export const validStamp = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value) &&
  validDate(value.slice(0, 10));

const BASE_ITEM_TYPES: Record<string, string> = {
  id: "string",
  kind: "string",
  title: "string",
  date: "string",
  start: "string",
  end: "string",
  category: "string",
  location: "string",
  notes: "string",
  participants: "string",
  reminder: "string",
  repeat: "string",
  priority: "string",
  completed: "boolean",
  status: "string",
  position: "string",
  swapRequested: "boolean",
};
const optional = <T>(value: T | undefined, check: (value: T) => boolean) =>
  value === undefined || check(value);
const shortText = (value: unknown, max = 1024) =>
  typeof value === "string" && !!value && value.length <= max;

/** Checks a stored or received item before it reaches scheduling. */
export function isValidItem(value: unknown): value is ScheduleItem {
  if (!value || typeof value !== "object") return false;
  const item = value as ScheduleItem;
  return (
    Object.entries(BASE_ITEM_TYPES).every(
      ([key, type]) => typeof item[key as keyof ScheduleItem] === type,
    ) &&
    !!item.id.trim() &&
    !validateItem(item) &&
    ["event", "shift", "task", "unavailable"].includes(item.kind) &&
    ["Never", "Daily", "Weekly"].includes(item.repeat) &&
    (CATEGORIES as readonly string[]).includes(item.category) &&
    ["Confirmed", "Open", "Cancelled"].includes(item.status) &&
    ["Low", "Medium", "High"].includes(item.priority) &&
    optional(
      item.exceptions,
      (dates) => Array.isArray(dates) && dates.every(validDate),
    ) &&
    optional(
      item.completedDates,
      (dates) => Array.isArray(dates) && dates.every(validDate),
    ) &&
    optional(item.fixed, (fixed) => typeof fixed === "boolean") &&
    optional(item.deadline, validStamp) &&
    optional(item.splittable, (split) => typeof split === "boolean") &&
    optional(
      item.minBlockMinutes,
      (min) => Number.isInteger(min) && min >= 5 && min <= 480,
    ) &&
    optional(
      item.contactIds,
      (ids) =>
        Array.isArray(ids) &&
        ids.length <= 10 &&
        ids.every((id) => shortText(id, 64)),
    ) &&
    optional(item.googleEventId, (id) => shortText(id)) &&
    optional(item.googleCalendarId, (id) => shortText(id)) &&
    optional(item.version, (v) => Number.isInteger(v) && v > 0)
  );
}
export function isValidContact(value: unknown): value is Contact {
  if (!value || typeof value !== "object") return false;
  const contact = value as Contact;
  return (
    shortText(contact.id, 64) &&
    typeof contact.name === "string" &&
    !!contact.name.trim() &&
    contact.name.length <= 120 &&
    isEmail(contact.email) &&
    (CONTACT_ROLES as readonly string[]).includes(contact.role)
  );
}
/** Adds settings introduced after a device first saved its preferences. */
export function migratePreferences(value: Partial<Preferences>): Preferences {
  const defaults = defaultPreferences();
  return {
    ...value,
    travelMinutes: value.travelMinutes ?? defaults.travelMinutes,
    planningHorizonDays:
      value.planningHorizonDays ?? defaults.planningHorizonDays,
    recoveryWeights: value.recoveryWeights ?? defaults.recoveryWeights,
  } as Preferences;
}
export function isValidPreferences(value: unknown): value is Preferences {
  if (!value || typeof value !== "object") return false;
  const preferences = value as Preferences;
  const defaults = defaultPreferences();
  const weights = preferences.recoveryWeights;
  return (
    Object.entries(defaults).every(
      ([key, expected]) =>
        typeof preferences[key as keyof Preferences] === typeof expected,
    ) &&
    ["Month", "Week", "Day"].includes(preferences.defaultView) &&
    ["Monday", "Sunday"].includes(preferences.weekStarts) &&
    ["Any", "Morning", "Evening"].includes(preferences.preferredPeriod) &&
    ["Daily", "Weekly", "Off"].includes(preferences.aiFrequency) &&
    ["Light", "Dark", "System"].includes(preferences.appearance) &&
    [0, 5, 15, 30, 60].includes(preferences.bufferMinutes) &&
    [30, 60, 90, 120].includes(preferences.defaultDuration) &&
    TRAVEL_OPTIONS.includes(preferences.travelMinutes) &&
    Number.isInteger(preferences.planningHorizonDays) &&
    preferences.planningHorizonDays >= 1 &&
    preferences.planningHorizonDays <= 14 &&
    !!weights &&
    ["deadline", "preference", "closeness", "breakTravel"].every((key) => {
      const weight = weights[key as keyof typeof weights];
      return (
        typeof weight === "number" &&
        Number.isFinite(weight) &&
        weight >= 0 &&
        weight <= 1
      );
    }) &&
    isValidTimeZone(preferences.timeZone)
  );
}
export function isValidAvailability(
  value: unknown,
): value is AppData["availability"] {
  return (
    Array.isArray(value) &&
    value.length === 7 &&
    new Set(value.map((day) => day?.day)).size === 7 &&
    value.every(
      (day) =>
        day &&
        Number.isInteger(day.day) &&
        day.day >= 0 &&
        day.day <= 6 &&
        typeof day.enabled === "boolean" &&
        typeof day.start === "string" &&
        typeof day.end === "string" &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(day.start) &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(day.end) &&
        day.end > day.start,
    )
  );
}

export function restoreData(raw: string): AppData {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object")
    throw new Error("Invalid saved data");
  const value = parsed as AppData;
  if (
    value.version !== 1 ||
    typeof value.onboarded !== "boolean" ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.availability) ||
    !value.preferences ||
    typeof value.preferences !== "object"
  )
    throw new Error("Invalid saved data");
  if (!value.items.every(isValidItem)) throw new Error("Invalid saved items");
  if (new Set(value.items.map((item) => item.id)).size !== value.items.length)
    throw new Error("Duplicate saved item IDs");
  if (!isValidAvailability(value.availability))
    throw new Error("Invalid saved availability");
  const preferences = migratePreferences(value.preferences);
  if (!isValidPreferences(preferences))
    throw new Error("Invalid saved preferences");
  if (
    value.profile !== null &&
    (!value.profile ||
      !["name", "email", "organization", "role"].every(
        (key) => typeof value.profile?.[key as keyof Profile] === "string",
      ) ||
      !value.profile.name.trim() ||
      !EMAIL_PATTERN.test(value.profile.email) ||
      !["Student", "Employee", "Manager", "Freelancer", "Other"].includes(
        value.profile.role,
      ))
  )
    throw new Error("Invalid saved profile");
  if (
    !["ignoredConflicts", "readNotifications", "deletedNotifications"].every(
      (key) =>
        Array.isArray(value[key as keyof AppData]) &&
        (value[key as keyof AppData] as unknown[]).every(
          (entry) => typeof entry === "string",
        ),
    )
  )
    throw new Error("Invalid saved metadata");
  const contacts = value.contacts ?? [];
  if (!Array.isArray(contacts) || !contacts.every(isValidContact))
    throw new Error("Invalid saved contacts");
  const conflictStatus = value.conflictStatus ?? {};
  if (
    typeof conflictStatus !== "object" ||
    Array.isArray(conflictStatus) ||
    !Object.values(conflictStatus).every((status) =>
      CONFLICT_STATUSES.includes(status),
    )
  )
    throw new Error("Invalid saved conflict status");
  return { ...value, preferences, contacts, conflictStatus };
}
