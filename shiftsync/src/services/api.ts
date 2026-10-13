// Mobile API service layer. Screens and the store call these functions; they
// never talk to Supabase, Gemini or Google directly.
import type {
  AccountSettings,
  AnalyzeResponse,
  ApproveResponse,
  ConflictsResponse,
  ContactResponse,
  ContactsResponse,
  DraftResponse,
  ErrorCode,
  EventResponse,
  EventsResponse,
  ExplainRequest,
  ExplainResponse,
  GmailDraftRequest,
  GmailSendRequest,
  GoogleService,
  GoogleStatus,
  NotificationResponse,
  NotificationsResponse,
  PreferencesPatch,
  Session,
  SignUpResponse,
  SuggestionsRequest,
  SuggestionsResponse,
  CalendarSyncResponse,
  CalendarExportResponse,
  ChatMessage,
  ChatResponse,
} from "../domain/contract";
import type { ConflictStatus, Contact, ScheduleItem } from "../domain/types";
import { API_BASE_URL } from "./config";

export type ClientErrorCode = ErrorCode | "NETWORK_ERROR" | "NOT_CONFIGURED";
export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly status = 0,
    readonly details?: unknown,
  ) {
    super(message);
  }
  /** Worth retrying later: no response, or the server was briefly unavailable. */
  get transient() {
    return (
      this.code === "NETWORK_ERROR" ||
      this.code === "RATE_LIMITED" ||
      this.status === 503 ||
      (this.status >= 500 && this.code === "INTERNAL_ERROR")
    );
  }
}
export const isNetworkError = (error: unknown) =>
  error instanceof ApiError && error.transient;
export const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

let session: Session | null = null;
let refreshing: Promise<Session | null> | null = null;
let listener: ((session: Session | null) => void) | null = null;
/** The store persists sessions; this module only keeps the current one. */
export function setApiSession(next: Session | null) {
  session = next;
}
export function onSessionChange(callback: (session: Session | null) => void) {
  listener = callback;
}
function changeSession(next: Session | null) {
  session = next;
  listener?.(next);
}

type Options = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean;
  idempotencyKey?: string;
  timeoutMs?: number;
};
async function send<T>(
  path: string,
  options: Options,
  token: string | null,
): Promise<T> {
  if (!API_BASE_URL)
    throw new ApiError(
      "NOT_CONFIGURED",
      "This build is not connected to a ShiftSync server.",
    );
  const controller = new AbortController();
  // Generous by default: a free-tier server can take ~50 s to wake up.
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 60000,
  );
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(
      "NETWORK_ERROR",
      "We can't reach ShiftSync right now. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: { code: ErrorCode; message: string; details?: unknown } })
    | null;
  if (!response.ok) {
    const error = data?.error;
    throw new ApiError(
      error?.code ??
        (response.status >= 500 ? "INTERNAL_ERROR" : "VALIDATION_ERROR"),
      error?.message ?? "Something went wrong. Please try again.",
      response.status,
      error?.details,
    );
  }
  return data as T;
}

/** Refreshes once even when several requests notice an expired token. */
function refreshSession(): Promise<Session | null> {
  if (!session) return Promise.resolve(null);
  const refreshToken = session.refreshToken;
  refreshing ??= send<Session>(
    "/api/auth/refresh",
    { method: "POST", body: { refreshToken } },
    null,
  )
    .then((next) => {
      changeSession(next);
      return next;
    })
    .catch((error) => {
      if (error instanceof ApiError && error.code === "UNAUTHORIZED")
        changeSession(null);
      throw error;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function request<T>(path: string, options: Options = {}): Promise<T> {
  if (options.auth === false) return send<T>(path, options, null);
  if (!session) throw new ApiError("UNAUTHORIZED", "Sign in to continue.", 401);
  if (session.expiresAt * 1000 - 60_000 < Date.now()) await refreshSession();
  try {
    return await send<T>(path, options, session?.accessToken ?? null);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || !session)
      throw error;
    const next = await refreshSession();
    if (!next) throw error;
    return send<T>(path, options, next.accessToken);
  }
}

const id = (value: string) => encodeURIComponent(value);
export const api = {
  signUp: (email: string, password: string, displayName: string) =>
    request<SignUpResponse>("/api/auth/signup", {
      method: "POST",
      auth: false,
      body: { email, password, displayName },
    }),
  login: (email: string, password: string) =>
    request<Session>("/api/auth/login", {
      method: "POST",
      auth: false,
      body: { email, password },
    }),
  logout: (token: string) =>
    send<void>(
      "/api/auth/logout",
      { method: "POST", timeoutMs: 8000 },
      token,
    ).catch(() => undefined),

  listEvents: () => request<EventsResponse>("/api/events"),
  createEvent: (item: ScheduleItem) =>
    request<EventResponse>("/api/events", { method: "POST", body: item }),
  updateEvent: (item: ScheduleItem, expectedVersion?: number) =>
    request<EventResponse>(`/api/events/${id(item.id)}`, {
      method: "PATCH",
      // null clears a removed deadline; the server keeps fields not sent.
      body: {
        ...item,
        id: undefined,
        version: undefined,
        deadline: item.deadline ?? null,
        expectedVersion,
      },
    }),
  deleteEvent: (eventId: string) =>
    request<void>(`/api/events/${id(eventId)}`, { method: "DELETE" }),

  listContacts: () => request<ContactsResponse>("/api/contacts"),
  createContact: (contact: Contact) =>
    request<ContactResponse>("/api/contacts", {
      method: "POST",
      body: contact,
    }),
  updateContact: (contact: Contact) =>
    request<ContactResponse>(`/api/contacts/${id(contact.id)}`, {
      method: "PATCH",
      body: { name: contact.name, email: contact.email, role: contact.role },
    }),
  deleteContact: (contactId: string) =>
    request<void>(`/api/contacts/${id(contactId)}`, { method: "DELETE" }),

  getPreferences: () => request<AccountSettings>("/api/preferences"),
  updatePreferences: (patch: PreferencesPatch) =>
    request<AccountSettings>("/api/preferences", {
      method: "PATCH",
      body: patch,
    }),

  listConflicts: () => request<ConflictsResponse>("/api/conflicts"),
  setConflictStatus: (conflictId: string, status: ConflictStatus) =>
    request<{ id: string; status: ConflictStatus }>(
      `/api/conflicts/${id(conflictId)}/status`,
      {
        method: "PATCH",
        body: { status },
      },
    ),
  analyzeShift: (shift: ScheduleItem) =>
    request<AnalyzeResponse>("/api/conflicts/analyze", {
      method: "POST",
      body: { shift },
    }),
  suggestions: (body: SuggestionsRequest) =>
    request<SuggestionsResponse>("/api/suggestions", { method: "POST", body }),
  approve: (suggestionId: string, idempotencyKey: string) =>
    request<ApproveResponse>(`/api/suggestions/${id(suggestionId)}/approve`, {
      method: "POST",
      body: {},
      idempotencyKey,
    }),

  explain: (body: ExplainRequest) =>
    request<ExplainResponse>("/api/ai/explain", {
      method: "POST",
      body,
    }),
  draft: (conflictId: string, contactId: string) =>
    request<DraftResponse>("/api/ai/draft", {
      method: "POST",
      body: { conflictId, contactId },
    }),
  notifications: (conflictId?: string) =>
    request<NotificationsResponse>(
      `/api/notifications${conflictId ? `?conflictId=${id(conflictId)}` : ""}`,
    ),
  saveGmailDraft: (body: GmailDraftRequest) =>
    request<NotificationResponse>("/api/gmail/drafts", {
      method: "POST",
      body,
    }),
  sendEmail: (body: GmailSendRequest, idempotencyKey: string) =>
    request<NotificationResponse>("/api/gmail/send", {
      method: "POST",
      body,
      idempotencyKey,
    }),

  googleLoginStart: (returnUrl: string, codeChallenge: string) =>
    request<{ authUrl: string }>("/api/auth/google/start", {
      method: "POST",
      auth: false,
      body: { returnUrl, codeChallenge },
    }),
  googleLoginComplete: (handle: string, codeVerifier: string) =>
    request<Session>("/api/auth/google/complete", {
      method: "POST",
      auth: false,
      body: { handle, codeVerifier },
    }),
  chat: (messages: ChatMessage[]) =>
    request<ChatResponse>("/api/ai/chat", {
      method: "POST",
      body: { messages },
    }),
  addToGoogleCalendar: (eventId: string) =>
    request<CalendarExportResponse>(`/api/calendar/events/${id(eventId)}`, {
      method: "POST",
      body: {},
    }),
  googleStatus: () => request<GoogleStatus>("/api/google/status"),
  googleConnect: (services: GoogleService[], returnUrl: string) =>
    request<{ authUrl: string }>("/api/google/connect", {
      method: "POST",
      body: { services, returnUrl },
    }),
  googleComplete: (handle: string) =>
    request<GoogleStatus>("/api/google/complete", {
      method: "POST",
      body: { handle },
    }),
  googleDisconnect: () =>
    request<GoogleStatus>("/api/google/disconnect", {
      method: "POST",
      body: {},
    }),
  syncCalendar: () =>
    request<CalendarSyncResponse>("/api/calendar/sync", {
      method: "POST",
      body: {},
    }),
};
