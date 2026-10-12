// Recovery and communication actions for screens. Signed-in accounts use the
// server (which stores suggestions, rechecks them on approval and syncs
// Google); the on-device demo runs the same shared engine locally.
import { useCallback, useMemo } from "react";
import type {
  CalendarSyncReport,
  EmailNotification,
  ExplainResponse,
} from "../domain/contract";
import { analyzeShiftImpact, type ImpactReport } from "../domain/impact";
import {
  conflictExplanation,
  impactExplanation,
  templateDraft,
} from "../domain/messages";
import {
  applyPlan,
  generateRecovery,
  localNow,
  validatePlan,
  type RecoveryOption,
  type SearchWindow,
} from "../domain/recovery";
import { findConflicts } from "../domain/schedule";
import { uuid } from "../domain/ids";
import type { Conflict, Contact, ScheduleItem } from "../domain/types";
import { ApiError, api, isNetworkError } from "../services/api";
import { useApp } from "./AppStore";

export type Option = RecoveryOption & { suggestionId: string };
export type Suggestions =
  | { status: "OK"; options: Option[]; window: SearchWindow }
  | {
      status: "NO_FEASIBLE_SLOT" | "NOT_MOVABLE";
      reason: string;
      window: SearchWindow;
    };
export type Draft = EmailNotification & {
  fallbackReason?: ExplainResponse["fallbackReason"];
};

const notSynced = () =>
  new ApiError(
    "NETWORK_ERROR",
    "Your latest changes haven't reached ShiftSync yet. Connect to the internet and try again.",
  );

export function useRecovery() {
  const {
    data,
    account,
    flush,
    applyServerItems,
    replaceItems,
    setConflictStatus,
  } = useApp();
  const remote = !!account;
  const local = useCallback(
    () => ({
      availability: data.availability,
      preferences: data.preferences,
      now: localNow(),
    }),
    [data.availability, data.preferences],
  );

  /** Preview of a shift change. Offline accounts get an on-device preview. */
  const analyzeShift = useCallback(
    async (
      proposed: ScheduleItem,
    ): Promise<{ report: ImpactReport; offline: boolean }> => {
      if (remote)
        try {
          if (!(await flush())) throw notSynced();
          return {
            report: (await api.analyzeShift(proposed)).report,
            offline: false,
          };
        } catch (error) {
          if (!isNetworkError(error)) throw error;
        }
      return {
        report: analyzeShiftImpact({ items: data.items, proposed, ...local() }),
        offline: remote,
      };
    },
    [remote, flush, data.items, local],
  );

  const suggestions = useCallback(
    async (
      target: ScheduleItem,
      occurrenceDate: string,
      conflictId?: string,
    ): Promise<Suggestions> => {
      if (remote) {
        if (!(await flush())) throw notSynced();
        const result = await api.suggestions({
          eventId: target.id,
          occurrenceDate,
          conflictId,
        });
        return result.status === "OK"
          ? { status: "OK", window: result.window, options: result.suggestions }
          : result;
      }
      const result = generateRecovery({
        target,
        occurrenceDate,
        items: data.items,
        horizonDays: data.preferences.planningHorizonDays,
        ...local(),
      });
      return result.status === "OK"
        ? {
            status: "OK",
            window: result.window,
            options: result.options.map((o) => ({ ...o, suggestionId: o.key })),
          }
        : {
            status: result.status,
            reason: result.reason,
            window: result.window,
          };
    },
    [remote, flush, data.items, data.preferences.planningHorizonDays, local],
  );

  /** Saves an approved option after checking it against the current schedule. */
  const approve = useCallback(
    async (
      option: Option,
      idempotencyKey: string,
      conflictId?: string,
    ): Promise<CalendarSyncReport | null> => {
      if (remote) {
        const result = await api.approve(option.suggestionId, idempotencyKey);
        applyServerItems(result.items);
        return result.calendar;
      }
      const target = data.items.find((item) => item.id === option.eventId);
      if (!target) throw new Error("This event is no longer on your schedule.");
      const problem = validatePlan({
        target,
        occurrenceDate: option.occurrenceDate,
        items: data.items,
        blocks: option.blocks,
        ...local(),
      });
      if (problem) throw new ApiError("STALE_SUGGESTION", problem, 409);
      replaceItems(
        applyPlan(
          data.items,
          target.id,
          option.occurrenceDate,
          option.blocks,
          uuid,
        ).items,
      );
      if (conflictId) setConflictStatus(conflictId, "resolved");
      return null;
    },
    [
      remote,
      applyServerItems,
      data.items,
      local,
      replaceItems,
      setConflictStatus,
    ],
  );

  const explain = useCallback(
    async (
      request:
        { conflict: Conflict } | { shift: ScheduleItem; report: ImpactReport },
    ): Promise<ExplainResponse> => {
      const fallback = (
        fallbackReason: ExplainResponse["fallbackReason"],
      ): ExplainResponse => ({
        text:
          "conflict" in request
            ? conflictExplanation(request.conflict)
            : impactExplanation(request.report),
        source: "template",
        fallbackReason,
      });
      if (!remote)
        return fallback(
          data.preferences.aiEnabled ? "AI_SERVICE_UNAVAILABLE" : "AI_DISABLED",
        );
      try {
        return await api.explain(
          "conflict" in request
            ? { conflictId: request.conflict.id }
            : { shift: request.shift },
        );
      } catch (error) {
        if (isNetworkError(error)) return fallback("AI_SERVICE_UNAVAILABLE");
        throw error;
      }
    },
    [remote, data.preferences.aiEnabled],
  );

  /** One editable message for one chosen contact. */
  const draft = useCallback(
    async (conflict: Conflict, contact: Contact): Promise<Draft> => {
      if (remote) {
        if (!(await flush())) throw notSynced();
        const result = await api.draft(conflict.id, contact.id);
        setConflictStatus(
          conflict.id,
          data.conflictStatus[conflict.id] ?? "draft_prepared",
        );
        return {
          ...result.notification,
          fallbackReason: result.fallbackReason,
        };
      }
      const related =
        [conflict.first, conflict.second].find((item) =>
          item?.contactIds?.includes(contact.id),
        ) ?? conflict.first;
      const message = templateDraft(
        conflict,
        { name: contact.name, role: contact.role, relatedEvent: related },
        data.profile?.name ?? "",
      );
      if (!data.conflictStatus[conflict.id])
        setConflictStatus(conflict.id, "draft_prepared");
      return {
        id: uuid(),
        conflictId: conflict.id,
        contactId: contact.id,
        recipientEmail: contact.email,
        recipientName: contact.name,
        recipientRole: contact.role,
        ...message,
        source: "template",
        status: "prepared",
        gmailDraftId: null,
        gmailMessageId: null,
        errorCode: null,
        sentAt: null,
        updatedAt: new Date().toISOString(),
        fallbackReason: "AI_SERVICE_UNAVAILABLE",
      };
    },
    [remote, flush, data.profile, data.conflictStatus, setConflictStatus],
  );

  /** The conflict as detected right now, or null if it no longer exists. */
  const findConflict = useCallback(
    (conflictId: string): Conflict | null =>
      findConflicts(
        data.items,
        data.availability,
        data.preferences,
        conflictId.slice(0, 10),
        1,
      ).find((conflict) => conflict.id === conflictId) ?? null,
    [data.items, data.availability, data.preferences],
  );

  return useMemo(
    () => ({
      remote,
      analyzeShift,
      suggestions,
      approve,
      explain,
      draft,
      findConflict,
    }),
    [remote, analyzeShift, suggestions, approve, explain, draft, findConflict],
  );
}
