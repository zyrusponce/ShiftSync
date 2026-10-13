// The API contract shared by the mobile app and the backend.
import type { ImpactReport } from "./impact";
import type { RecoveryOption, SearchWindow } from "./recovery";
import type {
  AvailabilityDay,
  Contact,
  ConflictStatus,
  ConflictType,
  Preferences,
  Profile,
  ScheduleItem,
  Slot,
} from "./types";
import type { PairType } from "./policy";

export const ERROR_CODES = [
  "UNAUTHORIZED",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "CONFLICT_DETECTED",
  "VERSION_CONFLICT",
  "DUPLICATE_EVENT",
  "NO_FEASIBLE_SLOT",
  "STALE_SUGGESTION",
  "REQUEST_IN_PROGRESS",
  "SYNC_FAILED",
  "GOOGLE_NOT_CONNECTED",
  "GOOGLE_NOT_CONFIGURED",
  "EMAIL_SEND_FAILED",
  "AI_SERVICE_UNAVAILABLE",
  "EMAIL_NOT_CONFIRMED",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export type ApiErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    requestId?: string;
    details?: unknown;
  };
};

// Auth
export type AuthUser = { id: string; email: string; displayName: string };
export type Session = {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds. */
  expiresAt: number;
  user: AuthUser;
};
export type SignUpRequest = {
  email: string;
  password: string;
  displayName: string;
};
export type SignUpResponse =
  { status: "signed_in"; session: Session } | { status: "confirm_email" };
export type LoginRequest = { email: string; password: string };
export type RefreshRequest = { refreshToken: string };

// Settings
export type AccountSettings = {
  profile: Profile;
  onboarded: boolean;
  preferences: Preferences;
  availability: AvailabilityDay[];
};
export type PreferencesResponse = AccountSettings;
export type PreferencesPatch = Partial<AccountSettings>;

// Events and contacts
export type EventsQuery = {
  from?: string;
  to?: string;
  category?: ScheduleItem["category"];
  kind?: ScheduleItem["kind"];
  upcoming?: boolean;
};
export type EventsResponse = { items: ScheduleItem[]; timeZone: string };
export type EventResponse = {
  item: ScheduleItem;
  replayed?: boolean;
  /** Set when the event is linked to Google Calendar and was pushed there. */
  calendar?: CalendarSyncReport;
};
export type EventWrite = ScheduleItem & { expectedVersion?: number };
export type ContactsResponse = { contacts: Contact[] };
export type ContactResponse = { contact: Contact };

// Conflicts
export type ConflictRecord = {
  id: string;
  date: string;
  type: ConflictType;
  pairType: PairType | null;
  status: ConflictStatus;
  eventIds: string[];
  reason: string;
  detectedAt: string;
};
export type ConflictsResponse = { conflicts: ConflictRecord[] };
export type ConflictStatusRequest = { status: ConflictStatus };
export type AnalyzeRequest = { shift: ScheduleItem; horizonDays?: number };
export type AnalyzeResponse = { report: ImpactReport };

// Recovery
export type SuggestionsRequest = {
  eventId: string;
  occurrenceDate: string;
  conflictId?: string;
  /** Blocks other planned recoveries will use. */
  reserved?: Slot[];
};
export type Suggestion = RecoveryOption & {
  suggestionId: string;
  status: "pending" | "approved" | "stale" | "superseded";
};
export type SuggestionsResponse =
  | { status: "OK"; suggestions: Suggestion[]; window: SearchWindow }
  | {
      status: "NO_FEASIBLE_SLOT" | "NOT_MOVABLE";
      reason: string;
      window: SearchWindow;
    };
export type CalendarSyncReport =
  | { status: "already_applied" }
  | { status: "not_linked" }
  | { status: "not_connected" }
  | { status: "synced"; updated: number; created: number }
  | { status: "failed"; message: string };
export type ApproveResponse = {
  items: ScheduleItem[];
  removedIds: string[];
  calendar: CalendarSyncReport;
};

// AI and email
/** Explain a detected conflict, or the impact of a proposed shift change. */
export type ExplainRequest = { conflictId: string } | AnalyzeRequest;
export type ExplainResponse = {
  text: string;
  source: "ai" | "template";
  fallbackReason?: ErrorCode | "AI_OUTPUT_REJECTED" | "AI_DISABLED";
};
export type NotificationStatus =
  "prepared" | "draft_saved" | "sending" | "sent" | "failed";
export type EmailNotification = {
  id: string;
  conflictId: string;
  contactId: string | null;
  recipientEmail: string;
  recipientName: string;
  recipientRole: Contact["role"];
  subject: string;
  body: string;
  source: "ai" | "template" | "user";
  status: NotificationStatus;
  gmailDraftId: string | null;
  gmailMessageId: string | null;
  errorCode: string | null;
  sentAt: string | null;
  updatedAt: string;
};
export type DraftRequest = { conflictId: string; contactId: string };
export type DraftResponse = {
  notification: EmailNotification;
  source: "ai" | "template";
  fallbackReason?: ExplainResponse["fallbackReason"];
};
export type NotificationsResponse = { notifications: EmailNotification[] };
export type GmailDraftRequest = {
  notificationId: string;
  subject: string;
  body: string;
};
export type GmailSendRequest = GmailDraftRequest & {
  /** Must be true: the student explicitly confirmed this exact message. */
  confirmed: true;
  /** The address shown to the student when they confirmed. */
  recipientEmail: string;
};
export type NotificationResponse = { notification: EmailNotification };

// Google
export type GoogleService = "calendar" | "gmail";
export type GoogleStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  calendar: boolean;
  gmail: boolean;
  needsReconnect: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
};
export type GoogleConnectRequest = {
  services: GoogleService[];
  returnUrl: string;
};
export type GoogleConnectResponse = { authUrl: string };
export type GoogleCompleteRequest = { handle: string };
/** Sign in with Google. The app keeps `codeVerifier` and sends its SHA-256. */
export type GoogleLoginStartRequest = {
  returnUrl: string;
  codeChallenge: string;
};
export type GoogleLoginCompleteRequest = {
  handle: string;
  codeVerifier: string;
};
export type CalendarExportResponse = { item: ScheduleItem; created: boolean };

// CalenBud chat
export type ChatMessage = { role: "user" | "assistant"; text: string };
export type ChatRequest = { messages: ChatMessage[] };
/** Suggestions CalenBud may offer. Nothing changes until the student acts. */
export type ChatAction =
  | {
      type: "change_shift";
      shiftId: string;
      title: string;
      date: string;
      start: string;
      end: string;
    }
  | {
      type: "add_item";
      kind: "event" | "task" | "shift";
      title: string;
      date: string;
      start: string;
      end: string;
      category: "Work" | "Class" | "Study" | "Personal" | "Important" | "Other";
      location: string;
    }
  | {
      type: "remove_item";
      itemId: string;
      title: string;
      date: string;
      start: string;
      end: string;
    }
  | { type: "resolve_conflict"; conflictId: string; title: string }
  | { type: "show_conflicts" };
export type ChatResponse = {
  reply: string;
  source: "ai" | "rules";
  action: ChatAction | null;
  fallbackReason?: ExplainResponse["fallbackReason"];
};
export type CalendarSyncResponse = {
  imported: number;
  updated: number;
  unchanged: number;
  skipped: { reason: string; count: number }[];
  needsReview: string[];
};
