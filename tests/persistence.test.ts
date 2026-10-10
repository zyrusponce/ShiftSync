import { test } from "node:test";
import assert from "node:assert/strict";
import { restoreData } from "../src/domain/persistence";
import { createInitialData } from "../src/domain/seed";

test("valid persisted data restores without replacing user items", () => {
  const data = createInitialData();
  data.profile = {
    name: "Mia Cruz",
    email: "mia@example.com",
    organization: "School",
    role: "Student",
  };
  assert.deepEqual(restoreData(JSON.stringify(data)), data);
});
test("duplicate or empty item IDs are rejected before hydration", () => {
  const duplicate = createInitialData();
  duplicate.items[1].id = duplicate.items[0].id;
  assert.throws(() => restoreData(JSON.stringify(duplicate)));
  const empty = createInitialData();
  empty.items[0].id = " ";
  assert.throws(() => restoreData(JSON.stringify(empty)));
});
test("empty profile names and invalid emails are rejected before rendering", () => {
  const data = createInitialData();
  data.profile = {
    name: "",
    email: "mia@example.com",
    organization: "",
    role: "Student",
  };
  assert.throws(() => restoreData(JSON.stringify(data)));
  data.profile = {
    name: "Mia",
    email: "invalid",
    organization: "",
    role: "Student",
  };
  assert.throws(() => restoreData(JSON.stringify(data)));
});
test("invalid preference enum and negative buffer cannot reach scheduling", () => {
  const data = createInitialData();
  assert.throws(() =>
    restoreData(
      JSON.stringify({
        ...data,
        preferences: { ...data.preferences, defaultView: "Invalid" },
      }),
    ),
  );
  assert.throws(() =>
    restoreData(
      JSON.stringify({
        ...data,
        preferences: { ...data.preferences, bufferMinutes: -15 },
      }),
    ),
  );
});
test("incomplete metadata and malformed recurrence exceptions are rejected", () => {
  const data = createInitialData();
  assert.throws(() =>
    restoreData(JSON.stringify({ ...data, deletedNotifications: null })),
  );
  assert.throws(() =>
    restoreData(
      JSON.stringify({
        ...data,
        items: [{ ...data.items[0], exceptions: ["2026-02-30"] }],
      }),
    ),
  );
});
