import React, { useCallback, useEffect, useState } from "react";
import { AppState, Platform, Switch } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { dialog } from "../components/dialog";
import {
  Button,
  Card,
  Choice,
  Header,
  Label,
  Row,
  Screen,
  Section,
  Sheet,
} from "../components/ui";
import { useApp } from "../store/AppStore";
import type { Preferences } from "../domain/types";
import { TRAVEL_OPTIONS } from "../domain/persistence";
import { REMINDER_LEADS, reminderLead } from "../domain/notify";
import {
  openSystemSettings,
  permissionState,
  requestPermission,
  scheduledReminderCount,
  setNotificationSettings,
  useNotificationSettings,
  type PermissionState,
} from "../services/notifications";
import type { StackProps } from "../navigation/types";
import { palette } from "../theme";

type SettingKey =
  | "defaultView"
  | "weekStarts"
  | "defaultDuration"
  | "bufferMinutes"
  | "appearance"
  | "aiFrequency"
  | "travelMinutes"
  | "planningHorizonDays";
export function SettingsScreen({ route, navigation }: StackProps<"Settings">) {
  const { data, setPreferences, account } = useApp();
  const [picker, setPicker] = useState<SettingKey | null>(null);
  const preferences = data.preferences;
  const section = route.params?.section;
  const show = (title: string) => !section || section === title;
  const toggle = (key: keyof Preferences, title: string, detail?: string) => (
    <Row
      icon={key === "aiEnabled" ? "sparkles-outline" : "notifications-outline"}
      title={title}
      detail={detail}
      trailing={
        <Switch
          accessibilityLabel={title}
          value={!!preferences[key]}
          onValueChange={(value) => setPreferences({ [key]: value })}
          trackColor={{ false: palette.beige, true: palette.teal }}
          thumbColor="#FFFDF8"
        />
      }
    />
  );
  const choices: Record<
    SettingKey,
    { label: string; value: string | number }[]
  > = {
    defaultView: ["Month", "Week", "Day"].map((value) => ({
      label: value,
      value,
    })),
    weekStarts: ["Monday", "Sunday"].map((value) => ({ label: value, value })),
    defaultDuration: [30, 60, 90, 120].map((value) => ({
      label: `${value} minutes`,
      value,
    })),
    bufferMinutes: [0, 5, 15, 30, 60].map((value) => ({
      label: value ? `${value} minutes` : "No extra buffer",
      value,
    })),
    appearance: ["Light", "Dark", "System"].map((value) => ({
      label: value,
      value,
    })),
    aiFrequency: ["Daily", "Weekly", "Off"].map((value) => ({
      label: value,
      value,
    })),
    travelMinutes: TRAVEL_OPTIONS.map((value) => ({
      label: value ? `${value} minutes` : "No travel time",
      value,
    })),
    planningHorizonDays: [3, 5, 7, 10, 14].map((value) => ({
      label: `${value} days`,
      value,
    })),
  };
  const labels: Record<SettingKey, string> = {
    defaultView: "Default calendar view",
    weekStarts: "Week starts on",
    defaultDuration: "Default event duration",
    bufferMinutes: "Buffer time",
    appearance: "Appearance",
    aiFrequency: "Suggestion frequency",
    travelMinutes: "Travel time between places",
    planningHorizonDays: "Planning window",
  };
  return (
    <Screen>
      <Header
        title={section ?? "Settings"}
        subtitle="Set a rhythm that works for you."
        back={navigation.goBack}
      />
      {show("Account") && (
        <>
          <Section title="Account" />
          <Card>
            <Row
              icon="person-outline"
              title="Personal information"
              onPress={() => navigation.navigate("PersonalInfo")}
            />
            <Row
              icon="key-outline"
              title="Password"
              onPress={() =>
                dialog.alert(
                  account ? "Password" : "Local demo",
                  account
                    ? "Changing your password isn't available in the app yet. Ask the ShiftSync team for a reset link."
                    : "Passwords are not stored or authenticated in this demo. Password management needs a configured authentication service.",
                )
              }
            />
            <Row
              icon="shield-checkmark-outline"
              title="Security"
              onPress={() =>
                navigation.navigate("Settings", { section: "Security" })
              }
            />
          </Card>
        </>
      )}
      {show("Calendar") && (
        <>
          <Section title="Calendar" />
          <Card>
            <Row
              icon="calendar-outline"
              title="Default calendar view"
              detail={preferences.defaultView}
              onPress={() => setPicker("defaultView")}
            />
            <Row
              icon="today-outline"
              title="Week starts on"
              detail={preferences.weekStarts}
              onPress={() => setPicker("weekStarts")}
            />
            <Row
              icon="time-outline"
              title="Default event duration"
              detail={`${preferences.defaultDuration} minutes`}
              onPress={() => setPicker("defaultDuration")}
            />
            <Row
              icon="globe-outline"
              title="Time zone"
              detail={preferences.timeZone}
              onPress={() =>
                dialog.alert(
                  "Device time zone",
                  "ShiftSync follows the time zone on your phone. Change the device time zone in system settings to use a different region. Event times are saved as local calendar times.",
                )
              }
            />
            <Row
              icon="hourglass-outline"
              title="Buffer time"
              detail={`${preferences.bufferMinutes} minutes`}
              onPress={() => setPicker("bufferMinutes")}
            />
            <Row
              icon="walk-outline"
              title="Travel time between places"
              detail={
                preferences.travelMinutes
                  ? `${preferences.travelMinutes} minutes when locations differ`
                  : "Not added"
              }
              onPress={() => setPicker("travelMinutes")}
            />
            <Row
              icon="telescope-outline"
              title="Planning window"
              detail={`Shift changes and new times look ${preferences.planningHorizonDays} days ahead`}
              onPress={() => setPicker("planningHorizonDays")}
            />
          </Card>
        </>
      )}
      {show("Notifications") && (
        <>
          <Section title="Notifications" />
          <NotificationPermissionCard />
          <Card>
            {toggle(
              "conflictAlerts",
              "Conflict alerts",
              "When commitments overlap",
            )}
            {toggle(
              "shiftNotifications",
              "Shift notifications",
              "Shift changes and upcoming shifts",
            )}
            {toggle(
              "reminders",
              "Event reminders",
              "Before classes, events and task deadlines",
            )}
            <LocalToggle
              setting="syncAlerts"
              icon="sync-outline"
              title="Calendar sync problems"
              detail="When Google Calendar needs attention"
            />
          </Card>
          <NotificationDeliveryCard />
          <Label tone="muted" size={12}>
            The red badge on Conflicts and the Conflicts list always stay on,
            even when alerts are off. Silent mode, Do Not Disturb and your
            phone's notification settings always apply.
          </Label>
        </>
      )}
      {show("AI Preferences") && (
        <>
          <Section title="AI Preferences" />
          <Card>
            {toggle("aiEnabled", "Enable CalenBud")}
            {toggle("suggestions", "Scheduling suggestions")}
            {toggle("conflictSuggestions", "Conflict resolution suggestions")}
            <Row
              icon="time-outline"
              title="Suggestion frequency"
              detail={preferences.aiFrequency}
              onPress={() => setPicker("aiFrequency")}
            />
          </Card>
          <Label tone="muted" size={12}>
            CalenBud uses your saved schedule and availability. It only changes
            events after you choose and confirm an option.
          </Label>
        </>
      )}
      {show("Appearance") && (
        <>
          <Section title="Appearance" />
          {choices.appearance.map((option) => (
            <Choice
              key={option.label}
              label={option.label}
              selected={preferences.appearance === option.value}
              onPress={() =>
                setPreferences({
                  appearance: option.value as Preferences["appearance"],
                })
              }
            />
          ))}
        </>
      )}
      {show("Security") && (
        <>
          <Section title="Security" />
          {account ? (
            <Card>
              <Label weight="semibold">Your account</Label>
              <Label style={{ marginTop: 12 }}>
                {`Signed in as ${account.email}. Your session is kept in this phone's secure keystore, and your password is never stored on the device.`}
              </Label>
              <Label style={{ marginTop: 12 }}>
                Only you can read or change your schedule. Google access tokens
                are encrypted on the server, and AI keys never leave it.
              </Label>
            </Card>
          ) : (
            <Card>
              <Label weight="semibold">Your local demo</Label>
              <Label style={{ marginTop: 12 }}>
                There is no authenticated online account in this demo. Passwords
                are never saved. Profile and scheduling data are stored in this
                app’s local storage, without a cloud backup.
              </Label>
              <Label style={{ marginTop: 12 }}>
                Use example information when trying the demo. Log in to a
                ShiftSync account to keep your schedule backed up and synced.
              </Label>
            </Card>
          )}
        </>
      )}
      <Sheet
        visible={picker !== null}
        title={picker ? labels[picker] : "Choose preference"}
        onClose={() => setPicker(null)}
      >
        {picker &&
          choices[picker].map((option) => (
            <Choice
              key={option.label}
              label={option.label}
              selected={preferences[picker] === option.value}
              onPress={() => {
                setPreferences({ [picker]: option.value });
                setPicker(null);
              }}
            />
          ))}
      </Sheet>
    </Screen>
  );
}

// Notification switches that belong to this phone rather than the account.
function LocalToggle({
  setting,
  icon,
  title,
  detail,
}: {
  setting: "sound" | "vibration" | "syncAlerts";
  icon: React.ComponentProps<typeof Row>["icon"];
  title: string;
  detail?: string;
}) {
  const settings = useNotificationSettings();
  return (
    <Row
      icon={icon}
      title={title}
      detail={detail}
      trailing={
        <Switch
          accessibilityLabel={title}
          value={settings[setting]}
          onValueChange={(value) =>
            setNotificationSettings({ [setting]: value })
          }
          trackColor={{ false: palette.beige, true: palette.teal }}
          thumbColor="#FFFDF8"
        />
      }
    />
  );
}

/** Re-checks permission when the screen is shown or the app returns. */
function usePermission() {
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const check = useCallback(() => {
    void permissionState().then(setPermission);
  }, []);
  useFocusEffect(check);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => subscription.remove();
  }, [check]);
  return [permission, setPermission] as const;
}

function NotificationPermissionCard() {
  const [permission, setPermission] = usePermission();
  if (!permission || permission.status === "granted") return null;
  const blocked = permission.status === "denied" && !permission.canAskAgain;
  return (
    <Card>
      <Label weight="semibold">
        {permission.status === "unsupported"
          ? "Notifications aren't available here"
          : "Notifications are off"}
      </Label>
      <Label tone="muted" size={13} style={{ marginTop: 8, marginBottom: 12 }}>
        {permission.status === "unsupported"
          ? "Phone notifications work in the Android and iOS app."
          : blocked
            ? "ShiftSync can't alert you about conflicts, shift changes or reminders until you allow notifications in your phone's settings."
            : "Allow notifications so ShiftSync can alert you about overlapping commitments, shift changes, upcoming events and calendar sync problems."}
      </Label>
      {permission.status !== "unsupported" && (
        <Button
          small
          icon="notifications-outline"
          onPress={async () => {
            if (blocked) void openSystemSettings();
            else setPermission(await requestPermission());
          }}
        >
          {blocked ? "Open Phone Settings" : "Allow Notifications"}
        </Button>
      )}
    </Card>
  );
}

function NotificationDeliveryCard() {
  const settings = useNotificationSettings();
  const [permission] = usePermission();
  const [timingOpen, setTimingOpen] = useState(false);
  const [scheduled, setScheduled] = useState<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      // Read back from the OS once the latest reschedule has had a moment.
      const timer = setTimeout(
        () => void scheduledReminderCount().then(setScheduled),
        1200,
      );
      return () => clearTimeout(timer);
    }, [settings]),
  );
  const timing =
    settings.reminderLead === null
      ? "As set on each event"
      : (REMINDER_LEADS.find(
          (lead) => reminderLead(lead) === settings.reminderLead,
        ) ?? `${settings.reminderLead} minutes before`);
  return (
    <>
      <Card>
        <LocalToggle
          setting="sound"
          icon="volume-medium-outline"
          title="Sound"
          detail="Plays your phone's notification sound"
        />
        {/* iOS vibration follows the phone's own sound and haptics settings. */}
        {Platform.OS === "android" && (
          <LocalToggle
            setting="vibration"
            icon="phone-portrait-outline"
            title="Vibration"
          />
        )}
        <Row
          icon="alarm-outline"
          title="Reminder timing"
          detail={timing}
          onPress={() => setTimingOpen(true)}
        />
        {permission?.status === "granted" && scheduled !== null && (
          <Row
            icon="checkmark-done-outline"
            title="Scheduled on this phone"
            detail={
              scheduled
                ? `${scheduled} upcoming reminder${scheduled === 1 ? "" : "s"} in the next 7 days`
                : "No reminders in the next 7 days"
            }
          />
        )}
      </Card>
      <Sheet
        visible={timingOpen}
        title="Reminder timing"
        onClose={() => setTimingOpen(false)}
      >
        <Label tone="muted" size={13} style={{ marginBottom: 12 }}>
          Applies to events, shifts and tasks that have a reminder on. Items set
          to “None” stay quiet.
        </Label>
        {[null, ...REMINDER_LEADS].map((lead) => {
          const value = lead === null ? null : reminderLead(lead);
          return (
            <Choice
              key={lead ?? "own"}
              label={lead ?? "As set on each event"}
              selected={settings.reminderLead === value}
              onPress={() => {
                setNotificationSettings({ reminderLead: value });
                setTimingOpen(false);
              }}
            />
          );
        })}
      </Sheet>
    </>
  );
}
