// Conflict communication. The student chooses who to notify; each message is
// prepared separately, fully editable, and only sent after an explicit
// confirmation that shows the exact recipient address.
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { dialog } from "../components/dialog";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect } from "@react-navigation/native";
import {
  Badge,
  Button,
  Card,
  Choice,
  Empty,
  Field,
  Header,
  Label,
  Screen,
  Section,
} from "../components/ui";
import { FadeIn, animateLayout, haptics } from "../components/motion";
import type { NotificationStatus } from "../domain/contract";
import { uuid } from "../domain/ids";
import { formatDate, formatTime } from "../domain/schedule";
import type { Contact, ScheduleItem } from "../domain/types";
import { ApiError, api, messageOf } from "../services/api";
import { useApp } from "../store/AppStore";
import { useRecovery, type Draft } from "../store/useRecovery";
import type { StackProps } from "../navigation/types";
import { palette } from "../theme";
import { statusLabel } from "./ConflictScreens";

type GmailState =
  "checking" | "ready" | "not_connected" | "not_configured" | "unavailable";
type Message = {
  draft: Draft;
  subject: string;
  body: string;
  busy: null | "save" | "send";
  /** Reused for retries so one confirmed send is delivered at most once. */
  sendKey: string;
  copied: boolean;
};
const statusText: Record<NotificationStatus, string> = {
  prepared: "Prepared",
  draft_saved: "Draft saved in Gmail",
  sending: "Sending…",
  sent: "Sent",
  failed: "Not sent",
};
const fallbackText: Record<string, string> = {
  AI_SERVICE_UNAVAILABLE:
    "AI wasn't available, so this uses ShiftSync's template.",
  AI_OUTPUT_REJECTED:
    "The AI draft didn't match your schedule exactly, so this uses ShiftSync's template.",
  AI_DISABLED:
    "AI is off in your preferences, so this uses ShiftSync's template.",
};

export function ComposeScreen({ route, navigation }: StackProps<"Compose">) {
  const { data, account, setConflictStatus } = useApp();
  const recovery = useRecovery();
  const conflict = recovery.findConflict(route.params.conflictId);
  const [gmail, setGmail] = useState<GmailState>(
    account ? "checking" : "unavailable",
  );
  const [choice, setChoice] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [preparing, setPreparing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!account) return;
      let active = true;
      api
        .googleStatus()
        .then((status) => {
          if (!active) return;
          setGmail(
            !status.configured
              ? "not_configured"
              : status.gmail && !status.needsReconnect
                ? "ready"
                : "not_connected",
          );
        })
        .catch(() => active && setGmail("unavailable"));
      return () => {
        active = false;
      };
    }, [account]),
  );

  const recipients = useMemo(() => {
    if (!conflict) return [];
    const seen = new Set<string>();
    const list: { contact: Contact; event: ScheduleItem }[] = [];
    for (const event of [conflict.first, conflict.second])
      for (const id of event?.contactIds ?? []) {
        const contact = data.contacts.find((value) => value.id === id);
        if (event && contact && !seen.has(id)) {
          seen.add(id);
          list.push({ contact, event });
        }
      }
    return list;
  }, [conflict, data.contacts]);
  if (!conflict)
    return (
      <Screen>
        <Header title="Contact" back={navigation.goBack} />
        <Empty
          title="This conflict is no longer on your schedule."
          action="Go Back"
          onPress={navigation.goBack}
        />
      </Screen>
    );

  const work = recipients.filter((r) => r.contact.role === "Work");
  const school = recipients.filter((r) => r.contact.role === "School");
  const others = recipients.filter((r) => r.contact.role === "Other");
  const choices: {
    key: string;
    label: string;
    detail?: string;
    ids: string[];
  }[] = [
    ...(work[0]
      ? [
          {
            key: "work",
            label: "Notify work contact",
            detail: `${work[0].contact.name} · ${work[0].contact.email}`,
            ids: [work[0].contact.id],
          },
        ]
      : []),
    ...(school[0]
      ? [
          {
            key: "school",
            label: "Notify school contact",
            detail: `${school[0].contact.name} · ${school[0].contact.email}`,
            ids: [school[0].contact.id],
          },
        ]
      : []),
    ...(work[0] && school[0]
      ? [
          {
            key: "both",
            label: "Notify both contacts",
            detail: "Two separate messages, each reviewed on its own.",
            ids: [work[0].contact.id, school[0].contact.id],
          },
        ]
      : []),
    ...[...work.slice(1), ...school.slice(1), ...others].map((r) => ({
      key: r.contact.id,
      label: `Notify ${r.contact.name}`,
      detail: r.contact.email,
      ids: [r.contact.id],
    })),
    { key: "none", label: "Continue without notification", ids: [] },
  ];
  const status = data.conflictStatus[conflict.id] ?? "unresolved";
  const update = (index: number, patch: Partial<Message>) =>
    setMessages((current) =>
      current.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    );

  const prepare = async () => {
    const selected = choices.find((c) => c.key === choice);
    if (!selected) return;
    if (!selected.ids.length) {
      haptics.tap();
      navigation.goBack();
      return;
    }
    setPreparing(true);
    try {
      const drafts: Message[] = [];
      for (const id of selected.ids) {
        const contact = data.contacts.find((c) => c.id === id)!;
        const draft = await recovery.draft(conflict, contact);
        drafts.push({
          draft,
          subject: draft.subject,
          body: draft.body,
          busy: null,
          sendKey: uuid(),
          copied: false,
        });
      }
      animateLayout();
      setMessages(drafts);
      haptics.success();
    } catch (error) {
      haptics.error();
      dialog.alert(
        "We couldn't prepare the message",
        messageOf(error),
        undefined,
        { tone: "warning" },
      );
    } finally {
      setPreparing(false);
    }
  };
  const check = (message: Message) => {
    if (!message.subject.trim() || !message.body.trim()) {
      dialog.alert("Almost there", "Add a subject and a message first.");
      return false;
    }
    return true;
  };
  const saveDraft = async (index: number) => {
    const message = messages[index];
    if (!check(message)) return;
    update(index, { busy: "save" });
    try {
      const { notification } = await api.saveGmailDraft({
        notificationId: message.draft.id,
        subject: message.subject.trim(),
        body: message.body.trim(),
      });
      update(index, { draft: { ...message.draft, ...notification } });
      haptics.success();
    } catch (error) {
      haptics.error();
      if (error instanceof ApiError && error.code === "GOOGLE_NOT_CONNECTED")
        setGmail("not_connected");
      dialog.alert("Draft not saved", messageOf(error), undefined, {
        tone: "warning",
      });
    } finally {
      update(index, { busy: null });
    }
  };
  const send = (index: number) => {
    const message = messages[index];
    if (!check(message)) return;
    dialog.alert(
      "Send this email?",
      `To: ${message.draft.recipientName} <${message.draft.recipientEmail}>\nSubject: ${message.subject.trim()}\n\nIt will be sent from your connected Gmail account and can't be unsent.`,
      [
        { text: "Keep Editing", style: "cancel" },
        {
          text: "Send Email",
          onPress: async () => {
            update(index, { busy: "send" });
            try {
              const { notification } = await api.sendEmail(
                {
                  notificationId: message.draft.id,
                  subject: message.subject.trim(),
                  body: message.body.trim(),
                  confirmed: true,
                  recipientEmail: message.draft.recipientEmail,
                },
                message.sendKey,
              );
              update(index, { draft: { ...message.draft, ...notification } });
              setConflictStatus(
                conflict.id,
                status === "resolved" ? "resolved" : "user_contacted",
              );
              haptics.success();
            } catch (error) {
              haptics.error();
              const failed =
                (error instanceof ApiError &&
                  (error.details as { notification?: Draft } | undefined)
                    ?.notification) ||
                null;
              if (failed)
                update(index, { draft: { ...message.draft, ...failed } });
              if (
                error instanceof ApiError &&
                error.code === "GOOGLE_NOT_CONNECTED"
              )
                setGmail("not_connected");
              dialog.alert("Not sent", messageOf(error), undefined, {
                tone: "warning",
              });
            } finally {
              update(index, { busy: null });
            }
          },
        },
      ],
    );
  };
  const copy = async (index: number) => {
    const message = messages[index];
    await Clipboard.setStringAsync(
      `To: ${message.draft.recipientName} <${message.draft.recipientEmail}>\nSubject: ${message.subject.trim()}\n\n${message.body.trim()}`,
    );
    haptics.success();
    update(index, { copied: true });
  };

  return (
    <Screen>
      <Header
        title="Contact about this conflict"
        subtitle="You choose who hears from you, and what they read."
        back={navigation.goBack}
      />
      <Card>
        <Badge color={palette.aqua}>{statusLabel[status]}</Badge>
        {[conflict.first, conflict.second]
          .filter((item): item is ScheduleItem => !!item)
          .map((item) => (
            <View key={item.id} style={{ marginTop: 10 }}>
              <Label weight="semibold">{item.title}</Label>
              <Label size={13} tone="muted">
                {`${formatDate(conflict.date, true)} · ${formatTime(item.start)} – ${formatTime(item.end)}`}
              </Label>
            </View>
          ))}
        <Label size={13} style={{ marginTop: 10 }}>
          {conflict.reason}
        </Label>
      </Card>

      {!messages.length && (
        <>
          <Section title="Who should be notified?" />
          {recipients.length === 0 && (
            <Label tone="muted" style={{ marginBottom: 12 }}>
              Neither event has a contact yet. Add your supervisor or professor
              to the event, then come back here.
            </Label>
          )}
          {choices.map((option) => (
            <Choice
              key={option.key}
              label={option.label}
              detail={option.detail}
              selected={choice === option.key}
              onPress={() => setChoice(option.key)}
            />
          ))}
          {recipients.length === 0 && (
            <View style={{ marginBottom: 12 }}>
              <Button
                variant="secondary"
                icon="person-add-outline"
                onPress={() =>
                  navigation.navigate("ItemEditor", { id: conflict.first.id })
                }
              >
                {`Add a contact to ${conflict.first.title}`}
              </Button>
            </View>
          )}
          <Button disabled={!choice || preparing} onPress={prepare}>
            {preparing
              ? "Preparing…"
              : choice === "none"
                ? "Continue"
                : choice === "both"
                  ? "Prepare Two Messages"
                  : "Prepare Message"}
          </Button>
          {preparing && (
            <View style={{ alignItems: "center", marginTop: 12 }}>
              <ActivityIndicator color={palette.teal} />
            </View>
          )}
        </>
      )}

      {messages.map((message, index) => {
        const sent = message.draft.status === "sent";
        const locked = sent || message.busy !== null;
        return (
          <FadeIn key={message.draft.id}>
            <Card>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <Badge
                  color={
                    sent
                      ? palette.aqua
                      : message.draft.status === "failed"
                        ? palette.gold
                        : palette.beige
                  }
                >
                  {statusText[message.draft.status]}
                </Badge>
                <Badge color={palette.beige}>
                  {message.subject !== message.draft.subject ||
                  message.body !== message.draft.body ||
                  message.draft.source === "user"
                    ? "Edited by you"
                    : message.draft.source === "ai"
                      ? "Written with AI"
                      : "Template"}
                </Badge>
              </View>
              <Label weight="semibold" style={{ marginTop: 12 }}>
                {`To: ${message.draft.recipientName}`}
              </Label>
              <Label tone="teal" style={{ marginBottom: 8 }}>
                {message.draft.recipientEmail}
              </Label>
              {message.draft.fallbackReason &&
                fallbackText[message.draft.fallbackReason] && (
                  <Label size={12} tone="muted" style={{ marginBottom: 8 }}>
                    {fallbackText[message.draft.fallbackReason]}
                  </Label>
                )}
              <Field
                label="Subject"
                value={message.subject}
                onChangeText={(subject) =>
                  update(index, { subject: subject.replace(/[\r\n]/g, " ") })
                }
                editable={!locked}
                maxLength={150}
              />
              <Field
                label="Message"
                value={message.body}
                onChangeText={(body) => update(index, { body })}
                editable={!locked}
                multiline
                maxLength={5000}
                style={{ minHeight: 220 }}
              />
              {sent ? (
                <Label size={13}>
                  {`Sent${message.draft.sentAt ? ` ${new Date(message.draft.sentAt).toLocaleString()}` : ""} from your Gmail.`}
                </Label>
              ) : gmail === "ready" ? (
                <View style={{ gap: 8 }}>
                  <Button
                    icon="send-outline"
                    disabled={message.busy !== null}
                    onPress={() => send(index)}
                  >
                    {message.busy === "send" ? "Sending…" : "Send Email"}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={message.busy !== null}
                    onPress={() => saveDraft(index)}
                  >
                    {message.busy === "save"
                      ? "Saving…"
                      : "Save Draft in Gmail"}
                  </Button>
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  <Label size={12} tone="muted">
                    {gmail === "checking"
                      ? "Checking your Gmail connection…"
                      : gmail === "not_connected"
                        ? "Connect Gmail to save drafts or send from the app. You can also copy the message."
                        : gmail === "not_configured"
                          ? "Gmail sending isn't set up on the server yet. Copy the message to send it yourself."
                          : "Copy the message and send it from your own email app."}
                  </Label>
                  {gmail === "not_connected" && (
                    <Button
                      variant="secondary"
                      icon="logo-google"
                      onPress={() => navigation.navigate("ConnectedCalendars")}
                    >
                      Connect Gmail
                    </Button>
                  )}
                </View>
              )}
              {!sent && (
                <View style={{ marginTop: 8 }}>
                  <Button
                    variant="ghost"
                    icon="copy-outline"
                    disabled={message.busy !== null}
                    onPress={() => copy(index)}
                  >
                    {message.copied ? "Copied" : "Copy Message"}
                  </Button>
                  {message.copied &&
                    status !== "user_contacted" &&
                    status !== "resolved" && (
                      <Button
                        variant="ghost"
                        onPress={() => {
                          haptics.success();
                          setConflictStatus(conflict.id, "user_contacted");
                        }}
                      >
                        I sent it myself
                      </Button>
                    )}
                </View>
              )}
            </Card>
          </FadeIn>
        );
      })}

      {messages.length > 0 && (
        <>
          <Label size={12} tone="muted" style={{ marginBottom: 12 }}>
            Sending a message doesn't resolve the conflict. Mark it resolved
            once you've worked it out.
          </Label>
          {status !== "resolved" && (
            <Button
              variant="secondary"
              onPress={() =>
                dialog.alert(
                  "Mark as resolved?",
                  "Use this once the schedule conflict is sorted out.",
                  [
                    { text: "Not Yet", style: "cancel" },
                    {
                      text: "Mark as Resolved",
                      onPress: () => {
                        haptics.success();
                        setConflictStatus(conflict.id, "resolved");
                        navigation.goBack();
                      },
                    },
                  ],
                  { tone: "success" },
                )
              }
            >
              Mark Conflict as Resolved
            </Button>
          )}
        </>
      )}
    </Screen>
  );
}
