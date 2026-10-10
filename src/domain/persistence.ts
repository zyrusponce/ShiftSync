import type { AppData, Preferences, Profile, ScheduleItem } from "./types";
import { createInitialData } from "./seed";
import { dateKey, parseDate, validateItem } from "./schedule";

export function restoreData(raw: string): AppData {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object")
    throw new Error("Invalid saved data");
  const value = parsed as AppData;
  const defaults = createInitialData();
  if (
    value.version !== 1 ||
    typeof value.onboarded !== "boolean" ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.availability) ||
    !value.preferences ||
    typeof value.preferences !== "object"
  )
    throw new Error("Invalid saved data");
  const validDate = (date: unknown): date is string =>
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(parseDate(date).getTime()) &&
    dateKey(parseDate(date)) === date;
  if (
    !value.items.every(
      (item) =>
        item &&
        Object.entries(defaults.items[0]).every(
          ([key, expected]) =>
            typeof item[key as keyof ScheduleItem] === typeof expected,
        ) &&
        item.id.trim() &&
        !validateItem(item) &&
        ["event", "shift", "task", "unavailable"].includes(item.kind) &&
        ["Never", "Daily", "Weekly"].includes(item.repeat) &&
        ["Work", "Personal", "Important"].includes(item.category) &&
        ["Confirmed", "Open", "Cancelled"].includes(item.status) &&
        ["Low", "Medium", "High"].includes(item.priority) &&
        (item.exceptions === undefined ||
          (Array.isArray(item.exceptions) && item.exceptions.every(validDate))),
    )
  )
    throw new Error("Invalid saved items");
  if (new Set(value.items.map((item) => item.id)).size !== value.items.length)
    throw new Error("Duplicate saved item IDs");
  if (
    value.availability.length !== 7 ||
    new Set(value.availability.map((day) => day?.day)).size !== 7 ||
    !value.availability.every(
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
  )
    throw new Error("Invalid saved availability");
  const preferences = value.preferences;
  if (
    !Object.entries(defaults.preferences).every(
      ([key, expected]) =>
        typeof preferences[key as keyof Preferences] === typeof expected,
    ) ||
    !["Month", "Week", "Day"].includes(preferences.defaultView) ||
    !["Monday", "Sunday"].includes(preferences.weekStarts) ||
    !["Any", "Morning", "Evening"].includes(preferences.preferredPeriod) ||
    !["Daily", "Weekly", "Off"].includes(preferences.aiFrequency) ||
    !["Light", "Dark", "System"].includes(preferences.appearance) ||
    ![0, 5, 15, 30, 60].includes(preferences.bufferMinutes) ||
    ![30, 60, 90, 120].includes(preferences.defaultDuration)
  )
    throw new Error("Invalid saved preferences");
  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: preferences.timeZone,
    }).format();
  } catch {
    throw new Error("Invalid saved time zone");
  }
  if (
    value.profile !== null &&
    (!value.profile ||
      !["name", "email", "organization", "role"].every(
        (key) => typeof value.profile?.[key as keyof Profile] === "string",
      ) ||
      !value.profile.name.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.profile.email) ||
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
  return value;
}
