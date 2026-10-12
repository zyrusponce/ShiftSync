// Conflicts, Shift Impact Analysis, recovery suggestions and approval.
import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type {
  ApproveResponse,
  ConflictRecord,
  SuggestionsResponse,
} from "../../../src/domain/contract";
import { analyzeShiftImpact } from "../../../src/domain/impact";
import { resolutionPlan } from "../../../src/domain/policy";
import {
  applyPlan,
  generateRecovery,
  validatePlan,
} from "../../../src/domain/recovery";
import { occursOn, validateItem } from "../../../src/domain/schedule";
import type {
  Conflict,
  ConflictStatus,
  ScheduleItem,
} from "../../../src/domain/types";
import { context, idempotent, type Deps } from "../app";
import { currentConflicts, findConflict, loadSchedule } from "../context";
import { AppError, fail, parse, requireIdempotencyKey } from "../http";
import { itemToRow, rowsToItems } from "../mapping";
import type {
  ConflictInsert,
  RecoveryInsert,
  RecoveryUpdate,
  Repo,
} from "../repo/types";
import { calendarProblem, pushRecovery } from "../services/calendar";
import {
  analyzeSchema,
  conflictStatusSchema,
  id,
  suggestionsSchema,
} from "../schemas";

export const conflictRow = (conflict: Conflict): ConflictInsert => ({
  conflict_key: conflict.id,
  event_a_id: conflict.first.id,
  event_b_id: conflict.second?.id ?? null,
  occurrence_date: conflict.date,
  conflict_type: conflict.type,
  pair_type: conflict.second
    ? resolutionPlan(conflict.first, conflict.second).pairType
    : null,
});
/** The stored record for a detected conflict, creating it if needed. */
export async function recordConflict(repo: Repo, conflict: Conflict) {
  const rows = await repo.recordConflicts([conflictRow(conflict)]);
  return rows.find((row) => row.conflict_key === conflict.id) ?? null;
}

export function recoveryRoutes(deps: Deps) {
  const router = Router();

  router.get("/conflicts", async (req, res) => {
    const { repo, user } = context(req);
    const { days } = parse(
      z.object({ days: z.coerce.number().int().min(1).max(31).default(14) }),
      req.query,
    );
    const schedule = await loadSchedule(repo, user.email, deps.now());
    const conflicts = currentConflicts(schedule, days);
    const stored = new Map(
      (await repo.recordConflicts(conflicts.map(conflictRow))).map((row) => [
        row.conflict_key,
        row,
      ]),
    );
    const records: ConflictRecord[] = conflicts.map((conflict) => {
      const row = stored.get(conflict.id);
      return {
        id: conflict.id,
        date: conflict.date,
        type: conflict.type,
        pairType: conflictRow(conflict).pair_type,
        status: row?.status ?? "unresolved",
        eventIds: [
          conflict.first.id,
          ...(conflict.second ? [conflict.second.id] : []),
        ],
        reason: conflict.reason,
        detectedAt: row?.detected_at ?? deps.now().toISOString(),
      };
    });
    res.json({ conflicts: records });
  });

  router.patch("/conflicts/:id/status", async (req, res) => {
    const { repo, user } = context(req);
    const key = parse(z.string().min(12).max(200), req.params.id);
    const { status } = parse(conflictStatusSchema, req.body);
    let row = await repo.setConflictStatus(key, status as ConflictStatus);
    if (!row) {
      const conflict = findConflict(
        await loadSchedule(repo, user.email, deps.now()),
        key,
      );
      if (!conflict)
        fail("NOT_FOUND", "This conflict is no longer on your schedule.");
      await recordConflict(repo, conflict!);
      row = await repo.setConflictStatus(key, status as ConflictStatus);
    }
    res.json({ id: key, status: row!.status });
  });

  router.post("/conflicts/analyze", async (req, res) => {
    const { repo, user } = context(req);
    const { shift, horizonDays } = parse(analyzeSchema, req.body);
    const proposed = shift as ScheduleItem;
    if (proposed.kind !== "shift")
      fail("VALIDATION_ERROR", "Only work shifts can be analyzed.");
    const problem = validateItem(proposed);
    if (problem) fail("VALIDATION_ERROR", problem);
    const schedule = await loadSchedule(repo, user.email, deps.now());
    const stored = schedule.items.find((item) => item.id === proposed.id);
    if (stored && stored.kind !== "shift")
      fail("VALIDATION_ERROR", "Only work shifts can be analyzed.");
    // A preview only: nothing is saved until the student approves a change.
    const report = analyzeShiftImpact({
      items: schedule.items,
      proposed: {
        ...stored,
        ...proposed,
        contactIds: stored?.contactIds ?? proposed.contactIds,
      },
      availability: schedule.settings.availability,
      preferences: schedule.settings.preferences,
      now: schedule.now,
      horizonDays,
    });
    res.json({ report });
  });

  router.post("/suggestions", async (req, res) => {
    const { repo, user } = context(req);
    const body = parse(suggestionsSchema, req.body);
    const schedule = await loadSchedule(repo, user.email, deps.now());
    const target = schedule.items.find((item) => item.id === body.eventId);
    const row = schedule.rows.find((value) => value.id === body.eventId);
    if (!target || !row) fail("NOT_FOUND", "This event was not found.");
    if (!occursOn(target!, body.occurrenceDate))
      fail("VALIDATION_ERROR", "This event is not scheduled on that day.");
    const { preferences, availability } = schedule.settings;
    const result = generateRecovery({
      target: target!,
      occurrenceDate: body.occurrenceDate,
      items: schedule.items,
      availability,
      preferences,
      now: schedule.now,
      horizonDays: preferences.planningHorizonDays,
      reserved: body.reserved,
    });
    if (result.status !== "OK") {
      const response: SuggestionsResponse = {
        status: result.status,
        reason: result.reason,
        window: result.window,
      };
      res.json(response);
      return;
    }
    let conflictId: string | null = null;
    if (body.conflictId) {
      const conflict = findConflict(schedule, body.conflictId);
      if (conflict)
        conflictId = (await recordConflict(repo, conflict))?.id ?? null;
    }
    await repo.supersedeSuggestions(target!.id, body.occurrenceDate);
    const rows = await repo.insertSuggestions(
      result.options.map((option) => ({
        conflict_id: conflictId,
        event_id: target!.id,
        occurrence_date: body.occurrenceDate,
        event_version: row!.version,
        kind: option.kind,
        proposed_blocks_json: option.blocks,
        score: option.score,
        rank: option.rank,
        explanation: option.explanation,
      })),
    );
    const response: SuggestionsResponse = {
      status: "OK",
      window: result.window,
      suggestions: result.options.map((option) => ({
        ...option,
        suggestionId: rows.find((r) => r.rank === option.rank)!.id,
        status: "pending",
      })),
    };
    res.status(201).json(response);
  });

  router.post("/suggestions/:id/approve", async (req, res) => {
    const { repo, user } = context(req);
    const key = requireIdempotencyKey(req);
    const suggestionId = parse(id, req.params.id);
    const result = await idempotent(repo, "approve", key, async () => {
      const suggestion = await repo.getSuggestion(suggestionId);
      if (!suggestion) fail("NOT_FOUND", "This suggestion was not found.");
      const schedule = await loadSchedule(repo, user.email, deps.now());
      const links = () => repo.listEventContacts();
      if (suggestion!.status === "approved" && suggestion!.result_json) {
        const ids = [
          ...suggestion!.result_json.updated,
          ...suggestion!.result_json.created,
        ];
        const body: ApproveResponse = {
          items: rowsToItems(
            await repo.getEvents(ids),
            await links(),
            schedule.timeZone,
          ),
          removedIds: [],
          calendar: { status: "already_applied" },
        };
        return { status: 200, body };
      }
      const stale = async (message: string): Promise<never> => {
        await repo.setSuggestionStatus(suggestionId, "stale");
        throw new AppError("STALE_SUGGESTION", message);
      };
      if (suggestion!.status !== "pending")
        return stale(
          "This suggestion is out of date. Please review the latest options.",
        );
      const row = schedule.rows.find(
        (value) => value.id === suggestion!.event_id,
      );
      const target = schedule.items.find(
        (item) => item.id === suggestion!.event_id,
      );
      if (!row || !target || row.version !== suggestion!.event_version)
        return stale(
          "This event changed after the suggestion was made. Please review new options.",
        );
      const blocks = suggestion!.proposed_blocks_json;
      const { preferences, availability } = schedule.settings;
      // Re-check against the schedule as it is now, not as it was.
      const reason = validatePlan({
        target,
        occurrenceDate: suggestion!.occurrence_date,
        items: schedule.items,
        availability,
        preferences,
        now: schedule.now,
        blocks,
      });
      if (reason) return stale(reason);
      const external = await calendarProblem(deps, repo, schedule, blocks);
      if (external) return stale(external);
      const applied = applyPlan(
        schedule.items,
        target.id,
        suggestion!.occurrence_date,
        blocks,
        () => crypto.randomUUID(),
      );
      const updates: RecoveryUpdate[] = applied.updated.map((itemId) => {
        const item = applied.items.find((value) => value.id === itemId)!;
        const next = itemToRow(item, schedule.timeZone);
        return {
          id: itemId,
          title: next.title,
          start_at: next.start_at,
          end_at: next.end_at,
          exception_dates: next.exception_dates,
        };
      });
      const inserts: RecoveryInsert[] = applied.created.map((itemId) => {
        const next = itemToRow(
          applied.items.find((value) => value.id === itemId)!,
          schedule.timeZone,
        );
        return {
          id: next.id,
          title: next.title,
          kind: next.kind,
          category: next.category,
          start_at: next.start_at,
          end_at: next.end_at,
          timezone: next.timezone,
          is_fixed: next.is_fixed,
          priority: next.priority,
          deadline_at: next.deadline_at,
          is_splittable: next.is_splittable,
          minimum_block_minutes: next.minimum_block_minutes,
          status: next.status,
          details: next.details,
        };
      });
      const changed = await repo.applyRecovery({
        suggestionId,
        eventId: target.id,
        expectedVersion: row.version,
        updates,
        inserts,
      });
      if (suggestion!.conflict_id) {
        const conflict = (await repo.listConflicts()).find(
          (c) => c.id === suggestion!.conflict_id,
        );
        if (conflict)
          await repo.setConflictStatus(conflict.conflict_key, "resolved", [
            "unresolved",
            "draft_prepared",
          ]);
      }
      const calendar = await pushRecovery(
        deps,
        repo,
        row,
        changed,
        applied.created,
      );
      const ids = changed.map((value) => value.id);
      const body: ApproveResponse = {
        items: rowsToItems(
          await repo.getEvents(ids),
          await links(),
          schedule.timeZone,
        ),
        removedIds: [],
        calendar,
      };
      return { status: 200, body };
    });
    res.status(result.status).json(result.body);
  });
  return router;
}
