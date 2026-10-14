import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmptyData, newItem } from "../src/domain/seed";
import type { AppData, ScheduleItem } from "../src/domain/types";
import { ApiError } from "../src/services/api";
import {
  diffOps,
  enqueue,
  flushQueue,
  mergeServer,
  type Op,
  type SyncApi,
} from "../src/store/sync";

const base = (): AppData => ({
  ...createEmptyData(),
  profile: {
    name: "Ana",
    email: "ana@example.com",
    organization: "",
    roles: ["Student"],
  },
  onboarded: true,
});
const study = (values: Partial<ScheduleItem> = {}): ScheduleItem => ({
  ...newItem("event", "2026-10-13"),
  title: "Study",
  category: "Study",
  ...values,
});

test("local edits become one queued operation per record", () => {
  const before = base();
  const item = study();
  const added = { ...before, items: [item] };
  assert.deepEqual(diffOps(before, added), [{ type: "event", id: item.id }]);
  // A version update from the server is not a change to send back.
  assert.deepEqual(
    diffOps(added, { ...added, items: [{ ...item, version: 2 }] }),
    [],
  );
  const removed = { ...added, items: [] };
  assert.deepEqual(diffOps(added, removed), [
    { type: "deleteEvent", id: item.id },
  ]);
  const ignored = { ...added, ignoredConflicts: ["2026-10-13:a:b"] };
  assert.deepEqual(diffOps(added, ignored), [
    { type: "conflictStatus", id: "2026-10-13:a:b", status: "dismissed" },
  ]);
  const prefs = {
    ...added,
    preferences: { ...added.preferences, travelMinutes: 15 },
  };
  assert.deepEqual(diffOps(added, prefs), [{ type: "settings" }]);
  const queue = enqueue(
    enqueue([], diffOps(before, added)),
    diffOps(added, { ...added, items: [{ ...item, title: "Again" }] }),
  );
  assert.equal(queue.length, 1);
});

function fakeApi(
  handlers: Partial<
    Record<keyof SyncApi, (...args: any[]) => Promise<unknown>>
  >,
) {
  const calls: string[] = [];
  const client = new Proxy({} as SyncApi, {
    get:
      (_target, name: string) =>
      async (...args: unknown[]) => {
        calls.push(name);
        const handler = handlers[name as keyof SyncApi];
        if (!handler) return {};
        return handler(...args);
      },
  });
  return { client, calls };
}

test("offline keeps every change queued; reconnecting sends them in order", async () => {
  let data = {
    ...base(),
    items: [study({ title: "A" }), study({ title: "B" })],
  };
  const queue = { current: diffOps(base(), data) as Op[] };
  let online = false;
  const { client, calls } = fakeApi({
    createEvent: async (item: ScheduleItem) => {
      if (!online) throw new ApiError("NETWORK_ERROR", "offline");
      return { item: { ...item, version: 1 } };
    },
  });
  const hooks = {
    data: () => data,
    confirmItem: (item: ScheduleItem) => {
      data = {
        ...data,
        items: data.items.map((i) =>
          i.id === item.id ? { ...i, version: item.version } : i,
        ),
      };
    },
    persist: () => undefined,
  };
  const first = await flushQueue(queue, client, hooks);
  assert.equal(first.offline, true);
  assert.equal(queue.current.length, 2);
  online = true;
  const second = await flushQueue(queue, client, hooks);
  assert.equal(second.offline, false);
  assert.equal(queue.current.length, 0);
  assert.deepEqual(calls.filter((c) => c === "createEvent").length, 3);
  assert.ok(data.items.every((i) => i.version === 1));
});

test("rejected changes are dropped and reported; deletes of unsynced items succeed", async () => {
  const item = study({ version: 3 });
  const data = { ...base(), items: [item] };
  const queue = {
    current: [
      { type: "event", id: item.id },
      { type: "deleteEvent", id: "gone" },
      { type: "conflictStatus", id: "x", status: "resolved" },
    ] as Op[],
  };
  const { client } = fakeApi({
    updateEvent: async () => {
      throw new ApiError(
        "VERSION_CONFLICT",
        "This event changed on another device.",
        409,
      );
    },
    deleteEvent: async () => {
      throw new ApiError("NOT_FOUND", "missing", 404);
    },
    setConflictStatus: async () => {
      throw new ApiError("NOT_FOUND", "missing", 404);
    },
  });
  const result = await flushQueue(queue, client, {
    data: () => data,
    confirmItem: () => undefined,
    persist: () => undefined,
  });
  assert.equal(queue.current.length, 0);
  assert.deepEqual(
    result.rejected.map((r) => r.message),
    ["This event changed on another device."],
  );
});

test("a replayed create is followed by an update with the newest edits", async () => {
  const item = study();
  const data = { ...base(), items: [item] };
  const queue = { current: [{ type: "event", id: item.id }] as Op[] };
  let version = 1;
  const { client, calls } = fakeApi({
    createEvent: async () => ({ item: { ...item, version }, replayed: true }),
    updateEvent: async () => ({ item: { ...item, version: ++version } }),
  });
  const confirmed: number[] = [];
  await flushQueue(queue, client, {
    data: () => ({
      ...data,
      items: data.items.map((i) => ({ ...i, version: confirmed.at(-1) })),
    }),
    confirmItem: (i) => confirmed.push(i.version!),
    persist: () => undefined,
  });
  assert.deepEqual(calls, ["createEvent", "updateEvent"]);
  assert.deepEqual(confirmed, [1, 2]);
});

test("server data replaces the local copy but keeps device-only state", () => {
  const local = {
    ...base(),
    readNotifications: ["n1"],
    ignoredConflicts: ["local"],
  };
  const merged = mergeServer(local, {
    items: [study({ version: 4 })],
    contacts: [],
    settings: {
      profile: local.profile!,
      onboarded: true,
      preferences: local.preferences,
      availability: local.availability,
    },
    conflicts: [
      {
        id: "c1",
        date: "2026-10-13",
        type: "overlap",
        pairType: "fixed_fixed",
        status: "dismissed",
        eventIds: [],
        reason: "",
        detectedAt: "",
      },
    ],
  });
  assert.equal(merged.items[0].version, 4);
  assert.deepEqual(merged.readNotifications, ["n1"]);
  assert.deepEqual(merged.ignoredConflicts.sort(), ["c1", "local"]);
  assert.equal(merged.conflictStatus.c1, "dismissed");
});
