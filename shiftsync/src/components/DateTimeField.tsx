import React, { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  dateKey,
  formatDate,
  formatTime,
  parseDate,
  timeKey,
} from "../domain/schedule";
import { useTheme } from "../theme";
import { Button, Icon, Label, Sheet } from "./ui";

export function DateTimeField({
  label,
  value,
  mode,
  onChange,
}: {
  label: string;
  value: string;
  mode: "date" | "time";
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  const date =
    mode === "date" ? parseDate(value) : new Date(`2026-01-01T${value}:00`);
  const [draft, setDraft] = useState(date);
  const picker = (
    <DateTimePicker
      value={draft}
      mode={mode}
      display={Platform.OS === "ios" ? "spinner" : "default"}
      is24Hour={false}
      themeVariant={theme.dark ? "dark" : "light"}
      onChange={(event, selected) => {
        if (Platform.OS === "android") {
          setOpen(false);
          if (event.type === "set" && selected)
            onChange(
              mode === "date"
                ? dateKey(selected)
                : timeKey(selected.getHours() * 60 + selected.getMinutes()),
            );
        } else if (selected) setDraft(selected);
      }}
    />
  );
  return (
    <View style={{ gap: 8, marginBottom: 16 }}>
      <Label weight="medium">{label}</Label>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${mode === "date" ? formatDate(value) : formatTime(value)}`}
        onPress={() => {
          setDraft(date);
          setOpen(true);
        }}
        style={{
          minHeight: 54,
          borderWidth: 1,
          borderColor: theme.line,
          backgroundColor: theme.surface,
          paddingHorizontal: 14,
          borderRadius: 12,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <View style={{ flex: 1 }}>
          <Label size={14}>
            {mode === "date" ? formatDate(value, true) : formatTime(value)}
          </Label>
        </View>
        <Icon
          name={mode === "date" ? "calendar-outline" : "time-outline"}
          size={20}
        />
      </Pressable>
      {Platform.OS === "android" ? (
        open && picker
      ) : (
        <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
          {picker}
          <Button
            onPress={() => {
              onChange(
                mode === "date"
                  ? dateKey(draft)
                  : timeKey(draft.getHours() * 60 + draft.getMinutes()),
              );
              setOpen(false);
            }}
          >
            Done
          </Button>
        </Sheet>
      )}
    </View>
  );
}
