// In-memory Repo used by the API tests. Every method is scoped to the bound
// user, mirroring the row level security policies in the migration.
import crypto from "node:crypto";
import { AppError } from "../http";
import type {
  ConflictRow,
  ContactRow,
  EventRow,
  GoogleConnectionRow,
  IdempotencyState,
  NotificationRow,
  ProfileRow,
  Repo,
  SuggestionRow,
} from "./types";

export type MemoryDb = {
  users: ProfileRow[];
  events: EventRow[];
  contacts: ContactRow[];
  links: { event_id: string; contact_id: string; user_id: string }[];
  conflicts: ConflictRow[];
  suggestions: SuggestionRow[];
  notifications: NotificationRow[];
  google: GoogleConnectionRow[];
  idempotency: {
    user_id: string;
    scope: string;
    key: string;
    state: "pending" | "done";
    status?: number;
    body?: unknown;
  }[];
};
export const createMemoryDb = (): MemoryDb => ({
  users: [],
  events: [],
  contacts: [],
  links: [],
  conflicts: [],
  suggestions: [],
  notifications: [],
  google: [],
  idempotency: [],
});
const now = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);

export function memoryRepoFactory(db: MemoryDb) {
  return (userId: string): Repo => new MemoryRepo(db, userId);
}

class MemoryRepo implements Repo {
  constructor(
    private readonly db: MemoryDb,
    readonly userId: string,
  ) {}
  private mine<T extends { user_id: string }>(rows: T[]) {
    return rows.filter((row) => row.user_id === this.userId);
  }
  private duplicate(
    row: Pick<
      EventRow,
      "id" | "kind" | "title" | "start_at" | "end_at" | "recurrence" | "status"
    >,
  ) {
    return this.mine(this.db.events).some(
      (other) =>
        other.id !== row.id &&
        other.status !== "cancelled" &&
        row.status !== "cancelled" &&
        other.kind === row.kind &&
        other.title.trim().toLowerCase() === row.title.trim().toLowerCase() &&
        other.start_at === row.start_at &&
        other.end_at === row.end_at &&
        other.recurrence === row.recurrence,
    );
  }

  async getProfile() {
    return clone(this.db.users.find((row) => row.id === this.userId) ?? null);
  }
  async saveProfile(patch: Parameters<Repo["saveProfile"]>[0]) {
    let row = this.db.users.find((value) => value.id === this.userId);
    if (!row) {
      row = {
        id: this.userId,
        email: null,
        display_name: "",
        timezone: "UTC",
        preferences_json: {},
        created_at: now(),
        updated_at: now(),
      };
      this.db.users.push(row);
    }
    Object.assign(row, clone(patch), { updated_at: now() });
    return clone(row);
  }

  async listEvents() {
    return clone(
      this.mine(this.db.events).sort((a, b) =>
        a.start_at.localeCompare(b.start_at),
      ),
    );
  }
  async getEvent(id: string) {
    return clone(
      this.mine(this.db.events).find((row) => row.id === id) ?? null,
    );
  }
  async getEvents(ids: string[]) {
    return clone(
      this.mine(this.db.events).filter((row) => ids.includes(row.id)),
    );
  }
  async findEventByGoogleId(calendarId: string, eventId: string) {
    return clone(
      this.mine(this.db.events).find(
        (row) =>
          row.google_calendar_id === calendarId &&
          row.google_event_id === eventId,
      ) ?? null,
    );
  }
  async insertEvent(row: Parameters<Repo["insertEvent"]>[0]) {
    if (
      this.db.events.some((other) => other.id === row.id) ||
      this.duplicate(row)
    )
      throw new AppError(
        "DUPLICATE_EVENT",
        "This event already exists in your schedule.",
      );
    const stored: EventRow = {
      ...clone(row),
      google_etag: row.google_etag ?? null,
      google_synced_at: row.google_synced_at ?? null,
      user_id: this.userId,
      version: 1,
      created_at: now(),
      updated_at: now(),
    };
    this.db.events.push(stored);
    return clone(stored);
  }
  async updateEvent(
    id: string,
    patch: Parameters<Repo["updateEvent"]>[1],
    expectedVersion?: number,
  ) {
    const row = this.mine(this.db.events).find((value) => value.id === id);
    if (
      !row ||
      (expectedVersion !== undefined && row.version !== expectedVersion)
    )
      return null;
    const next = { ...row, ...clone(patch) };
    if (this.duplicate(next))
      throw new AppError(
        "DUPLICATE_EVENT",
        "This event already exists in your schedule.",
      );
    Object.assign(row, clone(patch), {
      version: row.version + 1,
      updated_at: now(),
    });
    return clone(row);
  }
  async deleteEvent(id: string) {
    const before = this.db.events.length;
    this.db.events = this.db.events.filter(
      (row) => !(row.user_id === this.userId && row.id === id),
    );
    this.db.links = this.db.links.filter((link) => link.event_id !== id);
    return this.db.events.length < before;
  }
  async listEventContacts() {
    return this.mine(this.db.links).map(({ event_id, contact_id }) => ({
      event_id,
      contact_id,
    }));
  }
  async setEventContacts(eventId: string, contactIds: string[]) {
    const ownsEvent = this.mine(this.db.events).some(
      (row) => row.id === eventId,
    );
    const owned = new Set(this.mine(this.db.contacts).map((row) => row.id));
    if (!ownsEvent || contactIds.some((id) => !owned.has(id)))
      throw new AppError("NOT_FOUND", "That record was not found.");
    this.db.links = this.db.links.filter((link) => link.event_id !== eventId);
    this.db.links.push(
      ...contactIds.map((contact_id) => ({
        event_id: eventId,
        contact_id,
        user_id: this.userId,
      })),
    );
  }

  async listContacts() {
    return clone(
      this.mine(this.db.contacts).sort((a, b) => a.name.localeCompare(b.name)),
    );
  }
  async getContact(id: string) {
    return clone(
      this.mine(this.db.contacts).find((row) => row.id === id) ?? null,
    );
  }
  private emailTaken(email: string, except?: string) {
    return this.mine(this.db.contacts).some(
      (row) =>
        row.id !== except && row.email.toLowerCase() === email.toLowerCase(),
    );
  }
  async insertContact(row: Parameters<Repo["insertContact"]>[0]) {
    if (
      this.db.contacts.some((other) => other.id === row.id) ||
      this.emailTaken(row.email)
    )
      throw new AppError(
        "VALIDATION_ERROR",
        "A record with these details already exists.",
      );
    const stored: ContactRow = {
      ...row,
      user_id: this.userId,
      created_at: now(),
      updated_at: now(),
    };
    this.db.contacts.push(stored);
    return clone(stored);
  }
  async updateContact(id: string, patch: Parameters<Repo["updateContact"]>[1]) {
    const row = this.mine(this.db.contacts).find((value) => value.id === id);
    if (!row) return null;
    if (patch.email && this.emailTaken(patch.email, id))
      throw new AppError(
        "VALIDATION_ERROR",
        "A record with these details already exists.",
      );
    Object.assign(row, patch, { updated_at: now() });
    return clone(row);
  }
  async deleteContact(id: string) {
    const before = this.db.contacts.length;
    this.db.contacts = this.db.contacts.filter(
      (row) => !(row.user_id === this.userId && row.id === id),
    );
    this.db.links = this.db.links.filter((link) => link.contact_id !== id);
    return this.db.contacts.length < before;
  }

  async listConflicts() {
    return clone(this.mine(this.db.conflicts));
  }
  async recordConflicts(rows: Parameters<Repo["recordConflicts"]>[0]) {
    for (const row of rows)
      if (
        !this.mine(this.db.conflicts).some(
          (value) => value.conflict_key === row.conflict_key,
        )
      )
        this.db.conflicts.push({
          ...row,
          id: crypto.randomUUID(),
          user_id: this.userId,
          status: "unresolved",
          detected_at: now(),
          status_changed_at: now(),
        });
    return this.listConflicts();
  }
  async setConflictStatus(
    key: string,
    status: ConflictRow["status"],
    onlyFrom?: ConflictRow["status"][],
  ) {
    const row = this.mine(this.db.conflicts).find(
      (value) => value.conflict_key === key,
    );
    if (!row || (onlyFrom && !onlyFrom.includes(row.status))) return null;
    Object.assign(row, { status, status_changed_at: now() });
    return clone(row);
  }

  async insertSuggestions(rows: Parameters<Repo["insertSuggestions"]>[0]) {
    const stored = rows.map((row): SuggestionRow => ({
      ...clone(row),
      id: crypto.randomUUID(),
      user_id: this.userId,
      status: "pending",
      result_json: null,
      created_at: now(),
      decided_at: null,
    }));
    this.db.suggestions.push(...stored);
    return clone(stored);
  }
  async getSuggestion(id: string) {
    return clone(
      this.mine(this.db.suggestions).find((row) => row.id === id) ?? null,
    );
  }
  async setSuggestionStatus(id: string, status: SuggestionRow["status"]) {
    const row = this.mine(this.db.suggestions).find(
      (value) => value.id === id && value.status === "pending",
    );
    if (row) Object.assign(row, { status, decided_at: now() });
  }
  async supersedeSuggestions(eventId: string, occurrenceDate: string) {
    for (const row of this.mine(this.db.suggestions))
      if (
        row.event_id === eventId &&
        row.occurrence_date === occurrenceDate &&
        row.status === "pending"
      )
        Object.assign(row, { status: "superseded", decided_at: now() });
  }
  async applyRecovery(args: Parameters<Repo["applyRecovery"]>[0]) {
    const stale = () =>
      new AppError(
        "STALE_SUGGESTION",
        "This suggestion is out of date. Please review the latest options.",
      );
    const target = this.mine(this.db.events).find(
      (row) => row.id === args.eventId,
    );
    const suggestion = this.mine(this.db.suggestions).find(
      (row) => row.id === args.suggestionId,
    );
    if (!target || target.version !== args.expectedVersion) throw stale();
    if (
      !suggestion ||
      suggestion.status !== "pending" ||
      suggestion.event_id !== args.eventId
    )
      throw stale();
    // Validate everything before changing anything, as one transaction would.
    for (const insert of args.inserts)
      if (this.db.events.some((row) => row.id === insert.id)) throw stale();
    Object.assign(suggestion, {
      status: "approved",
      decided_at: now(),
      result_json: {
        updated: args.updates.map((u) => u.id),
        created: args.inserts.map((i) => i.id),
      },
    });
    for (const update of args.updates) {
      const row = this.mine(this.db.events).find(
        (value) => value.id === update.id,
      );
      if (!row) continue;
      Object.assign(row, {
        title: update.title,
        start_at: update.start_at,
        end_at: update.end_at,
        exception_dates: update.exception_dates ?? row.exception_dates,
        version: row.version + 1,
        updated_at: now(),
      });
    }
    for (const insert of args.inserts) {
      this.db.events.push({
        ...clone(insert),
        user_id: this.userId,
        recurrence: "never",
        exception_dates: [],
        completed: false,
        completed_dates: [],
        google_event_id: null,
        google_calendar_id: null,
        google_etag: null,
        google_synced_at: null,
        version: 1,
        created_at: now(),
        updated_at: now(),
      });
      for (const link of this.mine(this.db.links).filter(
        (l) => l.event_id === args.eventId,
      ))
        this.db.links.push({ ...link, event_id: insert.id });
    }
    for (const row of this.mine(this.db.suggestions))
      if (row.event_id === args.eventId && row.status === "pending")
        Object.assign(row, { status: "superseded", decided_at: now() });
    const ids = [
      ...args.updates.map((u) => u.id),
      ...args.inserts.map((i) => i.id),
    ];
    return clone(
      this.mine(this.db.events).filter((row) => ids.includes(row.id)),
    );
  }

  async insertNotification(row: Parameters<Repo["insertNotification"]>[0]) {
    const stored: NotificationRow = {
      ...clone(row),
      id: crypto.randomUUID(),
      user_id: this.userId,
      status: "prepared",
      gmail_draft_id: null,
      gmail_message_id: null,
      error_code: null,
      sent_at: null,
      created_at: now(),
      updated_at: now(),
    };
    this.db.notifications.push(stored);
    return clone(stored);
  }
  async getNotification(id: string) {
    return clone(
      this.mine(this.db.notifications).find((row) => row.id === id) ?? null,
    );
  }
  async listNotifications(conflictKey?: string) {
    return clone(
      this.mine(this.db.notifications)
        .filter((row) => !conflictKey || row.conflict_key === conflictKey)
        .reverse(),
    );
  }
  async updateNotification(
    id: string,
    patch: Parameters<Repo["updateNotification"]>[1],
    onlyIfStatus?: NotificationRow["status"][],
  ) {
    const row = this.mine(this.db.notifications).find(
      (value) => value.id === id,
    );
    if (!row || (onlyIfStatus && !onlyIfStatus.includes(row.status)))
      return null;
    const next = { ...row, ...clone(patch) };
    if (next.status === "sent" && (!next.gmail_message_id || !next.sent_at))
      throw new AppError("VALIDATION_ERROR", "Some details are invalid.");
    Object.assign(row, clone(patch), { updated_at: now() });
    return clone(row);
  }

  async getGoogleConnection() {
    return clone(this.mine(this.db.google)[0] ?? null);
  }
  async saveGoogleConnection(row: Parameters<Repo["saveGoogleConnection"]>[0]) {
    let stored = this.mine(this.db.google)[0];
    if (!stored) {
      if (!row.refresh_token_enc)
        throw new AppError("VALIDATION_ERROR", "Some details are invalid.");
      stored = {
        user_id: this.userId,
        google_email: null,
        scopes: [],
        refresh_token_enc: row.refresh_token_enc,
        access_token_enc: null,
        access_token_expires_at: null,
        status: "active",
        calendar_last_sync_at: null,
        calendar_last_sync_error: null,
        created_at: now(),
        updated_at: now(),
      };
      this.db.google.push(stored);
    }
    Object.assign(stored, clone(row), { updated_at: now() });
    return clone(stored);
  }
  async deleteGoogleConnection() {
    this.db.google = this.db.google.filter(
      (row) => row.user_id !== this.userId,
    );
  }

  async beginIdempotent(scope: string, key: string): Promise<IdempotencyState> {
    const row = this.db.idempotency.find(
      (r) => r.user_id === this.userId && r.scope === scope && r.key === key,
    );
    if (!row) {
      this.db.idempotency.push({
        user_id: this.userId,
        scope,
        key,
        state: "pending",
      });
      return { state: "new" };
    }
    return row.state === "done"
      ? { state: "done", status: row.status!, body: clone(row.body) }
      : { state: "pending" };
  }
  async finishIdempotent(
    scope: string,
    key: string,
    status: number,
    body: unknown,
  ) {
    const row = this.db.idempotency.find(
      (r) => r.user_id === this.userId && r.scope === scope && r.key === key,
    );
    if (row) Object.assign(row, { state: "done", status, body: clone(body) });
  }
  async abandonIdempotent(scope: string, key: string) {
    this.db.idempotency = this.db.idempotency.filter(
      (r) => !(r.user_id === this.userId && r.scope === scope && r.key === key),
    );
  }
}
