// Offline-first sync for signed-in accounts. Every local change becomes a
// queued operation that only names what changed; when the queue is flushed
// each operation sends the latest local copy. Operations survive restarts
// and lost connections, and the server stays the source of truth.
import type { AccountSettings, ConflictRecord } from "../domain/contract";
import type {
  AppData,
  ConflictStatus,
  Contact,
  ScheduleItem,
} from "../domain/types";
import { ApiError, type api as Api } from "../services/api";

export type Op =
  | { type: "event"; id: string }
  | { type: "deleteEvent"; id: string }
  | { type: "contact"; id: string }
  | { type: "deleteContact"; id: string }
  | { type: "settings" }
  | { type: "conflictStatus"; id: string; status: ConflictStatus };
export const opKey = (op: Op) =>
  op.type === "settings" ? "settings" : `${op.type}:${op.id}`;

const same = (a: unknown, b: unknown) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);
export const settingsOf = (data: AppData): AccountSettings | null =>
  data.profile
    ? {
        profile: data.profile,
        onboarded: data.onboarded,
        preferences: data.preferences,
        availability: data.availability,
      }
    : null;

/** The operations that turn `prev` into `next` on the server. */
export function diffOps(prev: AppData, next: AppData): Op[] {
  const ops: Op[] = [];
  const contacts = new Map(prev.contacts.map((c) => [c.id, c]));
  for (const contact of next.contacts) {
    if (!same(contacts.get(contact.id), contact))
      ops.push({ type: "contact", id: contact.id });
    contacts.delete(contact.id);
  }
  const items = new Map(prev.items.map((i) => [i.id, i]));
  for (const item of next.items) {
    const old = items.get(item.id);
    const { version: _a, ...a } = old ?? ({} as ScheduleItem);
    const { version: _b, ...b } = item;
    if (!old || !same(a, b)) ops.push({ type: "event", id: item.id });
    items.delete(item.id);
  }
  for (const id of items.keys()) ops.push({ type: "deleteEvent", id });
  // Contacts are removed after the events that referenced them.
  for (const id of contacts.keys()) ops.push({ type: "deleteContact", id });
  if (!same(settingsOf(prev), settingsOf(next))) ops.push({ type: "settings" });
  for (const [id, status] of Object.entries(next.conflictStatus))
    if (prev.conflictStatus[id] !== status)
      ops.push({ type: "conflictStatus", id, status });
  // "Ignore" on the Conflicts tab is a dismissal on the server.
  for (const id of next.ignoredConflicts)
    if (!prev.ignoredConflicts.includes(id) && !next.conflictStatus[id])
      ops.push({ type: "conflictStatus", id, status: "dismissed" });
  return ops;
}

/** Appends operations; one pending operation per record is enough. */
export function enqueue(queue: Op[], ops: Op[]): Op[] {
  const next = [...queue];
  for (const op of ops) {
    const index = next.findIndex((value) => opKey(value) === opKey(op));
    if (index === -1) next.push(op);
    else if (op.type === "conflictStatus") next[index] = op;
  }
  return next;
}

export type SyncApi = Pick<
  typeof Api,
  | "createEvent"
  | "updateEvent"
  | "deleteEvent"
  | "createContact"
  | "updateContact"
  | "deleteContact"
  | "updatePreferences"
  | "setConflictStatus"
>;
export type FlushResult = {
  /** Stopped early because the server could not be reached. */
  offline: boolean;
  unauthorized: boolean;
  /** Changes the server refused; the local copy should be refreshed. */
  rejected: { op: Op; message: string }[];
  /** Saved changes worth telling the student about. */
  notices: string[];
};

/**
 * Sends queued operations in order. `queue.current` is read live, so
 * operations added during a flush are sent too.
 */
export async function flushQueue(
  queue: { current: Op[] },
  client: SyncApi,
  hooks: {
    data: () => AppData;
    /** Records a server version without creating another operation. */
    confirmItem: (item: ScheduleItem) => void;
    persist: () => void;
  },
): Promise<FlushResult> {
  const result: FlushResult = {
    offline: false,
    unauthorized: false,
    rejected: [],
    notices: [],
  };
  while (queue.current.length) {
    const op = queue.current[0];
    const followUps: Op[] = [];
    try {
      const data = hooks.data();
      if (op.type === "event") {
        const item = data.items.find((value) => value.id === op.id);
        if (item) {
          if (item.version === undefined) {
            const response = await client.createEvent(item);
            hooks.confirmItem(response.item);
            // A retried create returns the first copy; send any newer edits.
            if (response.replayed)
              followUps.push({ type: "event", id: item.id });
          } else {
            const response = await client.updateEvent(item, item.version);
            hooks.confirmItem(response.item);
            // Saved in ShiftSync, but its linked Google event was not changed.
            if (response.calendar?.status === "failed")
              result.notices.push(response.calendar.message);
          }
        }
      } else if (op.type === "deleteEvent") {
        await client.deleteEvent(op.id).catch(ignoreNotFound);
      } else if (op.type === "contact") {
        const contact = data.contacts.find((value) => value.id === op.id);
        if (contact)
          await client.updateContact(contact).catch((error: unknown) => {
            if (error instanceof ApiError && error.status === 404)
              return client.createContact(contact);
            throw error;
          });
      } else if (op.type === "deleteContact") {
        await client.deleteContact(op.id).catch(ignoreNotFound);
      } else if (op.type === "settings") {
        const settings = settingsOf(data);
        if (settings) await client.updatePreferences(settings);
      } else {
        // A conflict that no longer exists has nothing left to track.
        await client.setConflictStatus(op.id, op.status).catch(ignoreNotFound);
      }
    } catch (error) {
      if (!(error instanceof ApiError) || error.transient) {
        result.offline = true;
        break;
      }
      if (error.code === "UNAUTHORIZED") {
        result.unauthorized = true;
        break;
      }
      result.rejected.push({ op, message: error.message });
    }
    queue.current = enqueue(queue.current.slice(1), followUps);
    hooks.persist();
  }
  return result;
}
function ignoreNotFound(error: unknown) {
  if (error instanceof ApiError && error.status === 404) return undefined;
  throw error;
}

/** Replaces the local copy with the server's, keeping device-only state. */
export function mergeServer(
  local: AppData,
  server: {
    items: ScheduleItem[];
    contacts: Contact[];
    settings: AccountSettings;
    conflicts: ConflictRecord[];
  },
): AppData {
  const conflictStatus: Record<string, ConflictStatus> = {};
  for (const conflict of server.conflicts)
    conflictStatus[conflict.id] = conflict.status;
  const dismissed = server.conflicts
    .filter((c) => c.status === "dismissed")
    .map((c) => c.id);
  return {
    ...local,
    items: server.items,
    contacts: server.contacts,
    profile: server.settings.profile,
    onboarded: server.settings.onboarded,
    preferences: server.settings.preferences,
    availability: server.settings.availability,
    conflictStatus,
    ignoredConflicts: [...new Set([...dismissed, ...local.ignoredConflicts])],
  };
}
