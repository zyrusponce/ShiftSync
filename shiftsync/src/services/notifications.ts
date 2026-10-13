// Device notifications through expo-notifications. Reminders are scheduled
// with the OS, so they arrive while ShiftSync is in the background, closed,
// or after a restart (Android re-arms them on boot). Conflict, shift and sync
// alerts are presented the moment the app learns about them.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { Linking, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import type { NotificationTarget, PlannedReminder } from "../domain/notify";

/** Per-phone choices; they describe this device's alerts, not the account. */
export type NotificationSettings = {
  sound: boolean;
  vibration: boolean;
  /** Minutes before, applied to every reminder that is on; null keeps each event's own. */
  reminderLead: number | null;
  syncAlerts: boolean;
};
const SETTINGS_KEY = "@shiftsync/notification-settings/v1";
const ASKED_KEY = "@shiftsync/notification-asked/v1";
const defaults: NotificationSettings = {
  sound: true,
  vibration: true,
  reminderLead: null,
  syncAlerts: true,
};
let settings = defaults;
const listeners = new Set<(next: NotificationSettings) => void>();
export const settingsReady = AsyncStorage.getItem(SETTINGS_KEY)
  .then((raw) => {
    if (raw) settings = { ...defaults, ...JSON.parse(raw) };
  })
  .catch(() => undefined)
  .then(() => listeners.forEach((listener) => listener(settings)));
export const notificationSettings = () => settings;
export function setNotificationSettings(patch: Partial<NotificationSettings>) {
  settings = { ...settings, ...patch };
  listeners.forEach((listener) => listener(settings));
  void AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)).catch(
    () => undefined,
  );
}
export function useNotificationSettings() {
  const [value, setValue] = useState(settings);
  useEffect(() => {
    listeners.add(setValue);
    setValue(settings);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}

// One Android channel per sound/vibration combination. Channel sound and
// vibration can't change after creation, so the in-app switches pick a
// channel instead. Users can still adjust each channel in system settings,
// and Do Not Disturb and silent mode always apply.
const CHANNELS = {
  alerts: { name: "Schedule alerts", sound: true, vibrate: true },
  "alerts-sound": {
    name: "Schedule alerts (no vibration)",
    sound: true,
    vibrate: false,
  },
  "alerts-vibrate": {
    name: "Schedule alerts (vibrate only)",
    sound: false,
    vibrate: true,
  },
  "alerts-silent": {
    name: "Schedule alerts (silent)",
    sound: false,
    vibrate: false,
  },
} as const;
type ChannelId = keyof typeof CHANNELS;
const channelFor = ({ sound, vibration }: NotificationSettings): ChannelId =>
  sound
    ? vibration
      ? "alerts"
      : "alerts-sound"
    : vibration
      ? "alerts-vibrate"
      : "alerts-silent";

const supported = Platform.OS === "android" || Platform.OS === "ios";
let setup: Promise<void> | null = null;
/** Registers channels and how alerts behave while ShiftSync is open. */
export function setupNotifications(): Promise<void> {
  if (!supported) return Promise.resolve();
  setup ??= (async () => {
    // In the foreground the alert still appears as a banner, so it behaves
    // like it does with the app closed; the sound follows the user's choice.
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: settings.sound,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS !== "android") return;
    await Promise.all(
      (Object.keys(CHANNELS) as ChannelId[]).map((id) => {
        const channel = CHANNELS[id];
        return Notifications.setNotificationChannelAsync(id, {
          name: channel.name,
          description:
            "Schedule conflicts, shift changes, reminders and calendar sync problems.",
          importance: channel.sound
            ? Notifications.AndroidImportance.HIGH
            : Notifications.AndroidImportance.DEFAULT,
          sound: channel.sound ? "default" : null,
          enableVibrate: channel.vibrate,
          vibrationPattern: channel.vibrate ? [0, 180, 120, 180] : null,
          // Hides details on a secure lock screen when the phone is set to.
          lockscreenVisibility:
            Notifications.AndroidNotificationVisibility.PRIVATE,
          lightColor: "#58A6AE",
          showBadge: true,
        });
      }),
    );
  })().catch(() => {
    setup = null;
  });
  return setup;
}

export type PermissionState = {
  status: "granted" | "denied" | "undetermined" | "unsupported";
  /** False once the OS stops showing the prompt; only Settings can enable it. */
  canAskAgain: boolean;
};
export async function permissionState(): Promise<PermissionState> {
  if (!supported) return { status: "unsupported", canAskAgain: false };
  try {
    const result = await Notifications.getPermissionsAsync();
    const granted =
      result.granted ||
      result.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    return {
      status: granted
        ? "granted"
        : result.status === "denied"
          ? "denied"
          : "undetermined",
      canAskAgain: result.canAskAgain,
    };
  } catch {
    return { status: "unsupported", canAskAgain: false };
  }
}
export async function requestPermission(): Promise<PermissionState> {
  if (!supported) return { status: "unsupported", canAskAgain: false };
  await markAsked();
  await setupNotifications();
  try {
    await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
  } catch {
    // Reported through permissionState below.
  }
  return permissionState();
}
/** Remembers that the explanation was shown, without the system prompt. */
export const markAsked = () =>
  AsyncStorage.setItem(ASKED_KEY, "1").catch(() => undefined);
/** Whether the app already explained notifications and asked once. */
export const alreadyAsked = () =>
  AsyncStorage.getItem(ASKED_KEY)
    .then((value) => value === "1")
    .catch(() => true);
export const openSystemSettings = () => Linking.openSettings();

const content = (
  title: string,
  body: string,
  target: NotificationTarget,
): Notifications.NotificationContentInput => ({
  title,
  body,
  data: { target },
  sound: settings.sound ? "default" : undefined,
  color: "#58A6AE",
});

/**
 * Shows an alert now. Resolves to the notification id once the OS accepted
 * it, or null when it wasn't sent (no permission, unsupported platform).
 */
export async function presentNow(
  title: string,
  body: string,
  target: NotificationTarget,
): Promise<string | null> {
  if ((await permissionState()).status !== "granted") return null;
  await setupNotifications();
  try {
    return await Notifications.scheduleNotificationAsync({
      content: content(title, body, target),
      trigger:
        Platform.OS === "android" ? { channelId: channelFor(settings) } : null,
    });
  } catch {
    return null;
  }
}

const REMINDER_PREFIX = "reminder:";
let reminderSync: Promise<number> = Promise.resolve(0);
/**
 * Makes the phone's scheduled reminders match `plans`: unchanged ones stay,
 * stale ones are cancelled, new ones are scheduled. Runs one at a time and
 * resolves to how many reminders the OS reports as scheduled afterwards.
 */
export function syncReminders(plans: PlannedReminder[]): Promise<number> {
  reminderSync = reminderSync
    .catch(() => 0)
    .then(async () => {
      if ((await permissionState()).status !== "granted") return 0;
      await setupNotifications();
      // The channel and sound are part of each id, so changing the sound or
      // vibration switches also reschedules existing reminders.
      const style = channelFor(settings);
      const wanted = new Map(
        plans.map((plan) => [`${plan.id}:${style}`, plan]),
      );
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const existing = new Set<string>();
      for (const request of scheduled) {
        if (!request.identifier.startsWith(REMINDER_PREFIX)) continue;
        if (wanted.has(request.identifier)) existing.add(request.identifier);
        else
          await Notifications.cancelScheduledNotificationAsync(
            request.identifier,
          ).catch(() => undefined);
      }
      for (const [identifier, plan] of wanted) {
        if (existing.has(identifier) || plan.fireAt.getTime() <= Date.now())
          continue;
        await Notifications.scheduleNotificationAsync({
          identifier,
          content: content(plan.title, plan.body, plan.target),
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: plan.fireAt,
            ...(Platform.OS === "android" ? { channelId: style } : {}),
          },
        }).catch(() => undefined);
      }
      return (await Notifications.getAllScheduledNotificationsAsync()).filter(
        (request) => request.identifier.startsWith(REMINDER_PREFIX),
      ).length;
    });
  return reminderSync;
}
/** How many reminders the OS currently holds for ShiftSync. */
export async function scheduledReminderCount(): Promise<number> {
  if (!supported) return 0;
  try {
    return (await Notifications.getAllScheduledNotificationsAsync()).filter(
      (request) => request.identifier.startsWith(REMINDER_PREFIX),
    ).length;
  } catch {
    return 0;
  }
}

// What each account has already been told, so an unchanged conflict or a
// repeated sync failure never produces a second alert, even after restarts.
const announcedKey = (scope: string) => `@shiftsync/announced/${scope}/v1`;
const syncProblemKey = (scope: string) => `@shiftsync/sync-problem/${scope}/v1`;
/** Conflict ids already announced; null before the first check on this phone. */
export async function loadAnnouncedConflicts(
  scope: string,
): Promise<string[] | null> {
  try {
    const raw = await AsyncStorage.getItem(announcedKey(scope));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
export function saveAnnouncedConflicts(scope: string, ids: string[]) {
  void AsyncStorage.setItem(announcedKey(scope), JSON.stringify(ids)).catch(
    () => undefined,
  );
}
/**
 * Alerts about a calendar sync problem once; the same problem stays quiet
 * until a sync succeeds (see clearSyncProblem). Resolves to the alert id, or
 * null when nothing was sent.
 */
export async function announceSyncProblem(
  scope: string,
  title: string,
  body: string,
): Promise<string | null> {
  if (!settings.syncAlerts) return null;
  const key = syncProblemKey(scope);
  const signature = `${title}|${body}`;
  const last = await AsyncStorage.getItem(key).catch(() => null);
  if (last === signature) return null;
  const id = await presentNow(title, body, { kind: "sync" });
  if (id) await AsyncStorage.setItem(key, signature).catch(() => undefined);
  return id;
}
export const clearSyncProblem = (scope: string) =>
  AsyncStorage.removeItem(syncProblemKey(scope)).catch(() => undefined);

/** The target carried by a tapped notification, if it is one of ours. */
export function targetOf(
  response: Notifications.NotificationResponse,
): NotificationTarget | null {
  const target = response.notification.request.content.data?.target as
    NotificationTarget | undefined;
  return target && typeof target === "object" && "kind" in target
    ? target
    : null;
}
