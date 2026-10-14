// Google OAuth, Calendar and Gmail over their REST APIs. Only the minimum
// scopes are requested: Calendar events, and Gmail compose (drafts + send).
import crypto from "node:crypto";
import type { GoogleService } from "../../../src/domain/contract";
import type { GoogleConfig } from "../env";
import { AppError } from "../http";
import type { GoogleConnectionRow, Repo } from "../repo/types";
import { decryptSecret, encryptSecret } from "./crypto";

export const SCOPES: Record<GoogleService, string> = {
  calendar: "https://www.googleapis.com/auth/calendar.events",
  gmail: "https://www.googleapis.com/auth/gmail.compose",
};
const IDENTITY_SCOPES = ["openid", "email", "profile"];
export const PRIMARY = "primary";

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
  email: string | null;
  name: string | null;
  /** Google OpenID Connect token, used to sign in to Supabase. */
  idToken: string | null;
};
type DateTime = { dateTime?: string; date?: string; timeZone?: string };
export type GoogleEvent = {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  updated?: string;
  start?: DateTime;
  end?: DateTime;
  recurringEventId?: string;
  extendedProperties?: { private?: Record<string, string> };
};
export type EventBody = {
  summary?: string;
  location?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  extendedProperties?: { private: Record<string, string> };
};
export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(`Google API error ${status}: ${reason}`);
  }
  /** The stored grant is no longer usable; the user must reconnect. */
  get revoked() {
    return this.reason === "invalid_grant" || this.status === 401;
  }
}
export interface GoogleApi {
  readonly configured: boolean;
  authUrl(state: string, services: GoogleService[]): string;
  exchangeCode(code: string): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  revoke(token: string): Promise<void>;
  listEvents(
    token: string,
    calendarId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<GoogleEvent[]>;
  getEvent(
    token: string,
    calendarId: string,
    eventId: string,
  ): Promise<GoogleEvent | null>;
  /** Updates an event only if it still has the given etag. */
  patchEvent(
    token: string,
    calendarId: string,
    eventId: string,
    body: EventBody,
    etag?: string,
  ): Promise<GoogleEvent>;
  insertEvent(
    token: string,
    calendarId: string,
    body: EventBody,
  ): Promise<GoogleEvent>;
  /** Finds an event ShiftSync created earlier, to avoid duplicates on retry. */
  findByShiftSyncId(
    token: string,
    calendarId: string,
    shiftsyncId: string,
  ): Promise<GoogleEvent | null>;
  createDraft(token: string, raw: string): Promise<{ id: string }>;
  updateDraft(
    token: string,
    draftId: string,
    raw: string,
  ): Promise<{ id: string }>;
  /** Sends a draft; returns the sent message id. */
  sendDraft(token: string, draftId: string): Promise<{ id: string }>;
  sendMessage(token: string, raw: string): Promise<{ id: string }>;
}

// The ID token comes straight from Google's token endpoint over TLS, so its
// claims are read without re-verifying the signature here. Supabase verifies
// it again when it is used to sign in.
function claimsOf(idToken: unknown): {
  email: string | null;
  name: string | null;
} {
  if (typeof idToken !== "string") return { email: null, name: null };
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"),
    );
    return {
      email: typeof payload.email === "string" ? payload.email : null,
      name: typeof payload.name === "string" ? payload.name : null,
    };
  } catch {
    return { email: null, name: null };
  }
}

export function googleRestApi(
  config: GoogleConfig | null,
  fetchImpl: typeof fetch = fetch,
): GoogleApi {
  async function call<T>(
    url: string,
    init: RequestInit & { token?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string>),
    };
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new GoogleApiError(0, "network_error");
    }
    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      if (text) data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      if (!response.ok)
        throw new GoogleApiError(response.status, `http_${response.status}`);
    }
    if (!response.ok) {
      const error = data.error as
        | { status?: string; errors?: { reason?: string }[] }
        | string
        | undefined;
      const reason =
        typeof error === "string"
          ? error
          : (error?.errors?.[0]?.reason ??
            error?.status ??
            `http_${response.status}`);
      throw new GoogleApiError(response.status, reason);
    }
    return data as T;
  }
  const tokenRequest = async (
    params: Record<string, string>,
  ): Promise<TokenSet> => {
    if (!config) throw new GoogleApiError(0, "not_configured");
    const data = await call<Record<string, unknown>>(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          ...params,
        }),
      },
    );
    return {
      accessToken: String(data.access_token),
      refreshToken:
        typeof data.refresh_token === "string" ? data.refresh_token : null,
      expiresAt: new Date(Date.now() + Number(data.expires_in ?? 3600) * 1000),
      scopes: String(data.scope ?? "")
        .split(" ")
        .filter(Boolean),
      ...claimsOf(data.id_token),
      idToken: typeof data.id_token === "string" ? data.id_token : null,
    };
  };
  const calendar = (calendarId: string) =>
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const gmail = "https://gmail.googleapis.com/gmail/v1/users/me";
  const json = { "Content-Type": "application/json" };
  return {
    configured: !!config,
    authUrl(state, services) {
      if (!config) throw new GoogleApiError(0, "not_configured");
      return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(
        {
          client_id: config.clientId,
          redirect_uri: config.redirectUri,
          response_type: "code",
          scope: [...IDENTITY_SCOPES, ...services.map((s) => SCOPES[s])].join(
            " ",
          ),
          access_type: "offline",
          include_granted_scopes: "true",
          prompt: "consent",
          state,
        },
      )}`;
    },
    exchangeCode: (code) =>
      tokenRequest({
        code,
        grant_type: "authorization_code",
        redirect_uri: config?.redirectUri ?? "",
      }),
    refresh: (refreshToken) =>
      tokenRequest({
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    async revoke(token) {
      await call("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
    },
    async listEvents(token, calendarId, timeMin, timeMax) {
      const events: GoogleEvent[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 10; page++) {
        const query = new URLSearchParams({
          timeMin,
          timeMax,
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "250",
        });
        if (pageToken) query.set("pageToken", pageToken);
        const data = await call<{
          items?: GoogleEvent[];
          nextPageToken?: string;
        }>(`${calendar(calendarId)}?${query}`, { token });
        events.push(...(data.items ?? []));
        pageToken = data.nextPageToken;
        if (!pageToken) break;
      }
      return events;
    },
    async getEvent(token, calendarId, eventId) {
      try {
        return await call<GoogleEvent>(
          `${calendar(calendarId)}/${encodeURIComponent(eventId)}`,
          { token },
        );
      } catch (error) {
        if (
          error instanceof GoogleApiError &&
          (error.status === 404 || error.status === 410)
        )
          return null;
        throw error;
      }
    },
    patchEvent(token, calendarId, eventId, body, etag) {
      return call<GoogleEvent>(
        `${calendar(calendarId)}/${encodeURIComponent(eventId)}`,
        {
          token,
          method: "PATCH",
          headers: { ...json, ...(etag ? { "If-Match": etag } : {}) },
          body: JSON.stringify(body),
        },
      );
    },
    insertEvent(token, calendarId, body) {
      return call<GoogleEvent>(calendar(calendarId), {
        token,
        method: "POST",
        headers: json,
        body: JSON.stringify(body),
      });
    },
    async findByShiftSyncId(token, calendarId, shiftsyncId) {
      const query = new URLSearchParams({
        privateExtendedProperty: `shiftsyncId=${shiftsyncId}`,
        maxResults: "1",
      });
      const data = await call<{ items?: GoogleEvent[] }>(
        `${calendar(calendarId)}?${query}`,
        { token },
      );
      return data.items?.[0] ?? null;
    },
    createDraft(token, raw) {
      return call<{ id: string }>(`${gmail}/drafts`, {
        token,
        method: "POST",
        headers: json,
        body: JSON.stringify({ message: { raw } }),
      });
    },
    updateDraft(token, draftId, raw) {
      return call<{ id: string }>(
        `${gmail}/drafts/${encodeURIComponent(draftId)}`,
        {
          token,
          method: "PUT",
          headers: json,
          body: JSON.stringify({ id: draftId, message: { raw } }),
        },
      );
    },
    sendDraft(token, draftId) {
      return call<{ id: string }>(`${gmail}/drafts/send`, {
        token,
        method: "POST",
        headers: json,
        body: JSON.stringify({ id: draftId }),
      });
    },
    sendMessage(token, raw) {
      return call<{ id: string }>(`${gmail}/messages/send`, {
        token,
        method: "POST",
        headers: json,
        body: JSON.stringify({ raw }),
      });
    },
  };
}

const headerText = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
const encodeWord = (value: string) =>
  /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
const base64Lines = (value: string) =>
  Buffer.from(value.replace(/\r?\n/g, "\r\n"), "utf8")
    .toString("base64")
    .replace(/.{76}/g, "$&\r\n");
/**
 * RFC 2822 message, base64url encoded for the Gmail API. With `html` it is
 * multipart/alternative: clients that show HTML get the formatted version,
 * and the plain text (unchanged, no tags) is the fallback for the rest.
 */
export function buildRawEmail(message: {
  to: string;
  toName: string;
  subject: string;
  body: string;
  html?: string;
}): string {
  if (/[\r\n<>,;"]/.test(message.to))
    throw new AppError("VALIDATION_ERROR", "Invalid recipient address.");
  const name = headerText(message.toName).replace(/["\\]/g, "");
  const display = name
    ? /^[\x20-\x7e]*$/.test(name)
      ? `"${name}" `
      : `${encodeWord(name)} `
    : "";
  const headers = [
    `To: ${display}<${message.to}>`,
    `Subject: ${encodeWord(headerText(message.subject))}`,
    "MIME-Version: 1.0",
  ];
  const part = (type: string, content: string) => [
    `Content-Type: ${type}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(content),
  ];
  const lines = message.html
    ? (() => {
        const boundary = `shiftsync-${crypto.randomBytes(12).toString("hex")}`;
        return [
          ...headers,
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
          "",
          `--${boundary}`,
          ...part("text/plain", message.body),
          `--${boundary}`,
          ...part("text/html", message.html),
          `--${boundary}--`,
        ];
      })()
    : [...headers, ...part("text/plain", message.body)];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

/**
 * A usable access token for the signed-in user's Google connection,
 * refreshing it when needed. Fails with GOOGLE_NOT_CONNECTED when the user
 * must connect or reconnect.
 */
export async function googleAccess(
  google: GoogleApi,
  tokenKey: Buffer | null,
  repo: Repo,
  service: GoogleService,
  now = new Date(),
): Promise<{ token: string; connection: GoogleConnectionRow }> {
  if (!google.configured || !tokenKey)
    throw new AppError(
      "GOOGLE_NOT_CONFIGURED",
      "Google sign-in is not set up on this server yet.",
    );
  const connection = await repo.getGoogleConnection();
  const label = service === "gmail" ? "Gmail" : "Google Calendar";
  if (!connection)
    throw new AppError("GOOGLE_NOT_CONNECTED", `Connect ${label} first.`);
  if (connection.status === "needs_reauth")
    throw new AppError(
      "GOOGLE_NOT_CONNECTED",
      "Your Google connection expired. Reconnect your Google account.",
    );
  if (!connection.scopes.includes(SCOPES[service]))
    throw new AppError(
      "GOOGLE_NOT_CONNECTED",
      `Allow ShiftSync to use ${label} first.`,
    );
  if (
    connection.access_token_enc &&
    connection.access_token_expires_at &&
    new Date(connection.access_token_expires_at).getTime() - 60_000 >
      now.getTime()
  )
    return {
      token: decryptSecret(connection.access_token_enc, tokenKey),
      connection,
    };
  try {
    const fresh = await google.refresh(
      decryptSecret(connection.refresh_token_enc, tokenKey),
    );
    const saved = await repo.saveGoogleConnection({
      access_token_enc: encryptSecret(fresh.accessToken, tokenKey),
      access_token_expires_at: fresh.expiresAt.toISOString(),
      ...(fresh.refreshToken
        ? { refresh_token_enc: encryptSecret(fresh.refreshToken, tokenKey) }
        : {}),
    });
    return { token: fresh.accessToken, connection: saved };
  } catch (error) {
    if (error instanceof GoogleApiError && error.revoked) {
      await repo.saveGoogleConnection({
        status: "needs_reauth",
        access_token_enc: null,
      });
      throw new AppError(
        "GOOGLE_NOT_CONNECTED",
        "Your Google connection expired. Reconnect your Google account.",
      );
    }
    throw error;
  }
}
