// Data access contract. One Repo instance is bound to one signed-in user;
// implementations must only ever see that user's rows.
import type { ConflictStatus, ConflictType } from "../../../src/domain/types";
import type { PairType } from "../../../src/domain/policy";
import type { NotificationStatus } from "../../../src/domain/contract";

export type EventDetails = {
  location: string;
  notes: string;
  participants: string;
  reminder: string;
  position: string;
  swapRequested: boolean;
};
export type EventRow = {
  id: string;
  user_id: string;
  title: string;
  kind: "event" | "shift" | "task" | "unavailable";
  category: "work" | "class" | "study" | "personal" | "important" | "other";
  start_at: string;
  end_at: string;
  timezone: string;
  is_fixed: boolean;
  priority: 1 | 2 | 3;
  deadline_at: string | null;
  is_splittable: boolean;
  minimum_block_minutes: number;
  recurrence: "never" | "daily" | "weekly";
  exception_dates: string[];
  completed: boolean;
  completed_dates: string[];
  status: "confirmed" | "open" | "cancelled";
  details: EventDetails;
  google_event_id: string | null;
  google_calendar_id: string | null;
  google_etag: string | null;
  google_synced_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};
export type EventWrite = Omit<
  EventRow,
  | "user_id"
  | "version"
  | "created_at"
  | "updated_at"
  | "google_etag"
  | "google_synced_at"
> &
  Partial<Pick<EventRow, "google_etag" | "google_synced_at">>;
export type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string;
  timezone: string;
  preferences_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
export type ContactRow = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: "work" | "school" | "other";
  created_at: string;
  updated_at: string;
};
export type ConflictRow = {
  id: string;
  user_id: string;
  conflict_key: string;
  event_a_id: string | null;
  event_b_id: string | null;
  occurrence_date: string;
  conflict_type: ConflictType;
  pair_type: PairType | null;
  status: ConflictStatus;
  detected_at: string;
  status_changed_at: string;
};
export type ConflictInsert = Pick<
  ConflictRow,
  | "conflict_key"
  | "event_a_id"
  | "event_b_id"
  | "occurrence_date"
  | "conflict_type"
  | "pair_type"
>;
export type SuggestionRow = {
  id: string;
  user_id: string;
  conflict_id: string | null;
  event_id: string;
  occurrence_date: string;
  event_version: number;
  kind: "move" | "split";
  proposed_blocks_json: { date: string; start: string; end: string }[];
  score: number;
  rank: number;
  explanation: string;
  status: "pending" | "approved" | "stale" | "superseded";
  result_json: { updated: string[]; created: string[] } | null;
  created_at: string;
  decided_at: string | null;
};
export type SuggestionInsert = Omit<
  SuggestionRow,
  "id" | "user_id" | "status" | "result_json" | "created_at" | "decided_at"
>;
export type NotificationRow = {
  id: string;
  user_id: string;
  conflict_id: string | null;
  conflict_key: string;
  contact_id: string | null;
  recipient_email: string;
  recipient_name: string;
  recipient_role: "work" | "school" | "other";
  subject: string;
  body: string;
  source: "ai" | "template" | "user";
  status: NotificationStatus;
  gmail_draft_id: string | null;
  gmail_message_id: string | null;
  error_code: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};
export type NotificationInsert = Pick<
  NotificationRow,
  | "conflict_id"
  | "conflict_key"
  | "contact_id"
  | "recipient_email"
  | "recipient_name"
  | "recipient_role"
  | "subject"
  | "body"
  | "source"
>;
export type GoogleConnectionRow = {
  user_id: string;
  google_email: string | null;
  scopes: string[];
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_token_expires_at: string | null;
  status: "active" | "needs_reauth";
  calendar_last_sync_at: string | null;
  calendar_last_sync_error: string | null;
  created_at: string;
  updated_at: string;
};
export type GoogleConnectionWrite = Partial<
  Omit<GoogleConnectionRow, "user_id" | "created_at" | "updated_at">
>;
export type RecoveryUpdate = {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  exception_dates: string[] | null;
};
export type RecoveryInsert = Pick<
  EventRow,
  | "id"
  | "title"
  | "kind"
  | "category"
  | "start_at"
  | "end_at"
  | "timezone"
  | "is_fixed"
  | "priority"
  | "deadline_at"
  | "is_splittable"
  | "minimum_block_minutes"
  | "status"
  | "details"
>;
export type IdempotencyState =
  | { state: "new" }
  | { state: "pending" }
  | { state: "done"; status: number; body: unknown };

export interface Repo {
  readonly userId: string;
  getProfile(): Promise<ProfileRow | null>;
  saveProfile(
    patch: Partial<
      Pick<
        ProfileRow,
        "email" | "display_name" | "timezone" | "preferences_json"
      >
    >,
  ): Promise<ProfileRow>;

  listEvents(): Promise<EventRow[]>;
  getEvent(id: string): Promise<EventRow | null>;
  getEvents(ids: string[]): Promise<EventRow[]>;
  findEventByGoogleId(
    calendarId: string,
    eventId: string,
  ): Promise<EventRow | null>;
  /** Throws AppError DUPLICATE_EVENT when the same event already exists. */
  insertEvent(row: EventWrite): Promise<EventRow>;
  /** Returns null when the row is missing or its version has moved on. */
  updateEvent(
    id: string,
    patch: Partial<EventWrite>,
    expectedVersion?: number,
  ): Promise<EventRow | null>;
  deleteEvent(id: string): Promise<boolean>;
  listEventContacts(): Promise<{ event_id: string; contact_id: string }[]>;
  setEventContacts(eventId: string, contactIds: string[]): Promise<void>;

  listContacts(): Promise<ContactRow[]>;
  getContact(id: string): Promise<ContactRow | null>;
  insertContact(
    row: Pick<ContactRow, "id" | "name" | "email" | "role">,
  ): Promise<ContactRow>;
  updateContact(
    id: string,
    patch: Partial<Pick<ContactRow, "name" | "email" | "role">>,
  ): Promise<ContactRow | null>;
  deleteContact(id: string): Promise<boolean>;

  listConflicts(): Promise<ConflictRow[]>;
  /** Records newly detected conflicts; existing keys keep their status. */
  recordConflicts(rows: ConflictInsert[]): Promise<ConflictRow[]>;
  setConflictStatus(
    key: string,
    status: ConflictStatus,
    onlyFrom?: ConflictStatus[],
  ): Promise<ConflictRow | null>;

  insertSuggestions(rows: SuggestionInsert[]): Promise<SuggestionRow[]>;
  getSuggestion(id: string): Promise<SuggestionRow | null>;
  setSuggestionStatus(
    id: string,
    status: SuggestionRow["status"],
  ): Promise<void>;
  supersedeSuggestions(eventId: string, occurrenceDate: string): Promise<void>;
  /** Atomic approval. Throws AppError STALE_SUGGESTION if anything changed. */
  applyRecovery(args: {
    suggestionId: string;
    eventId: string;
    expectedVersion: number;
    updates: RecoveryUpdate[];
    inserts: RecoveryInsert[];
  }): Promise<EventRow[]>;

  insertNotification(row: NotificationInsert): Promise<NotificationRow>;
  getNotification(id: string): Promise<NotificationRow | null>;
  listNotifications(conflictKey?: string): Promise<NotificationRow[]>;
  /** Applies the patch only while the row is in one of the given states. */
  updateNotification(
    id: string,
    patch: Partial<
      Omit<NotificationRow, "id" | "user_id" | "created_at" | "updated_at">
    >,
    onlyIfStatus?: NotificationStatus[],
  ): Promise<NotificationRow | null>;

  getGoogleConnection(): Promise<GoogleConnectionRow | null>;
  saveGoogleConnection(
    row: GoogleConnectionWrite,
  ): Promise<GoogleConnectionRow>;
  deleteGoogleConnection(): Promise<void>;

  beginIdempotent(scope: string, key: string): Promise<IdempotencyState>;
  finishIdempotent(
    scope: string,
    key: string,
    status: number,
    body: unknown,
  ): Promise<void>;
  abandonIdempotent(scope: string, key: string): Promise<void>;
}
