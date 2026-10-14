import React, { useState } from "react";
import { View } from "react-native";
import { formatDate, formatTime } from "../domain/schedule";
import { palette, useTheme } from "../theme";
import { PressableScale, haptics } from "./motion";
import { DatePicker, TimePicker } from "./pickers";
import { Icon, Label, Sheet } from "./ui";

export function DateTimeField({
  label,
  value,
  mode,
  min,
  onChange,
}: {
  label: string;
  value: string;
  mode: "date" | "time";
  /** Earliest selectable date (date mode only). */
  min?: string;
  onChange: (value: string) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  // A fresh picker per opening starts from the saved value, so a cancelled
  // change is never carried into the next opening.
  const [session, setSession] = useState(0);
  const close = () => setOpen(false);
  const shown = mode === "date" ? formatDate(value, true) : formatTime(value);
  return (
    <View style={{ gap: 8, marginBottom: 16 }}>
      <Label weight="medium">{label}</Label>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${mode === "date" ? formatDate(value) : formatTime(value)}`}
        accessibilityHint={`Opens the ${mode === "date" ? "calendar" : "clock"}`}
        onPress={() => {
          haptics.tap();
          setSession((value) => value + 1);
          setOpen(true);
        }}
        throttle={400}
        scaleTo={0.98}
        pressedOpacity={0.9}
        style={{
          minHeight: 54,
          borderWidth: open ? 2 : 1,
          borderColor: open ? palette.teal : theme.line,
          backgroundColor: theme.surface,
          paddingHorizontal: open ? 13 : 14,
          borderRadius: 12,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <View style={{ flex: 1 }}>
          <Label size={14}>{shown}</Label>
        </View>
        <Icon
          name={mode === "date" ? "calendar-outline" : "time-outline"}
          size={20}
          color={open ? theme.accentText : undefined}
        />
      </PressableScale>
      <Sheet visible={open} onClose={close} title={label} scrollable={false}>
        {mode === "date" ? (
          <DatePicker
            key={session}
            value={value}
            min={min}
            onCancel={close}
            onConfirm={(next) => {
              haptics.success();
              onChange(next);
              close();
            }}
          />
        ) : (
          <TimePicker
            key={session}
            value={value}
            onCancel={close}
            onConfirm={(next) => {
              haptics.success();
              onChange(next);
              close();
            }}
          />
        )}
      </Sheet>
    </View>
  );
}
