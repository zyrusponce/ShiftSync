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
    roles: ["Student"],
  };
  assert.deepEqual(restoreData(JSON.stringify(data)), data);
});
test("several roles restore, and a single saved role becomes a list", () => {
  const data = createInitialData();
  data.profile = {
    name: "Mia Cruz",
    email: "mia@example.com",
    organization: "",
    roles: ["Student", "Freelancer"],
  };
  assert.deepEqual(restoreData(JSON.stringify(data)).profile, data.profile);
  const { roles: _roles, ...legacy } = data.profile;
  const restored = restoreData(
    JSON.stringify({ ...data, profile: { ...legacy, role: "Employee" } }),
  );
  assert.deepEqual(restored.profile?.roles, ["Employee"]);
  assert.throws(() =>
    restoreData(
      JSON.stringify({
        ...data,
        profile: { ...data.profile, roles: ["Student", "Student"] },
      }),
    ),
  );
  assert.throws(() =>
    restoreData(
      JSON.stringify({
        ...data,
        profile: { ...data.profile, roles: ["Chef"] },
      }),
    ),
  );
});
test("the onboarding step to resume must be one of the four steps", () => {
  const data = createInitialData();
  assert.equal(
    restoreData(JSON.stringify({ ...data, onboardingStep: 2 })).onboardingStep,
    2,
  );
  assert.throws(() =>
    restoreData(JSON.stringify({ ...data, onboardingStep: 7 })),
  );
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
    roles: ["Student"],
  };
  assert.throws(() => restoreData(JSON.stringify(data)));
  data.profile = {
    name: "Mia",
    email: "invalid",
    organization: "",
    roles: ["Student"],
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

test("recurring task completion dates survive storage and reject invalid dates", () => {
  const data = createInitialData();
  data.items[0] = {
    ...data.items[0],
    kind: "task",
    repeat: "Daily",
    completedDates: [data.items[0].date],
  };
  assert.deepEqual(restoreData(JSON.stringify(data)), data);
  data.items[0].completedDates = ["2026-02-30"];
  assert.throws(() => restoreData(JSON.stringify(data)));
});

test("13. saved events, contacts and recovery fields survive an app restart", () => {
  const data = createInitialData();
  data.conflictStatus = { "2026-10-12:a:b": "draft_prepared" };
  const restored = restoreData(JSON.stringify(data));
  assert.deepEqual(restored, data);
  const review = restored.items.find((item) => item.title === "Exam review");
  assert.equal(review?.splittable, true);
  assert.match(review?.deadline ?? "", /^\d{4}-\d{2}-\d{2}T09:00$/);
  assert.equal(restored.contacts.length, 2);
});
test("data saved before recovery features existed still restores", () => {
  const data = createInitialData();
  const legacy = JSON.parse(JSON.stringify(data));
  delete legacy.contacts;
  delete legacy.conflictStatus;
  delete legacy.preferences.travelMinutes;
  delete legacy.preferences.planningHorizonDays;
  delete legacy.preferences.recoveryWeights;
  for (const item of legacy.items) {
    delete item.contactIds;
    delete item.deadline;
    delete item.splittable;
    delete item.minBlockMinutes;
    if (item.category === "Class" || item.category === "Study")
      item.category = "Personal";
  }
  const restored = restoreData(JSON.stringify(legacy));
  assert.deepEqual(restored.contacts, []);
  assert.deepEqual(restored.conflictStatus, {});
  assert.equal(restored.preferences.travelMinutes, 0);
  assert.equal(restored.preferences.planningHorizonDays, 7);
  assert.equal(restored.items.length, data.items.length);
});
test("invalid contacts, deadlines and conflict statuses are rejected", () => {
  const data = createInitialData();
  assert.throws(() =>
    restoreData(
      JSON.stringify({
        ...data,
        contacts: [{ ...data.contacts[0], email: "nope" }],
      }),
    ),
  );
  assert.throws(() =>
    restoreData(
      JSON.stringify({
        ...data,
        items: [{ ...data.items[0], deadline: "2026-02-30T09:00" }],
      }),
    ),
  );
  assert.throws(() =>
    restoreData(JSON.stringify({ ...data, conflictStatus: { x: "maybe" } })),
  );
});
