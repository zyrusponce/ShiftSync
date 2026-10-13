export type ItemKind = "event" | "shift" | "task" | "unavailable";
export type Category =
  "Work" | "Class" | "Study" | "Personal" | "Important" | "Other";
export type Repeat = "Never" | "Daily" | "Weekly";
export type CalendarView = "Month" | "Week" | "Day";
export type Priority = "Low" | "Medium" | "High";
export type ScheduleItem = {
  id: string;
  kind: ItemKind;
  title: string;
  date: string;
  start: string;
  end: string;
  category: Category;
  location: string;
  notes: string;
  participants: string;
  reminder: string;
  repeat: Repeat;
  exceptions?: string[];
  priority: Priority;
  completed: boolean;
  completedDates?: string[];
  status: "Confirmed" | "Open" | "Cancelled";
  position: string;
  swapRequested: boolean;
  // Recovery fields. Older saved items omit them; see policy.ts for defaults.
  /** Fixed commitments are never moved automatically. */
  fixed?: boolean;
  /** Local "YYYY-MM-DDTHH:mm" the work must be finished by. */
  deadline?: string;
  splittable?: boolean;
  minBlockMinutes?: number;
  contactIds?: string[];
  googleEventId?: string;
  googleCalendarId?: string;
  /** Server row version, used to reject edits based on stale data. */
  version?: number;
};
export type ContactRole = "Work" | "School" | "Other";
export type Contact = {
  id: string;
  name: string;
  email: string;
  role: ContactRole;
};
export type AvailabilityDay = {
  day: number;
  enabled: boolean;
  start: string;
  end: string;
};
export type RecoveryWeights = {
  deadline: number;
  preference: number;
  closeness: number;
  breakTravel: number;
};
export type Preferences = {
  avoidOverlaps: boolean;
  avoidBackToBack: boolean;
  bufferMinutes: number;
  preferredPeriod: "Any" | "Morning" | "Evening";
  aiEnabled: boolean;
  suggestions: boolean;
  conflictSuggestions: boolean;
  aiFrequency: "Daily" | "Weekly" | "Off";
  defaultView: CalendarView;
  weekStarts: "Monday" | "Sunday";
  defaultDuration: number;
  timeZone: string;
  appearance: "Light" | "Dark" | "System";
  reminders: boolean;
  conflictAlerts: boolean;
  shiftNotifications: boolean;
  /** Extra time to travel between commitments at different places. */
  travelMinutes: number;
  /** How many days ahead impact analysis and recovery look. */
  planningHorizonDays: number;
  recoveryWeights: RecoveryWeights;
};
export type Profile = {
  name: string;
  email: string;
  organization: string;
  role: string;
};
export type ConflictType = "overlap" | "buffer" | "availability";
export type Conflict = {
  id: string;
  date: string;
  first: ScheduleItem;
  second?: ScheduleItem;
  severity: "High" | "Medium" | "Low";
  type: ConflictType;
  minutes: number;
  reason: string;
};
export type ConflictStatus =
  "unresolved" | "draft_prepared" | "user_contacted" | "resolved" | "dismissed";
export type Slot = { date: string; start: string; end: string };
export type AppData = {
  version: 1;
  profile: Profile | null;
  onboarded: boolean;
  items: ScheduleItem[];
  availability: AvailabilityDay[];
  preferences: Preferences;
  ignoredConflicts: string[];
  readNotifications: string[];
  deletedNotifications: string[];
  contacts: Contact[];
  conflictStatus: Record<string, ConflictStatus>;
};
