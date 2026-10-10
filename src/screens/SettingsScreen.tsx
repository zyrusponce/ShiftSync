import React, { useState } from "react";
import { Alert, Switch, View } from "react-native";
import {
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
import type { StackProps } from "../navigation/types";
import { palette } from "../theme";

type SettingKey =
  | "defaultView"
  | "weekStarts"
  | "defaultDuration"
  | "bufferMinutes"
  | "appearance"
  | "aiFrequency";
export function SettingsScreen({ route, navigation }: StackProps<"Settings">) {
  const { data, setPreferences } = useApp();
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
  };
  const labels: Record<SettingKey, string> = {
    defaultView: "Default calendar view",
    weekStarts: "Week starts on",
    defaultDuration: "Default event duration",
    bufferMinutes: "Buffer time",
    appearance: "Appearance",
    aiFrequency: "Suggestion frequency",
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
                Alert.alert(
                  "Local demo",
                  "Passwords are not stored or authenticated in this demo. Password management needs a configured authentication service.",
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
                Alert.alert(
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
          </Card>
        </>
      )}
      {show("Notifications") && (
        <>
          <Section title="Notifications" />
          <Card>
            {toggle("reminders", "Event reminders")}
            {toggle("conflictAlerts", "Conflict alerts")}
            {toggle("shiftNotifications", "Shift notifications")}
          </Card>
          <Label tone="muted" size={12}>
            These preferences control the in-app notification list. Push
            delivery needs a notification service.
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
          <Card>
            <Label weight="semibold">Your local demo</Label>
            <Label style={{ marginTop: 12 }}>
              There is no authenticated online account in this build. Passwords
              are never saved. Profile and scheduling data are stored in this
              app’s local storage, without a cloud backup.
            </Label>
            <Label style={{ marginTop: 12 }}>
              Use example information when trying the demo. Production security
              requires an authentication service and a protected storage
              strategy.
            </Label>
          </Card>
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
