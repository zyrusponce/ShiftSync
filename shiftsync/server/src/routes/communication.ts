// AI explanations, email drafts, and Gmail drafts/sending. Recipients are
// always contacts linked to the conflicting events; nothing is ever sent
// without an explicit, confirmed request from the student.
import { Router } from "express";
import { z } from "zod";
import type { DraftResponse } from "../../../src/domain/contract";
import { analyzeShiftImpact } from "../../../src/domain/impact";
import type { ScheduleItem } from "../../../src/domain/types";
import { context, idempotent, type Deps } from "../app";
import { findConflict, loadSchedule } from "../context";
import {
  AppError,
  fail,
  parse,
  rateLimit,
  requireIdempotencyKey,
} from "../http";
import { contactFromRow, notificationFromRow } from "../mapping";
import {
  chatSchema,
  draftSchema,
  explainSchema,
  gmailDraftSchema,
  gmailSendSchema,
} from "../schemas";
import {
  conflictExplanation,
  conflictFacts,
  draftEmail,
  explain,
  impactExplanation,
  impactFacts,
} from "../services/communication";
import {
  GoogleApiError,
  buildRawEmail,
  googleAccess,
} from "../services/google";
import { recordConflict } from "./recovery";
import { emailHighlights, renderEmailHtml } from "../services/emailFormat";
import type { Repo } from "../repo/types";
import { chatReply } from "../services/assistant";

const EDITABLE = ["prepared", "draft_saved", "failed"] as const;

export function communicationRoutes(deps: Deps) {
  const router = Router();
  const aiLimit = rateLimit(20, 60_000);
  // The HTML version of a message: what to emphasise comes from the
  // conflict on the student's current schedule, not from guessing at text.
  const emailHtml = async (
    repo: Repo,
    email: string,
    conflictKey: string,
    body: string,
  ) => {
    const schedule = await loadSchedule(repo, email, deps.now());
    return renderEmailHtml(
      body,
      emailHighlights(findConflict(schedule, conflictKey)),
    );
  };

  router.post("/ai/explain", aiLimit, async (req, res) => {
    const { repo, user } = context(req);
    const body = parse(explainSchema, req.body);
    const schedule = await loadSchedule(repo, user.email, deps.now());
    const enabled = schedule.settings.preferences.aiEnabled;
    if ("conflictId" in body) {
      const conflict = findConflict(schedule, body.conflictId);
      if (!conflict)
        fail("NOT_FOUND", "This conflict is no longer on your schedule.");
      const facts = conflictFacts(conflict!, schedule.settings.profile.name);
      res.json(
        await explain(deps.ai, facts, conflictExplanation(conflict!), enabled),
      );
      return;
    }
    const proposed = body.shift as ScheduleItem;
    if (proposed.kind !== "shift")
      fail("VALIDATION_ERROR", "Only work shifts can be analyzed.");
    const report = analyzeShiftImpact({
      items: schedule.items,
      proposed,
      availability: schedule.settings.availability,
      preferences: schedule.settings.preferences,
      now: schedule.now,
      horizonDays: body.horizonDays,
    });
    res.json(
      await explain(
        deps.ai,
        impactFacts(report),
        impactExplanation(report),
        enabled,
      ),
    );
  });

  router.post("/ai/chat", aiLimit, async (req, res) => {
    const { repo, user } = context(req);
    const { messages } = parse(chatSchema, req.body);
    const schedule = await loadSchedule(repo, user.email, deps.now());
    res.json(
      await chatReply(
        deps.ai,
        schedule,
        messages,
        schedule.settings.preferences.aiEnabled,
      ),
    );
  });

  router.post("/ai/draft", aiLimit, async (req, res) => {
    const { repo, user } = context(req);
    const body = parse(draftSchema, req.body);
    const schedule = await loadSchedule(repo, user.email, deps.now());
    const conflict = findConflict(schedule, body.conflictId);
    if (!conflict)
      fail("NOT_FOUND", "This conflict is no longer on your schedule.");
    const row = await repo.getContact(body.contactId);
    if (!row) fail("NOT_FOUND", "This contact was not found.");
    const contact = contactFromRow(row!);
    // The student picks the recipient, but only among the people linked to
    // the conflicting events.
    const linked = [conflict!.first, conflict!.second].filter(
      (item): item is ScheduleItem =>
        !!item && !!item.contactIds?.includes(contact.id),
    );
    if (!linked.length)
      fail(
        "VALIDATION_ERROR",
        "This contact isn't linked to either event in this conflict.",
      );
    const related =
      linked.find((item) =>
        contact.role === "Work"
          ? item.kind === "shift"
          : item.category === "Class",
      ) ?? linked[0];
    const draft = await draftEmail(
      deps.ai,
      conflict!,
      { name: contact.name, role: contact.role, relatedEvent: related },
      schedule.settings.profile.name,
      schedule.settings.preferences.aiEnabled,
    );
    const stored = await recordConflict(repo, conflict!);
    const notification = await repo.insertNotification({
      conflict_id: stored?.id ?? null,
      conflict_key: conflict!.id,
      contact_id: contact.id,
      recipient_email: contact.email,
      recipient_name: contact.name,
      recipient_role: row!.role,
      subject: draft.subject,
      body: draft.body,
      source: draft.source,
    });
    await repo.setConflictStatus(conflict!.id, "draft_prepared", [
      "unresolved",
    ]);
    const response: DraftResponse = {
      notification: notificationFromRow(notification),
      source: draft.source,
      ...(draft.fallbackReason && { fallbackReason: draft.fallbackReason }),
    };
    res.status(201).json(response);
  });

  router.get("/notifications", async (req, res) => {
    const { repo } = context(req);
    const { conflictId } = parse(
      z.object({ conflictId: z.string().max(200).optional() }),
      req.query,
    );
    res.json({
      notifications: (await repo.listNotifications(conflictId)).map(
        notificationFromRow,
      ),
    });
  });

  router.post("/gmail/drafts", async (req, res) => {
    const { repo, user } = context(req);
    const body = parse(gmailDraftSchema, req.body);
    const notification = await repo.getNotification(body.notificationId);
    if (!notification) fail("NOT_FOUND", "This message was not found.");
    if (notification!.status === "sent")
      fail("VALIDATION_ERROR", "This message was already sent.");
    if (notification!.status === "sending")
      fail(
        "REQUEST_IN_PROGRESS",
        "This message is being sent. Please wait a moment.",
      );
    const { token } = await googleAccess(
      deps.google,
      deps.tokenKey,
      repo,
      "gmail",
      deps.now(),
    );
    const raw = buildRawEmail({
      to: notification!.recipient_email,
      toName: notification!.recipient_name,
      subject: body.subject,
      body: body.body,
      html: await emailHtml(
        repo,
        user.email,
        notification!.conflict_key,
        body.body,
      ),
    });
    let draftId: string;
    try {
      draftId = notification!.gmail_draft_id
        ? (
            await deps.google
              .updateDraft(token, notification!.gmail_draft_id, raw)
              .catch((error) => {
                if (error instanceof GoogleApiError && error.status === 404)
                  return deps.google.createDraft(token, raw);
                throw error;
              })
          ).id
        : (await deps.google.createDraft(token, raw)).id;
    } catch (error) {
      if (!(error instanceof GoogleApiError)) throw error;
      throw new AppError(
        "EMAIL_SEND_FAILED",
        "Gmail couldn't save this draft. Nothing was sent; you can try again or copy the message.",
      );
    }
    const edited =
      body.subject !== notification!.subject ||
      body.body !== notification!.body;
    const saved = await repo.updateNotification(
      notification!.id,
      {
        subject: body.subject,
        body: body.body,
        source: edited ? "user" : notification!.source,
        status: "draft_saved",
        gmail_draft_id: draftId,
        error_code: null,
      },
      [...EDITABLE],
    );
    if (!saved)
      fail(
        "REQUEST_IN_PROGRESS",
        "This message changed while saving. Please try again.",
      );
    res.json({ notification: notificationFromRow(saved!) });
  });

  router.post("/gmail/send", rateLimit(10, 60_000), async (req, res) => {
    const { repo, user } = context(req);
    const key = requireIdempotencyKey(req);
    const body = parse(gmailSendSchema, req.body);
    const result = await idempotent(repo, "gmail-send", key, async () => {
      const notification = await repo.getNotification(body.notificationId);
      if (!notification) fail("NOT_FOUND", "This message was not found.");
      const n = notification!;
      // Never send the same message twice.
      if (n.status === "sent")
        return { status: 200, body: { notification: notificationFromRow(n) } };
      if (n.status === "sending")
        fail("REQUEST_IN_PROGRESS", "This message is already being sent.");
      if (body.recipientEmail.toLowerCase() !== n.recipient_email.toLowerCase())
        fail(
          "VALIDATION_ERROR",
          "The recipient doesn't match this message. Review it again before sending.",
        );
      if (n.contact_id) {
        const contact = await repo.getContact(n.contact_id);
        if (
          !contact ||
          contact.email.toLowerCase() !== n.recipient_email.toLowerCase()
        )
          fail(
            "VALIDATION_ERROR",
            "This contact's email address changed. Prepare the message again.",
          );
      }
      const { token } = await googleAccess(
        deps.google,
        deps.tokenKey,
        repo,
        "gmail",
        deps.now(),
      );
      // Built before claiming the message, so a failure here can't leave it
      // stuck in "sending".
      const html = await emailHtml(repo, user.email, n.conflict_key, body.body);
      const edited = body.subject !== n.subject || body.body !== n.body;
      const claimed = await repo.updateNotification(
        n.id,
        {
          status: "sending",
          subject: body.subject,
          body: body.body,
          source: edited ? "user" : n.source,
        },
        [...EDITABLE],
      );
      if (!claimed)
        fail("REQUEST_IN_PROGRESS", "This message is already being sent.");
      const raw = buildRawEmail({
        to: n.recipient_email,
        toName: n.recipient_name,
        subject: body.subject,
        body: body.body,
        html,
      });
      let messageId: string;
      try {
        if (n.gmail_draft_id) {
          try {
            await deps.google.updateDraft(token, n.gmail_draft_id, raw);
            messageId = (await deps.google.sendDraft(token, n.gmail_draft_id))
              .id;
          } catch (error) {
            if (!(error instanceof GoogleApiError && error.status === 404))
              throw error;
            messageId = (await deps.google.sendMessage(token, raw)).id;
          }
        } else messageId = (await deps.google.sendMessage(token, raw)).id;
      } catch (error) {
        const unknown =
          !(error instanceof GoogleApiError) || error.status === 0;
        const failed = await repo.updateNotification(n.id, {
          status: "failed",
          error_code:
            error instanceof GoogleApiError
              ? `gmail_${error.status || "network"}`
              : "unknown",
        });
        deps.log.warn("gmail_send_failed", {
          status: error instanceof GoogleApiError ? error.status : null,
        });
        throw new AppError(
          "EMAIL_SEND_FAILED",
          unknown
            ? "We couldn't confirm whether Gmail sent this message. Check your Gmail Sent folder before trying again."
            : "Gmail did not send this message. It was not delivered; you can try again or copy it.",
          { notification: failed && notificationFromRow(failed) },
        );
      }
      const sent = await repo.updateNotification(n.id, {
        status: "sent",
        gmail_message_id: messageId,
        sent_at: deps.now().toISOString(),
        error_code: null,
      });
      // Contacting someone is progress, not a resolution: the student
      // decides when the conflict is resolved.
      await repo.setConflictStatus(n.conflict_key, "user_contacted", [
        "unresolved",
        "draft_prepared",
      ]);
      return {
        status: 200,
        body: { notification: notificationFromRow(sent!) },
      };
    });
    res.status(result.status).json(result.body);
  });
  return router;
}
