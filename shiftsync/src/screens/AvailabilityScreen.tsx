import React, { useState } from "react";
import { Switch, View } from "react-native";
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
} from "../components/ui";
import { DateTimeField } from "../components/DateTimeField";
import { animateLayout, haptics } from "../components/motion";
import { formatTime } from "../domain/schedule";
import type { AvailabilityDay } from "../domain/types";
import { useApp } from "../store/AppStore";
import type { StackProps } from "../navigation/types";
import { palette } from "../theme";

const names = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export function AvailabilityEditor({
  value,
  onChange,
}: {
  value: AvailabilityDay[];
  onChange: (days: AvailabilityDay[]) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const update = (day: AvailabilityDay) => {
    if (day.end <= day.start) {
      haptics.warning();
      dialog.alert(
        "Check these hours",
        "Your available end time must be after your start time.",
      );
      return;
    }
    onChange(value.map((current) => (current.day === day.day ? day : current)));
  };
  return (
    <>
      {[1, 2, 3, 4, 5, 6, 0].map((index) => {
        const day = value.find((current) => current.day === index)!;
        return (
          <Card key={day.day}>
            <Row
              icon={day.enabled ? "sunny-outline" : "moon-outline"}
              title={names[index]}
              detail={
                day.enabled
                  ? `${formatTime(day.start)} – ${formatTime(day.end)}`
                  : "Unavailable"
              }
              onPress={() => {
                animateLayout();
                setExpanded(expanded === day.day ? null : day.day);
              }}
              trailing={
                <Switch
                  accessibilityLabel={`Available on ${names[index]}`}
                  value={day.enabled}
                  onValueChange={(enabled) => {
                    if (expanded === day.day) animateLayout();
                    update({ ...day, enabled });
                  }}
                  trackColor={{ false: palette.beige, true: palette.teal }}
                  thumbColor="#FFFDF8"
                />
              }
            />
            {expanded === day.day && day.enabled && (
              <View style={{ marginTop: 16 }}>
                <DateTimeField
                  label="Available from"
                  mode="time"
                  value={day.start}
                  onChange={(start) => update({ ...day, start })}
                />
                <DateTimeField
                  label="Available until"
                  mode="time"
                  value={day.end}
                  onChange={(end) => update({ ...day, end })}
                />
              </View>
            )}
          </Card>
        );
      })}
    </>
  );
}
export function AvailabilityScreen({ navigation }: StackProps<"Availability">) {
  const { data, setAvailability, setPreferences } = useApp();
  return (
    <Screen>
      <Header
        title="Your availability"
        subtitle="Make space for work, and for yourself."
        back={navigation.goBack}
      />
      <Label tone="muted" style={{ marginBottom: 20 }}>
        Tap a day to set its hours. CalenBud uses these when suggesting times.
      </Label>
      <AvailabilityEditor
        value={data.availability}
        onChange={setAvailability}
      />
      <Section title="Preferred hours" />
      {(["Any", "Morning", "Evening"] as const).map((period) => (
        <Choice
          key={period}
          label={
            period === "Any"
              ? "Any available time"
              : `Prefer ${period.toLowerCase()} schedules`
          }
          selected={data.preferences.preferredPeriod === period}
          onPress={() => setPreferences({ preferredPeriod: period })}
        />
      ))}
      <Section title="Scheduling restrictions" />
      <Choice
        label="Avoid overlapping events"
        detail="Warn before saving an overlapping event."
        selected={data.preferences.avoidOverlaps}
        onPress={() =>
          setPreferences({ avoidOverlaps: !data.preferences.avoidOverlaps })
        }
      />
      <Choice
        label="Avoid back-to-back events"
        detail="Allow at least 15 minutes between events."
        selected={data.preferences.avoidBackToBack}
        onPress={() =>
          setPreferences({ avoidBackToBack: !data.preferences.avoidBackToBack })
        }
      />
      <View style={{ marginTop: 18 }}>
        <Button
          icon="ban-outline"
          variant="secondary"
          onPress={() =>
            navigation.navigate("ItemEditor", { kind: "unavailable" })
          }
        >
          Add unavailable date or time
        </Button>
      </View>
      <Label size={12} tone="muted" style={{ marginTop: 12 }}>
        Changes are saved automatically on your device.
      </Label>
    </Screen>
  );
}
