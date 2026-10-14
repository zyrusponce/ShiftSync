// Events, contacts and preferences.
import { Router } from "express";
import { z } from "zod";
import type { AccountSettings } from "../../../src/domain/contract";
import {
  isValidAvailability,
  isValidItem,
  isValidPreferences,
  migratePreferences,
} from "../../../src/domain/persistence";
import { validateItem } from "../../../src/domain/schedule";
import type { ScheduleItem } from "../../../src/domain/types";
import { context, type Deps } from "../app";
import { settingsFrom } from "../context";
import { AppError, fail, parse } from "../http";
import { exportEvent, pushEventEdit } from "../services/calendar";
import {
  contactFromRow,
  itemToRow,
  roleToDb,
  rowToItem,
  rowsToItems,
} from "../mapping";
import type { Repo } from "../repo/types";
import {
  contactPatchSchema,
  contactSchema,
  eventCreateSchema,
  eventPatchSchema,
  id,
  settingsPatchSchema,
} from "../schemas";
import { CATEGORIES } from "../../../src/domain/persistence";

const eventsQuery = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  category: z.enum(CATEGORIES).optional(),
  kind: z.enum(["event", "shift", "task", "unavailable"]).optional(),
  upcoming: z.enum(["true", "false"]).optional(),
});

/** Drops unset optional fields (undefined, or null to clear them). */
function clean(item: ScheduleItem): ScheduleItem {
  return Object.fromEntries(
    Object.entries(item).filter(([, v]) => v !== undefined && v !== null),
  ) as ScheduleItem;
}
function check(item: ScheduleItem) {
  const problem = validateItem(item);
  if (problem) fail("VALIDATION_ERROR", problem);
  if (!isValidItem(item))
    fail("VALIDATION_ERROR", "Some event details are invalid.");
}
async function checkContacts(repo: Repo, ids: string[] | undefined) {
  if (!ids?.length) return;
  const owned = new Set((await repo.listContacts()).map((c) => c.id));
  if (ids.some((value) => !owned.has(value)))
    fail("VALIDATION_ERROR", "One of the selected contacts no longer exists.");
}
async function timeZoneOf(repo: Repo, email: string) {
  return settingsFrom(await repo.getProfile(), email).preferences.timeZone;
}
async function contactsOf(repo: Repo, eventId: string) {
  return (await repo.listEventContacts())
    .filter((l) => l.event_id === eventId)
    .map((l) => l.contact_id)
    .sort();
}

export function scheduleRoutes(deps: Deps) {
  const router = Router();

  router.get("/events", async (req, res) => {
    const { repo, user } = context(req);
    const query = parse(eventsQuery, req.query);
    const [profile, rows, links] = await Promise.all([
      repo.getProfile(),
      repo.listEvents(),
      repo.listEventContacts(),
    ]);
    const settings = settingsFrom(profile, user.email);
    const timeZone = settings.preferences.timeZone;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(
      new Date(),
    );
    const from = query.upcoming === "true" ? today : query.from;
    const items = rowsToItems(rows, links, timeZone).filter(
      (item) =>
        (!query.category || item.category === query.category) &&
        (!query.kind || item.kind === query.kind) &&
        (!query.to || item.date <= query.to) &&
        // A recurring item that started earlier can still occur in range.
        (!from || item.repeat !== "Never" || item.date >= from),
    );
    res.json({ items, timeZone });
  });

  router.post("/events", async (req, res) => {
    const { repo, user } = context(req);
    const item = clean(parse(eventCreateSchema, req.body) as ScheduleItem);
    check(item);
    const timeZone = await timeZoneOf(repo, user.email);
    const existing = await repo.getEvent(item.id);
    // A retried create returns what the first attempt stored.
    if (existing) {
      res.json({
        item: rowToItem(existing, await contactsOf(repo, item.id), timeZone),
        replayed: true,
      });
      return;
    }
    await checkContacts(repo, item.contactIds);
    const row = await repo.insertEvent(itemToRow(item, timeZone));
    if (item.contactIds?.length)
      await repo.setEventContacts(row.id, item.contactIds);
    res.status(201).json({
      item: rowToItem(row, [...(item.contactIds ?? [])].sort(), timeZone),
    });
  });

  router.patch("/events/:id", async (req, res) => {
    const { repo, user } = context(req);
    const eventId = parse(id, req.params.id);
    const { expectedVersion, ...changes } = parse(eventPatchSchema, req.body);
    const row = await repo.getEvent(eventId);
    if (!row)
      fail("NOT_FOUND", "This event was not found. It may have been deleted.");
    const timeZone = await timeZoneOf(repo, user.email);
    const current = rowToItem(row!, await contactsOf(repo, eventId), timeZone);
    if (expectedVersion !== undefined && expectedVersion !== row!.version)
      throw new AppError(
        "VERSION_CONFLICT",
        "This event changed on another device. Review the latest version.",
        { item: current },
      );
    const next = clean({
      ...current,
      ...(changes as Partial<ScheduleItem>),
      id: eventId,
    });
    // A new category brings its own fixed/flexible default unless one was sent.
    if (
      ("category" in changes || "kind" in changes) &&
      changes.fixed === undefined
    )
      delete next.fixed;
    check(next);
    if ("contactIds" in changes) await checkContacts(repo, changes.contactIds);
    const updated = await repo.updateEvent(
      eventId,
      itemToRow(next, timeZone),
      row!.version,
    );
    if (!updated)
      throw new AppError(
        "VERSION_CONFLICT",
        "This event changed while you were editing. Review the latest version.",
      );
    if ("contactIds" in changes)
      await repo.setEventContacts(eventId, changes.contactIds ?? []);
    // Edits to an event linked to Google Calendar are sent to that event.
    const calendar = await pushEventEdit(deps, repo, row!, updated);
    const final =
      calendar?.status === "synced"
        ? ((await repo.getEvent(eventId)) ?? updated)
        : updated;
    res.json({
      item: rowToItem(final, await contactsOf(repo, eventId), timeZone),
      ...(calendar && { calendar }),
    });
  });

  router.post("/calendar/events/:id", async (req, res) => {
    const { repo, user } = context(req);
    const eventId = parse(id, req.params.id);
    const row = await repo.getEvent(eventId);
    if (!row) fail("NOT_FOUND", "This event was not found.");
    const result = await exportEvent(deps, repo, row!);
    const timeZone = await timeZoneOf(repo, user.email);
    res.status(result.created ? 201 : 200).json({
      item: rowToItem(result.row, await contactsOf(repo, eventId), timeZone),
      created: result.created,
    });
  });

  router.delete("/events/:id", async (req, res) => {
    const { repo } = context(req);
    if (!(await repo.deleteEvent(parse(id, req.params.id))))
      fail("NOT_FOUND", "This event was not found.");
    res.status(204).end();
  });

  router.get("/contacts", async (req, res) => {
    const { repo } = context(req);
    res.json({ contacts: (await repo.listContacts()).map(contactFromRow) });
  });
  router.post("/contacts", async (req, res) => {
    const { repo } = context(req);
    const contact = parse(contactSchema, req.body);
    const existing = await repo.getContact(contact.id);
    if (existing) {
      res.json({ contact: contactFromRow(existing), replayed: true });
      return;
    }
    const row = await repo.insertContact({
      id: contact.id,
      name: contact.name,
      email: contact.email.toLowerCase(),
      role: roleToDb(contact.role),
    });
    res.status(201).json({ contact: contactFromRow(row) });
  });
  router.patch("/contacts/:id", async (req, res) => {
    const { repo } = context(req);
    const patch = parse(contactPatchSchema, req.body);
    const row = await repo.updateContact(parse(id, req.params.id), {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.email !== undefined && { email: patch.email.toLowerCase() }),
      ...(patch.role !== undefined && { role: roleToDb(patch.role) }),
    });
    if (!row) fail("NOT_FOUND", "This contact was not found.");
    res.json({ contact: contactFromRow(row!) });
  });
  router.delete("/contacts/:id", async (req, res) => {
    const { repo } = context(req);
    if (!(await repo.deleteContact(parse(id, req.params.id))))
      fail("NOT_FOUND", "This contact was not found.");
    res.status(204).end();
  });

  router.get("/preferences", async (req, res) => {
    const { repo, user } = context(req);
    res.json(settingsFrom(await repo.getProfile(), user.email));
  });
  router.patch("/preferences", async (req, res) => {
    const { repo, user } = context(req);
    const patch = parse(settingsPatchSchema, req.body);
    const current = settingsFrom(await repo.getProfile(), user.email);
    const next: AccountSettings = {
      profile: patch.profile
        ? { ...current.profile, ...patch.profile }
        : current.profile,
      onboarded: patch.onboarded ?? current.onboarded,
      preferences: patch.preferences
        ? migratePreferences({ ...current.preferences, ...patch.preferences })
        : current.preferences,
      availability:
        (patch.availability as AccountSettings["availability"]) ??
        current.availability,
    };
    if (!isValidPreferences(next.preferences))
      fail("VALIDATION_ERROR", "Some preferences are invalid.");
    if (!isValidAvailability(next.availability))
      fail("VALIDATION_ERROR", "Your availability is invalid.");
    await repo.saveProfile({
      email: user.email || null,
      display_name: next.profile.name,
      timezone: next.preferences.timeZone,
      preferences_json: {
        preferences: next.preferences,
        availability: next.availability,
        profile: {
          organization: next.profile.organization,
          roles: next.profile.roles,
        },
        onboarded: next.onboarded,
      },
    });
    res.json(next);
  });
  return router;
}
