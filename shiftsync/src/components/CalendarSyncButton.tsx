// "Sync Now" for the Calendar header: imports Google Calendar through the
// server's real sync, and walks the student through connecting Google first
// when needed. The schedule refreshes in place, so the selected date, view
// and scroll position stay where they were.
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Text, View } from "react-native";
import { dialog } from "./dialog";
import { Icon, Label } from "./ui";
import { FadeIn, PressableScale, haptics } from "./motion";
import { useApp, type CalendarSyncOutcome } from "../store/AppStore";
import { ApiError, messageOf } from "../services/api";
import { accountsEnabled } from "../services/config";
import { connectGoogle } from "../services/googleSignIn";
import type { CalendarSyncResponse } from "../domain/contract";
import { fonts, palette, useTheme } from "../theme";

type State = "ready" | "syncing" | "success";
type Note = { tone: "ok" | "problem"; text: string } | null;

function summary(result: CalendarSyncResponse) {
  const parts = [
    result.imported && `${result.imported} new`,
    result.updated && `${result.updated} updated`,
    result.needsReview.length && `${result.needsReview.length} to review`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "already up to date";
}

export function useCalendarSync() {
  const { syncGoogleCalendar } = useApp();
  const [state, setState] = useState<State>("ready");
  const [note, setNote] = useState<Note>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const finish = (next: Note, success = false) => {
    if (!mounted.current) return;
    setNote(next);
    setState(success ? "success" : "ready");
    if (next) AccessibilityInfo.announceForAccessibility(next.text);
    if (success)
      timer.current = setTimeout(() => {
        if (mounted.current) setState("ready");
      }, 2400);
  };

  const connectThenSync = async (reconnect: boolean) => {
    try {
      const status = await connectGoogle();
      if (!status) return finish(null);
      if (!status.calendar) {
        haptics.warning();
        dialog.alert(
          "Calendar access is off",
          "Google connected, but ShiftSync wasn't allowed to read your calendar. Connect again and allow Google Calendar access.",
          undefined,
          { tone: "warning" },
        );
        return finish(null);
      }
      await run();
    } catch (failure) {
      haptics.error();
      finish({
        tone: "problem",
        text: reconnect
          ? "Google wasn't reconnected."
          : "Google wasn't connected.",
      });
      dialog.alert("Google wasn't connected", messageOf(failure), undefined, {
        tone: "warning",
      });
    }
  };

  const explain = (
    outcome: Exclude<CalendarSyncOutcome, { status: "synced" }>,
  ) => {
    haptics.warning();
    if (outcome.status === "no_account")
      dialog.alert(
        "Log in to sync Google Calendar",
        accountsEnabled
          ? "The demo keeps your schedule on this phone only. Log in to a ShiftSync account to connect and sync Google Calendar."
          : "This version of ShiftSync isn't connected to a server, so Google Calendar sync isn't available.",
      );
    else if (outcome.status === "not_configured")
      dialog.alert(
        "Google Calendar isn't available yet",
        "This ShiftSync server isn't set up for Google Calendar. Your ShiftSync schedule still works as usual.",
      );
    else
      dialog.alert(
        outcome.status === "reconnect"
          ? "Reconnect Google Calendar"
          : "Connect Google Calendar",
        outcome.status === "reconnect"
          ? "Google access to your calendar expired or was removed. Reconnect your Google account to keep syncing. Nothing in ShiftSync was changed."
          : "Connect your Google account to bring your Google Calendar events into ShiftSync. You'll choose what to allow on Google's permission screen.",
        [
          { text: "Not Now", style: "cancel" },
          {
            text:
              outcome.status === "reconnect" ? "Reconnect" : "Connect Google",
            onPress: () => void startConnect(outcome.status === "reconnect"),
          },
        ],
      );
    finish(
      outcome.status === "reconnect"
        ? { tone: "problem", text: "Google needs to be reconnected." }
        : null,
    );
  };

  async function run() {
    setState("syncing");
    setNote(null);
    try {
      const outcome = await syncGoogleCalendar();
      if (outcome.status !== "synced") return explain(outcome);
      haptics.success();
      finish(
        {
          tone: "ok",
          text: `Google Calendar synced at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${summary(outcome.result)}`,
        },
        true,
      );
    } catch (failure) {
      haptics.error();
      const offline = failure instanceof ApiError && failure.transient;
      finish({
        tone: "problem",
        text: offline ? "Sync failed: you're offline." : "Sync didn't finish.",
      });
      dialog.alert(
        offline ? "You're offline" : "Sync didn't finish",
        offline
          ? "We couldn't reach ShiftSync, so your Google Calendar wasn't synced. Check your connection and try again."
          : `${messageOf(failure)} You can try again, or reconnect your Google account if this keeps happening.`,
        [
          ...(offline
            ? [{ text: "Not Now", style: "cancel" as const }]
            : [
                {
                  text: "Reconnect Google",
                  onPress: () => void startConnect(true),
                },
              ]),
          { text: "Try Again", onPress: () => void press() },
        ],
        { tone: "warning" },
      );
    }
  }
  const startConnect = async (reconnect: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setState("syncing");
    try {
      await connectThenSync(reconnect);
    } finally {
      busy.current = false;
    }
  };
  const press = async () => {
    // Ignore taps while a sync (or the Google sign-in it needs) is running.
    if (busy.current) return;
    busy.current = true;
    if (timer.current) clearTimeout(timer.current);
    haptics.tap();
    try {
      await run();
    } finally {
      busy.current = false;
    }
  };
  return { state, note, press };
}

export function CalendarSyncButton({
  state,
  onPress,
}: {
  state: State;
  onPress: () => void;
}) {
  const label =
    state === "syncing"
      ? "Syncing…"
      : state === "success"
        ? "Synced"
        : "Sync Now";
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={
        state === "ready"
          ? "Sync Google Calendar now"
          : `Google Calendar ${label}`
      }
      accessibilityState={{
        busy: state === "syncing",
        disabled: state === "syncing",
      }}
      disabled={state === "syncing"}
      onPress={onPress}
      scaleTo={0.95}
      pressedOpacity={0.88}
      hitSlop={4}
      style={{
        height: 40,
        minWidth: 112,
        paddingHorizontal: 12,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        // Beige and navy read the same in light and dark mode.
        backgroundColor: palette.beige,
        opacity: state === "syncing" ? 0.85 : 1,
      }}
    >
      <View style={{ width: 18, alignItems: "center" }}>
        {state === "syncing" ? (
          <ActivityIndicator size="small" color={palette.navy} />
        ) : (
          <Icon
            name={state === "success" ? "checkmark-circle" : "sync"}
            size={18}
            color={palette.navy}
          />
        )}
      </View>
      <Text
        style={{
          fontFamily: fonts.semibold,
          fontSize: 13,
          color: palette.navy,
        }}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

/** The one-line result under the header, until the next sync. */
export function CalendarSyncNote({ note }: { note: Note }) {
  const theme = useTheme();
  if (!note) return null;
  return (
    <FadeIn key={note.text}>
      <View
        accessibilityLiveRegion="polite"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          marginTop: -12,
          marginBottom: 16,
        }}
      >
        <Icon
          name={
            note.tone === "ok"
              ? "checkmark-circle-outline"
              : "alert-circle-outline"
          }
          size={15}
          color={note.tone === "ok" ? theme.accentText : theme.warning}
        />
        <Label
          size={12}
          tone="muted"
          style={{
            flex: 1,
            color: note.tone === "ok" ? theme.muted : theme.warning,
          }}
        >
          {note.text}
        </Label>
      </View>
    </FadeIn>
  );
}
