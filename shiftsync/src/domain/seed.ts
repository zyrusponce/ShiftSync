import { addDays, dateKey } from "./schedule";
import { uuid } from "./ids";
import { DEFAULT_HORIZON_DAYS, DEFAULT_WEIGHTS } from "./recovery";
import type {
  AppData,
  Contact,
  ItemKind,
  Preferences,
  ScheduleItem,
} from "./types";

export function newItem(
  kind: ItemKind = "event",
  date = dateKey(),
): ScheduleItem {
  return {
    id: uuid(),
    kind,
    title: "",
    date,
    start: "09:00",
    end: "10:00",
    category:
      kind === "shift" ? "Work" : kind === "task" ? "Important" : "Personal",
    location: "",
    notes: "",
    participants: "",
    reminder: "15 minutes before",
    repeat: "Never",
    priority: "Medium",
    completed: false,
    status: "Confirmed",
    position: "",
    swapRequested: false,
  };
}
export function defaultPreferences(): Preferences {
  return {
    avoidOverlaps: true,
    avoidBackToBack: false,
    bufferMinutes: 0,
    preferredPeriod: "Any",
    aiEnabled: true,
    suggestions: true,
    conflictSuggestions: true,
    aiFrequency: "Daily",
    defaultView: "Month",
    weekStarts: "Monday",
    defaultDuration: 60,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Manila",
    appearance: "Light",
    reminders: true,
    conflictAlerts: true,
    shiftNotifications: true,
    travelMinutes: 0,
    planningHorizonDays: DEFAULT_HORIZON_DAYS,
    recoveryWeights: { ...DEFAULT_WEIGHTS },
  };
}
export function defaultAvailability() {
  return Array.from({ length: 7 }, (_, day) => ({
    day,
    enabled: true,
    start: "07:00",
    end: "22:00",
  }));
}
/** A fresh, empty schedule for a signed-in account. */
export function createEmptyData(): AppData {
  return {
    ...createInitialData(),
    items: [],
    contacts: [],
  };
}
// The demo is a working student's week: classes and shifts that cannot move,
// study that can, and contacts for the people a fixed conflict involves.
export function createInitialData(): AppData {
  const today = dateKey();
  const tomorrow = addDays(today, 1);
  const supervisor: Contact = {
    id: uuid(),
    name: "Dana Cruz",
    email: "supervisor@example.com",
    role: "Work",
  };
  const professor: Contact = {
    id: uuid(),
    name: "Prof. Reyes",
    email: "professor@example.com",
    role: "School",
  };
  const sample = (
    kind: ItemKind,
    title: string,
    start: string,
    end: string,
    extra: Partial<ScheduleItem> = {},
  ): ScheduleItem => ({ ...newItem(kind, today), title, start, end, ...extra });
  return {
    version: 1,
    profile: null,
    onboarded: false,
    items: [
      sample("event", "Data Structures class", "09:00", "11:00", {
        category: "Class",
        location: "Room 204",
        contactIds: [professor.id],
      }),
      sample("shift", "Afternoon shift", "14:00", "18:00", {
        location: "Main Branch",
        position: "Barista",
        category: "Work",
        contactIds: [supervisor.id],
      }),
      sample("event", "Assignment work", "19:00", "20:00", {
        category: "Study",
        splittable: true,
        minBlockMinutes: 30,
      }),
      sample("event", "Exam review", "10:00", "12:00", {
        date: tomorrow,
        category: "Study",
        priority: "High",
        deadline: `${addDays(today, 2)}T09:00`,
        splittable: true,
        minBlockMinutes: 60,
        notes: "Statistics midterm is the morning after.",
      }),
      sample("event", "Statistics class", "13:00", "15:00", {
        date: tomorrow,
        category: "Class",
        location: "Room 118",
        contactIds: [professor.id],
      }),
      sample("shift", "Evening shift", "16:00", "20:00", {
        date: tomorrow,
        location: "Main Branch",
        position: "Barista",
        category: "Work",
        contactIds: [supervisor.id],
      }),
      sample("task", "Submit project report", "16:00", "17:00", {
        date: tomorrow,
        priority: "High",
        notes: "Review the final draft before submitting.",
      }),
      sample("shift", "Weekend opening", "08:00", "12:00", {
        date: addDays(today, 2),
        location: "North Branch",
        position: "Barista",
        status: "Open",
        category: "Work",
      }),
    ],
    availability: defaultAvailability(),
    preferences: defaultPreferences(),
    ignoredConflicts: [],
    readNotifications: [],
    deletedNotifications: [],
    contacts: [supervisor, professor],
    conflictStatus: {},
  };
}
