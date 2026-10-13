// Supabase implementation. Each repo is created with the signed-in user's
// own access token, so Postgres row level security applies to every query;
// explicit user_id filters are kept as a second check.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../http";
import type {
  ConflictRow,
  ContactRow,
  EventRow,
  GoogleConnectionRow,
  NotificationRow,
  ProfileRow,
  Repo,
  SuggestionRow,
} from "./types";

type DbError = {
  code?: string;
  message: string;
  details?: string | null;
} | null;
const PAGE = 1000;

function raise(error: DbError, context: string): void {
  if (!error) return;
  const code = error.code ?? "";
  if (code === "23505")
    throw new AppError(
      context === "events" ? "DUPLICATE_EVENT" : "VALIDATION_ERROR",
      context === "events"
        ? "This event already exists in your schedule."
        : "A record with these details already exists.",
    );
  if (
    code === "23514" ||
    code === "22P02" ||
    code === "22007" ||
    code === "23502"
  )
    throw new AppError("VALIDATION_ERROR", "Some details are invalid.");
  if (code === "23503")
    throw new AppError("NOT_FOUND", "A linked record no longer exists.");
  if (code === "42501")
    throw new AppError("NOT_FOUND", "That record was not found.");
  if (code === "PGRST301" || code === "PGRST303" || /jwt/i.test(error.message))
    throw new AppError(
      "UNAUTHORIZED",
      "Your session has expired. Please sign in again.",
    );
  if (/STALE_SUGGESTION/.test(error.message))
    throw new AppError(
      "STALE_SUGGESTION",
      "This suggestion is out of date. Please review the latest options.",
    );
  if (code === "42P01" || code === "PGRST205" || code === "PGRST202")
    throw new AppError(
      "INTERNAL_ERROR",
      "The ShiftSync database tables are missing. Apply the Supabase migration first.",
      undefined,
      503,
    );
  throw new AppError(
    "INTERNAL_ERROR",
    "We couldn't reach the database. Please try again.",
    undefined,
    503,
  );
}

export function supabaseRepoFactory(url: string, key: string) {
  return (userId: string, accessToken: string): Repo =>
    new SupabaseRepo(
      createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      }),
      userId,
    );
}

class SupabaseRepo implements Repo {
  constructor(
    private readonly db: SupabaseClient,
    readonly userId: string,
  ) {}

  private async all<T>(
    table: string,
    columns = "*",
    order = "created_at",
  ): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.db
        .from(table)
        .select(columns)
        .eq("user_id", this.userId)
        .order(order)
        .range(from, from + PAGE - 1);
      raise(error, table);
      rows.push(...((data ?? []) as T[]));
      if (!data || data.length < PAGE) return rows;
    }
  }

  async getProfile() {
    const { data, error } = await this.db
      .from("users")
      .select("*")
      .eq("id", this.userId)
      .maybeSingle();
    raise(error, "users");
    return data as ProfileRow | null;
  }
  async saveProfile(patch: Parameters<Repo["saveProfile"]>[0]) {
    const { data, error } = await this.db
      .from("users")
      .upsert({ id: this.userId, ...patch }, { onConflict: "id" })
      .select()
      .single();
    raise(error, "users");
    return data as ProfileRow;
  }

  listEvents() {
    return this.all<EventRow>("events", "*", "start_at");
  }
  async getEvent(id: string) {
    const { data, error } = await this.db
      .from("events")
      .select("*")
      .eq("user_id", this.userId)
      .eq("id", id)
      .maybeSingle();
    raise(error, "events");
    return data as EventRow | null;
  }
  async getEvents(ids: string[]) {
    if (!ids.length) return [];
    const { data, error } = await this.db
      .from("events")
      .select("*")
      .eq("user_id", this.userId)
      .in("id", ids);
    raise(error, "events");
    return (data ?? []) as EventRow[];
  }
  async findEventByGoogleId(calendarId: string, eventId: string) {
    const { data, error } = await this.db
      .from("events")
      .select("*")
      .eq("user_id", this.userId)
      .eq("google_calendar_id", calendarId)
      .eq("google_event_id", eventId)
      .maybeSingle();
    raise(error, "events");
    return data as EventRow | null;
  }
  async insertEvent(row: Parameters<Repo["insertEvent"]>[0]) {
    const { data, error } = await this.db
      .from("events")
      .insert({ ...row, user_id: this.userId })
      .select()
      .single();
    raise(error, "events");
    return data as EventRow;
  }
  async updateEvent(
    id: string,
    patch: Parameters<Repo["updateEvent"]>[1],
    expectedVersion?: number,
  ) {
    let query = this.db
      .from("events")
      .update(patch)
      .eq("user_id", this.userId)
      .eq("id", id);
    if (expectedVersion !== undefined)
      query = query.eq("version", expectedVersion);
    const { data, error } = await query.select().maybeSingle();
    raise(error, "events");
    return data as EventRow | null;
  }
  async deleteEvent(id: string) {
    const { data, error } = await this.db
      .from("events")
      .delete()
      .eq("user_id", this.userId)
      .eq("id", id)
      .select("id");
    raise(error, "events");
    return !!data?.length;
  }
  listEventContacts() {
    return this.all<{ event_id: string; contact_id: string }>(
      "event_contacts",
      "event_id, contact_id",
      "event_id",
    );
  }
  async setEventContacts(eventId: string, contactIds: string[]) {
    let removal = this.db
      .from("event_contacts")
      .delete()
      .eq("user_id", this.userId)
      .eq("event_id", eventId);
    if (contactIds.length)
      removal = removal.not("contact_id", "in", `(${contactIds.join(",")})`);
    const { error } = await removal;
    raise(error, "event_contacts");
    if (!contactIds.length) return;
    const { error: insertError } = await this.db.from("event_contacts").upsert(
      contactIds.map((contact_id) => ({
        event_id: eventId,
        contact_id,
        user_id: this.userId,
      })),
      { onConflict: "event_id,contact_id", ignoreDuplicates: true },
    );
    raise(insertError, "event_contacts");
  }

  listContacts() {
    return this.all<ContactRow>("contacts", "*", "name");
  }
  async getContact(id: string) {
    const { data, error } = await this.db
      .from("contacts")
      .select("*")
      .eq("user_id", this.userId)
      .eq("id", id)
      .maybeSingle();
    raise(error, "contacts");
    return data as ContactRow | null;
  }
  async insertContact(row: Parameters<Repo["insertContact"]>[0]) {
    const { data, error } = await this.db
      .from("contacts")
      .insert({ ...row, user_id: this.userId })
      .select()
      .single();
    raise(error, "contacts");
    return data as ContactRow;
  }
  async updateContact(id: string, patch: Parameters<Repo["updateContact"]>[1]) {
    const { data, error } = await this.db
      .from("contacts")
      .update(patch)
      .eq("user_id", this.userId)
      .eq("id", id)
      .select()
      .maybeSingle();
    raise(error, "contacts");
    return data as ContactRow | null;
  }
  async deleteContact(id: string) {
    const { data, error } = await this.db
      .from("contacts")
      .delete()
      .eq("user_id", this.userId)
      .eq("id", id)
      .select("id");
    raise(error, "contacts");
    return !!data?.length;
  }

  listConflicts() {
    return this.all<ConflictRow>("conflicts", "*", "detected_at");
  }
  async recordConflicts(rows: Parameters<Repo["recordConflicts"]>[0]) {
    if (rows.length) {
      const { error } = await this.db.from("conflicts").upsert(
        rows.map((row) => ({ ...row, user_id: this.userId })),
        { onConflict: "user_id,conflict_key", ignoreDuplicates: true },
      );
      raise(error, "conflicts");
    }
    return this.listConflicts();
  }
  async setConflictStatus(
    key: string,
    status: ConflictRow["status"],
    onlyFrom?: ConflictRow["status"][],
  ) {
    let query = this.db
      .from("conflicts")
      .update({ status, status_changed_at: new Date().toISOString() })
      .eq("user_id", this.userId)
      .eq("conflict_key", key);
    if (onlyFrom) query = query.in("status", onlyFrom);
    const { data, error } = await query.select().maybeSingle();
    raise(error, "conflicts");
    return data as ConflictRow | null;
  }

  async insertSuggestions(rows: Parameters<Repo["insertSuggestions"]>[0]) {
    if (!rows.length) return [];
    const { data, error } = await this.db
      .from("suggestions")
      .insert(rows.map((row) => ({ ...row, user_id: this.userId })))
      .select();
    raise(error, "suggestions");
    return ((data ?? []) as SuggestionRow[]).sort((a, b) => a.rank - b.rank);
  }
  async getSuggestion(id: string) {
    const { data, error } = await this.db
      .from("suggestions")
      .select("*")
      .eq("user_id", this.userId)
      .eq("id", id)
      .maybeSingle();
    raise(error, "suggestions");
    return data
      ? ({ ...data, score: Number(data.score) } as SuggestionRow)
      : null;
  }
  async setSuggestionStatus(id: string, status: SuggestionRow["status"]) {
    const { error } = await this.db
      .from("suggestions")
      .update({ status, decided_at: new Date().toISOString() })
      .eq("user_id", this.userId)
      .eq("id", id)
      .eq("status", "pending");
    raise(error, "suggestions");
  }
  async supersedeSuggestions(eventId: string, occurrenceDate: string) {
    const { error } = await this.db
      .from("suggestions")
      .update({ status: "superseded", decided_at: new Date().toISOString() })
      .eq("user_id", this.userId)
      .eq("event_id", eventId)
      .eq("occurrence_date", occurrenceDate)
      .eq("status", "pending");
    raise(error, "suggestions");
  }
  async applyRecovery(args: Parameters<Repo["applyRecovery"]>[0]) {
    const { data, error } = await this.db.rpc("shiftsync_apply_recovery", {
      p_suggestion_id: args.suggestionId,
      p_event_id: args.eventId,
      p_expected_version: args.expectedVersion,
      p_updates: args.updates,
      p_inserts: args.inserts,
    });
    raise(error, "events");
    return (data ?? []) as EventRow[];
  }

  async insertNotification(row: Parameters<Repo["insertNotification"]>[0]) {
    const { data, error } = await this.db
      .from("notifications")
      .insert({ ...row, user_id: this.userId })
      .select()
      .single();
    raise(error, "notifications");
    return data as NotificationRow;
  }
  async getNotification(id: string) {
    const { data, error } = await this.db
      .from("notifications")
      .select("*")
      .eq("user_id", this.userId)
      .eq("id", id)
      .maybeSingle();
    raise(error, "notifications");
    return data as NotificationRow | null;
  }
  async listNotifications(conflictKey?: string) {
    let query = this.db
      .from("notifications")
      .select("*")
      .eq("user_id", this.userId);
    if (conflictKey) query = query.eq("conflict_key", conflictKey);
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(200);
    raise(error, "notifications");
    return (data ?? []) as NotificationRow[];
  }
  async updateNotification(
    id: string,
    patch: Parameters<Repo["updateNotification"]>[1],
    onlyIfStatus?: NotificationRow["status"][],
  ) {
    let query = this.db
      .from("notifications")
      .update(patch)
      .eq("user_id", this.userId)
      .eq("id", id);
    if (onlyIfStatus) query = query.in("status", onlyIfStatus);
    const { data, error } = await query.select().maybeSingle();
    raise(error, "notifications");
    return data as NotificationRow | null;
  }

  async getGoogleConnection() {
    const { data, error } = await this.db
      .from("google_connections")
      .select("*")
      .eq("user_id", this.userId)
      .maybeSingle();
    raise(error, "google_connections");
    return data as GoogleConnectionRow | null;
  }
  async saveGoogleConnection(row: Parameters<Repo["saveGoogleConnection"]>[0]) {
    // Partial writes (sync status, refreshed tokens) must update the existing
    // row: an upsert would fail the NOT NULL check on refresh_token_enc
    // before Postgres ever reaches the conflict clause.
    const updated = await this.db
      .from("google_connections")
      .update(row)
      .eq("user_id", this.userId)
      .select()
      .maybeSingle();
    raise(updated.error, "google_connections");
    if (updated.data) return updated.data as GoogleConnectionRow;
    const { data, error } = await this.db
      .from("google_connections")
      .insert({ ...row, user_id: this.userId })
      .select()
      .single();
    raise(error, "google_connections");
    return data as GoogleConnectionRow;
  }
  async deleteGoogleConnection() {
    const { error } = await this.db
      .from("google_connections")
      .delete()
      .eq("user_id", this.userId);
    raise(error, "google_connections");
  }

  async beginIdempotent(scope: string, key: string) {
    const { error } = await this.db
      .from("idempotency_keys")
      .insert({ user_id: this.userId, scope, key });
    if (!error) return { state: "new" as const };
    if (error.code !== "23505") raise(error, "idempotency_keys");
    const { data, error: readError } = await this.db
      .from("idempotency_keys")
      .select("state, status_code, response_json")
      .eq("user_id", this.userId)
      .eq("scope", scope)
      .eq("key", key)
      .single();
    raise(readError, "idempotency_keys");
    if (!data) return { state: "pending" as const };
    return data.state === "done"
      ? {
          state: "done" as const,
          status: data.status_code as number,
          body: data.response_json,
        }
      : { state: "pending" as const };
  }
  async finishIdempotent(
    scope: string,
    key: string,
    status: number,
    body: unknown,
  ) {
    const { error } = await this.db
      .from("idempotency_keys")
      .update({ state: "done", status_code: status, response_json: body })
      .eq("user_id", this.userId)
      .eq("scope", scope)
      .eq("key", key);
    raise(error, "idempotency_keys");
  }
  async abandonIdempotent(scope: string, key: string) {
    const { error } = await this.db
      .from("idempotency_keys")
      .delete()
      .eq("user_id", this.userId)
      .eq("scope", scope)
      .eq("key", key);
    raise(error, "idempotency_keys");
  }
}
