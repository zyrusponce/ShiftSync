import { addDays, dateKey } from "./schedule";
import type { AppData, ItemKind, ScheduleItem } from "./types";

export function newItem(
  kind: ItemKind = "event",
  date = dateKey(),
): ScheduleItem {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
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
export function createInitialData(): AppData {
  const today = dateKey();
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
      sample("event", "Team catch-up", "09:00", "10:00", {
        category: "Work",
        location: "Meeting room A",
        participants: "Your team",
        notes: "A quick check-in on this week’s priorities.",
      }),
      sample("event", "Lunch & a little reset", "12:00", "13:00", {
        category: "Personal",
        reminder: "None",
      }),
      sample("shift", "Afternoon shift", "14:00", "18:00", {
        location: "Main Branch",
        position: "Team member",
        category: "Work",
      }),
      sample("shift", "Work shift", "14:00", "18:00", {
        date: addDays(today, 1),
        location: "Main Branch",
        position: "Team member",
        category: "Work",
      }),
      sample("event", "Project meeting", "16:00", "17:00", {
        date: addDays(today, 1),
        category: "Work",
        location: "Online",
        participants: "Project group",
      }),
      sample("task", "Submit project report", "16:00", "17:00", {
        date: addDays(today, 1),
        priority: "High",
        notes: "Review the final draft before submitting.",
      }),
      sample("shift", "Weekend opening", "08:00", "12:00", {
        date: addDays(today, 2),
        location: "North Branch",
        position: "Team member",
        status: "Open",
        category: "Work",
      }),
    ],
    availability: Array.from({ length: 7 }, (_, day) => ({
      day,
      enabled: day !== 0,
      start: "08:00",
      end: "20:00",
    })),
    preferences: {
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
      timeZone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Manila",
      appearance: "Light",
      reminders: true,
      conflictAlerts: true,
      shiftNotifications: true,
    },
    ignoredConflicts: [],
    readNotifications: [],
    deletedNotifications: [],
  };
}
