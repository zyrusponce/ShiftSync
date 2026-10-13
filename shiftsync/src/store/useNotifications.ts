// Keeps the phone's notifications in step with the schedule: reminders are
// rescheduled when anything changes, new overlaps are announced once, and
// tapping a notification opens the screen it is about, whether ShiftSync was
// open, in the background or closed.
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import { dialog } from "../components/dialog";
import {
  conflictNotice,
  conflictsToAnnounce,
  planReminders,
  type NotificationTarget,
} from "../domain/notify";
import { dateKey, openConflicts } from "../domain/schedule";
import type { AppData } from "../domain/types";
import { navigationRef } from "../navigation/AppNavigator";
import {
  alreadyAsked,
  loadAnnouncedConflicts,
  markAsked,
  notificationSettings,
  permissionState,
  presentNow,
  requestPermission,
  saveAnnouncedConflicts,
  settingsReady,
  setupNotifications,
  syncReminders,
  targetOf,
  useNotificationSettings,
} from "../services/notifications";
import { useApp } from "./AppStore";

/** Opens the screen a notification is about; false if the app isn't ready. */
function openTarget(
  target: NotificationTarget,
  data: AppData,
  signedIn: boolean,
): boolean {
  if (!navigationRef.isReady()) return false;
  if (!navigationRef.getRootState()?.routeNames.includes("Main")) return false;
  const exists = (id: string | null) =>
    !!id && data.items.some((item) => item.id === id);
  switch (target.kind) {
    case "conflict": {
      const active =
        target.conflictId &&
        openConflicts(data, dateKey()).some(
          (conflict) => conflict.id === target.conflictId,
        );
      // A conflict resolved since the alert leaves the list to check instead.
      if (active)
        navigationRef.navigate("Resolve", { conflictId: target.conflictId! });
      else navigationRef.navigate("Main", { screen: "Conflicts" });
      return true;
    }
    case "shift":
      if (exists(target.itemId))
        navigationRef.navigate("ItemDetails", {
          id: target.itemId!,
          occurrenceDate: target.date ?? undefined,
        });
      else navigationRef.navigate("Main", { screen: "Shifts" });
      return true;
    case "reminder":
      if (exists(target.itemId))
        navigationRef.navigate("ItemDetails", {
          id: target.itemId,
          occurrenceDate: target.date,
        });
      else
        navigationRef.navigate("Main", {
          screen: "Calendar",
          params: { date: target.date },
        });
      return true;
    case "sync":
      if (signedIn) navigationRef.navigate("ConnectedCalendars");
      else navigationRef.navigate("Main", { screen: "Calendar" });
      return true;
  }
}

export function useNotifications() {
  const { data, account, loading } = useApp();
  const settings = useNotificationSettings();
  const dataRef = useRef(data);
  dataRef.current = data;
  const signedInRef = useRef(!!account);
  signedInRef.current = !!account;
  const ready = !!data.profile && data.onboarded;
  const scope = account?.id ?? "local";

  useEffect(() => {
    void setupNotifications();
  }, []);

  // Reminders: rebuilt shortly after the schedule, the notification
  // preferences or the per-phone settings change, and whenever the app comes
  // back (so the 7-day window keeps rolling and permission changes apply).
  const [remindersTick, bumpReminders] = useTick();
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => {
      void settingsReady.then(() =>
        syncReminders(
          ready
            ? planReminders(data.items, data.preferences, new Date(), {
                leadOverride: notificationSettings().reminderLead,
              })
            : [],
        ),
      );
    }, 800);
    return () => clearTimeout(timer);
  }, [
    loading,
    ready,
    data.items,
    data.preferences.reminders,
    data.preferences.shiftNotifications,
    settings,
    remindersTick,
  ]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") bumpReminders();
    });
    return () => subscription.remove();
  }, [bumpReminders]);

  // Conflicts: announce each new overlap once. The first check on a phone
  // only records what already exists, so installing or signing in doesn't
  // replay old conflicts; the Conflicts tab badge already shows them.
  const announced = useRef<{ scope: string; ids: string[] | null } | null>(
    null,
  );
  useEffect(() => {
    if (loading || !ready) return;
    // Wait for the schedule to settle (server refreshes, quick edits).
    const timer = setTimeout(async () => {
      if (announced.current?.scope !== scope)
        announced.current = { scope, ids: await loadAnnouncedConflicts(scope) };
      const current = dataRef.current;
      const active = openConflicts(current, dateKey());
      const { fresh, announced: next } = conflictsToAnnounce(
        active,
        announced.current.ids ?? [],
      );
      const firstCheck = announced.current.ids === null;
      announced.current = { scope, ids: next };
      saveAnnouncedConflicts(scope, next);
      if (firstCheck || !fresh.length || !current.preferences.conflictAlerts)
        return;
      const notice = conflictNotice(fresh);
      await presentNow(notice.title, notice.body, notice.target);
    }, 1500);
    return () => clearTimeout(timer);
  }, [
    loading,
    ready,
    scope,
    data.items,
    data.availability,
    data.preferences,
    data.ignoredConflicts,
    data.conflictStatus,
  ]);

  // Ask once, with a reason, after the student reaches their schedule.
  useEffect(() => {
    if (loading || !ready) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const [asked, permission] = await Promise.all([
        alreadyAsked(),
        permissionState(),
      ]);
      if (cancelled || asked || permission.status !== "undetermined") return;
      dialog.alert(
        "Stay ahead of your schedule",
        "ShiftSync can alert you when a shift overlaps a class, remind you before commitments, and let you know if calendar sync needs attention. You can change this anytime in Settings.",
        [
          {
            text: "Not Now",
            style: "cancel",
            // Remembered, so the explanation isn't repeated on every launch.
            onPress: () => void markAsked(),
          },
          {
            text: "Turn On",
            onPress: async () => {
              const result = await requestPermission();
              if (result.status === "granted") bumpReminders();
            },
          },
        ],
        { icon: "notifications-outline" },
      );
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loading, ready, bumpReminders]);

  // Taps: from a running app through the listener, and from a cold start
  // through the last response. Each tap is handled once.
  const handled = useRef(new Set<string>());
  const pending = useRef<NotificationTarget | null>(null);
  const retry = useRef<ReturnType<typeof setInterval> | null>(null);
  const flushPending = useRef(() => {});
  flushPending.current = () => {
    const target = pending.current;
    if (!target) return;
    if (openTarget(target, dataRef.current, signedInRef.current)) {
      pending.current = null;
      if (retry.current) clearInterval(retry.current);
      retry.current = null;
    }
  };
  useEffect(() => {
    const receive = (response: Notifications.NotificationResponse | null) => {
      if (
        !response ||
        response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER
      )
        return;
      const key = `${response.notification.request.identifier}@${response.notification.date}`;
      if (handled.current.has(key)) return;
      handled.current.add(key);
      void Notifications.clearLastNotificationResponseAsync().catch(
        () => undefined,
      );
      const target = targetOf(response);
      if (!target) return;
      pending.current = target;
      flushPending.current();
      // Still loading or signing in: keep trying briefly, then give up.
      if (pending.current && !retry.current) {
        const started = Date.now();
        retry.current = setInterval(() => {
          flushPending.current();
          if (pending.current && Date.now() - started > 20_000) {
            pending.current = null;
            if (retry.current) clearInterval(retry.current);
            retry.current = null;
          }
        }, 300);
      }
    };
    void Notifications.getLastNotificationResponseAsync()
      .then(receive)
      .catch(() => undefined);
    const subscription =
      Notifications.addNotificationResponseReceivedListener(receive);
    return () => {
      subscription.remove();
      if (retry.current) clearInterval(retry.current);
      retry.current = null;
    };
  }, []);
}

/** A counter to re-run effects on demand. */
function useTick(): [number, () => void] {
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((value) => value + 1), []);
  return [tick, bump];
}
