// ShiftSync's own date and time pickers. They replace the system dialogs so
// every date and time choice uses the app's colors, Poppins, corner radii and
// touch feedback. Both work on a draft: nothing changes until Confirm.
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  addDays,
  dateKey,
  formatDate,
  parseDate,
  timeKey,
} from "../domain/schedule";
import { useApp } from "../store/AppStore";
import { fonts, palette, useTheme } from "../theme";
import { durations, easing, haptics, useEntrance } from "./motion";
import { Button, IconButton, Label } from "./ui";

const CELL = 44;
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  return dateKey(new Date(y, m - 1 + by, 1)).slice(0, 7);
};

function Actions({
  onCancel,
  onConfirm,
  confirmLabel,
  leading,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  leading?: React.ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginTop: 20,
      }}
    >
      <View style={{ flex: 1, alignItems: "flex-start" }}>{leading}</View>
      <Button small variant="ghost" onPress={onCancel}>
        Cancel
      </Button>
      <Button small icon="checkmark" onPress={onConfirm}>
        {confirmLabel}
      </Button>
    </View>
  );
}

export function DatePicker({
  value,
  min,
  onCancel,
  onConfirm,
}: {
  value: string;
  /** Earliest selectable date; earlier days are shown but disabled. */
  min?: string;
  onCancel: () => void;
  onConfirm: (date: string) => void;
}) {
  const theme = useTheme();
  const { data } = useApp();
  const weekStart = data.preferences.weekStarts === "Monday" ? 1 : 0;
  const [draft, setDraft] = useState(value);
  const [month, setMonth] = useState(value.slice(0, 7));
  const direction = useRef(1);
  const today = dateKey();
  const first = `${month}-01`;
  const gridStart = addDays(
    first,
    -((parseDate(first).getDay() - weekStart + 7) % 7),
  );
  // Always six rows, so the sheet never changes height between months.
  const cells = Array.from({ length: 42 }, (_, n) => addDays(gridStart, n));
  const canGoBack = !min || shiftMonth(month, -1) >= min.slice(0, 7);
  const goTo = (next: string) => {
    if (next === month) return;
    direction.current = next > month ? 1 : -1;
    haptics.selection();
    setMonth(next);
  };
  const motion = useEntrance(month, {
    axis: "x",
    distance: 16,
    direction: direction.current,
    duration: durations.navigation,
    fromOpacity: 0.3,
    onMount: false,
  });
  const select = (date: string) => {
    if (min && date < min) return;
    if (date !== draft) haptics.selection();
    setDraft(date);
    if (date.slice(0, 7) !== month) goTo(date.slice(0, 7));
  };
  const names =
    weekStart === 1
      ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <View>
      <Label tone="muted" size={13}>
        Selected
      </Label>
      <Label size={22} weight="semibold" style={{ marginBottom: 14 }}>
        {formatDate(draft)}
      </Label>
      <View
        style={{
          backgroundColor: theme.surface,
          borderColor: theme.line,
          borderWidth: 1,
          borderRadius: 18,
          paddingVertical: 10,
          paddingHorizontal: 6,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 4,
            marginBottom: 6,
          }}
        >
          <View style={{ opacity: canGoBack ? 1 : 0.35 }}>
            <IconButton
              icon="chevron-back"
              label="Previous month"
              onPress={() => canGoBack && goTo(shiftMonth(month, -1))}
            />
          </View>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Label
              size={16}
              weight="semibold"
              // Announced when the month changes.
              style={{ textAlign: "center" }}
            >
              {parseDate(first).toLocaleDateString("en-US", {
                month: "long",
                year: "numeric",
              })}
            </Label>
          </View>
          <IconButton
            icon="chevron-forward"
            label="Next month"
            onPress={() => goTo(shiftMonth(month, 1))}
          />
        </View>
        <View style={{ flexDirection: "row" }}>
          {names.map((name) => (
            <View
              key={name}
              style={{
                width: `${100 / 7}%`,
                alignItems: "center",
                paddingBottom: 6,
              }}
            >
              <Label size={12} tone="muted" weight="medium">
                {name.slice(0, 2)}
              </Label>
            </View>
          ))}
        </View>
        <Animated.View
          accessibilityLiveRegion="polite"
          style={[{ flexDirection: "row", flexWrap: "wrap" }, motion]}
        >
          {cells.map((date) => {
            const selected = date === draft;
            const disabled = !!min && date < min;
            const outside = date.slice(0, 7) !== month;
            const isToday = date === today;
            return (
              <Pressable
                key={date}
                accessibilityRole="button"
                accessibilityLabel={`${isToday ? "Today, " : ""}${formatDate(date)}`}
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                onPress={() => select(date)}
                style={{
                  width: `${100 / 7}%`,
                  height: CELL,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {({ pressed }) => (
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 13,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: selected
                        ? palette.teal
                        : pressed || isToday
                          ? theme.soft
                          : "transparent",
                      opacity: disabled ? 0.35 : 1,
                    }}
                  >
                    <Label
                      size={15}
                      weight={selected || isToday ? "semibold" : "regular"}
                      style={{
                        color: selected
                          ? palette.ink
                          : outside
                            ? theme.faint
                            : theme.text,
                        textDecorationLine: disabled ? "line-through" : "none",
                      }}
                    >
                      {parseDate(date).getDate()}
                    </Label>
                    {isToday && (
                      // Today is marked by shape, not only by tint.
                      <View
                        style={{
                          position: "absolute",
                          bottom: 4,
                          width: 14,
                          height: 2,
                          borderRadius: 1,
                          backgroundColor: selected
                            ? palette.ink
                            : theme.accentText,
                        }}
                      />
                    )}
                  </View>
                )}
              </Pressable>
            );
          })}
        </Animated.View>
      </View>
      <Actions
        onCancel={onCancel}
        onConfirm={() => onConfirm(draft)}
        confirmLabel="Set Date"
        leading={
          (!min || today >= min) && draft !== today ? (
            <Button small variant="ghost" onPress={() => select(today)}>
              Today
            </Button>
          ) : null
        }
      />
    </View>
  );
}

type Period = "AM" | "PM";
function Segment({
  text,
  active,
  label,
  onPress,
}: {
  text: string;
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 88,
        height: 72,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: active ? "transparent" : theme.line,
        backgroundColor: active
          ? theme.dark
            ? "#304E55"
            : "#E2F1E9"
          : theme.surface,
        opacity: pressed && !active ? 0.75 : 1,
      })}
    >
      <Label
        size={38}
        weight="semibold"
        style={{
          lineHeight: 48,
          color: active ? theme.accentText : theme.text,
        }}
      >
        {text}
      </Label>
    </Pressable>
  );
}
function PeriodToggle({
  value,
  onChange,
}: {
  value: Period;
  onChange: (value: Period) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: theme.line,
        borderRadius: 14,
        overflow: "hidden",
        backgroundColor: theme.surface,
      }}
    >
      {(["AM", "PM"] as const).map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityLabel={option}
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (active) return;
              haptics.selection();
              onChange(option);
            }}
            style={({ pressed }) => ({
              width: 56,
              height: 36,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: active ? palette.teal : "transparent",
              opacity: pressed && !active ? 0.6 : 1,
            })}
          >
            <Label
              size={14}
              weight={active ? "semibold" : "medium"}
              style={{ color: active ? palette.ink : theme.muted }}
            >
              {option}
            </Label>
          </Pressable>
        );
      })}
    </View>
  );
}

function ClockFace({
  mode,
  hour,
  minute,
  onHour,
  onMinute,
  onHourDone,
}: {
  mode: "hour" | "minute";
  hour: number;
  minute: number;
  onHour: (hour: number) => void;
  onMinute: (minute: number) => void;
  /** Lifting a finger after picking an hour moves on to minutes. */
  onHourDone: () => void;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const size = Math.min(264, width - 64);
  const center = size / 2;
  const radius = center - 26;
  const valueAngle = mode === "hour" ? (hour % 12) * 30 : minute * 6;
  // The hand turns the short way round, so 11 → 1 doesn't spin backwards.
  const angle = useRef(new Animated.Value(valueAngle)).current;
  const current = useRef(valueAngle);
  const dragging = useRef(false);
  useEffect(() => {
    const delta = ((((valueAngle - current.current) % 360) + 540) % 360) - 180;
    current.current += delta;
    if (dragging.current) {
      angle.setValue(current.current);
      return;
    }
    const animation = Animated.timing(angle, {
      toValue: current.current,
      duration: durations.micro + 40,
      easing: easing.enter,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [valueAngle, angle]);

  const latest = useRef({ mode, hour, minute, onHour, onMinute, onHourDone });
  latest.current = { mode, hour, minute, onHour, onMinute, onHourDone };
  const pick = (x: number, y: number, exact: boolean) => {
    const dx = x - center;
    const dy = y - center;
    if (Math.hypot(dx, dy) < 18) return;
    const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    const now = latest.current;
    if (now.mode === "hour") {
      const next = Math.round(deg / 30) % 12 || 12;
      if (next !== now.hour) {
        haptics.selection();
        now.onHour(next);
      }
    } else {
      // A tap lands on the nearest five; dragging reaches every minute.
      const next = exact
        ? Math.round(deg / 6) % 60
        : (Math.round(deg / 30) * 5) % 60;
      if (next !== now.minute) {
        haptics.selection();
        now.onMinute(next);
      }
    }
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        dragging.current = true;
        pick(event.nativeEvent.locationX, event.nativeEvent.locationY, false);
      },
      onPanResponderMove: (event) =>
        pick(event.nativeEvent.locationX, event.nativeEvent.locationY, true),
      onPanResponderRelease: () => {
        dragging.current = false;
        if (latest.current.mode === "hour") latest.current.onHourDone();
      },
      onPanResponderTerminate: () => {
        dragging.current = false;
      },
    }),
  ).current;

  const labels =
    mode === "hour"
      ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
      : [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
  const selectedLabel = mode === "hour" ? hour : minute;
  const step = (by: number) =>
    mode === "hour"
      ? onHour(((hour - 1 + by + 12) % 12) + 1)
      : onMinute((minute + by + 60) % 60);
  return (
    <View
      {...pan.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={mode === "hour" ? "Hour" : "Minute"}
      accessibilityValue={{
        text: mode === "hour" ? String(hour) : String(minute).padStart(2, "0"),
      }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) =>
        step(event.nativeEvent.actionName === "increment" ? 1 : -1)
      }
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignSelf: "center",
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.line,
      }}
    >
      {/* Nothing inside takes touches, so coordinates are the face's own. */}
      <View pointerEvents="none" style={{ flex: 1 }}>
        <Animated.View
          style={{
            position: "absolute",
            width: size,
            height: size,
            transform: [
              {
                rotate: angle.interpolate({
                  inputRange: [0, 360],
                  outputRange: ["0deg", "360deg"],
                  extrapolate: "extend",
                }),
              },
            ],
          }}
        >
          <View
            style={{
              position: "absolute",
              left: center - 1,
              top: center - radius + 18,
              width: 2,
              height: radius - 18,
              borderRadius: 1,
              backgroundColor: palette.teal,
            }}
          />
          <View
            style={{
              position: "absolute",
              left: center - 20,
              top: center - radius - 20,
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: palette.teal,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {mode === "minute" && minute % 5 !== 0 && (
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: palette.ink,
                }}
              />
            )}
          </View>
        </Animated.View>
        <View
          style={{
            position: "absolute",
            left: center - 4,
            top: center - 4,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: palette.teal,
          }}
        />
        {labels.map((label, n) => {
          const rad = (n * 30 * Math.PI) / 180;
          const active = label === selectedLabel;
          return (
            <View
              key={`${mode}${label}`}
              style={{
                position: "absolute",
                left: center + radius * Math.sin(rad) - 20,
                top: center - radius * Math.cos(rad) - 20,
                width: 40,
                height: 40,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Label
                size={15}
                weight={active ? "semibold" : "medium"}
                style={{ color: active ? palette.ink : theme.text }}
              >
                {mode === "minute" ? String(label).padStart(2, "0") : label}
              </Label>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function TypedField({
  value,
  label,
  onChange,
  autoFocus,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ alignItems: "center", gap: 6 }}>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, "").slice(0, 2))}
        keyboardType="number-pad"
        maxLength={2}
        autoFocus={autoFocus}
        selectTextOnFocus
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        selectionColor={palette.teal}
        style={{
          width: 88,
          height: 72,
          borderRadius: 16,
          borderWidth: focused ? 2 : 1,
          borderColor: focused ? palette.teal : theme.line,
          backgroundColor: theme.surface,
          color: theme.text,
          fontFamily: fonts.semibold,
          fontSize: 34,
          textAlign: "center",
          padding: 0,
        }}
      />
      <Label size={12} tone="muted">
        {label}
      </Label>
    </View>
  );
}

export function TimePicker({
  value,
  onCancel,
  onConfirm,
}: {
  /** "HH:mm", 24-hour. */
  value: string;
  onCancel: () => void;
  onConfirm: (time: string) => void;
}) {
  const theme = useTheme();
  const [h24, m] = value.split(":").map(Number);
  const [hour, setHour] = useState(h24 % 12 || 12);
  const [minute, setMinute] = useState(m);
  const [period, setPeriod] = useState<Period>(h24 >= 12 ? "PM" : "AM");
  const [mode, setMode] = useState<"hour" | "minute">("hour");
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState({ hour: "", minute: "" });
  const [error, setError] = useState("");
  const faceMotion = useEntrance(`${typing}${mode}`, {
    distance: 6,
    fromOpacity: 0.4,
    duration: durations.component,
    onMount: false,
  });
  const startTyping = () => {
    setTyped({ hour: String(hour), minute: String(minute).padStart(2, "0") });
    setError("");
    setTyping(true);
  };
  const stopTyping = () => {
    // Keep valid typed values when going back to the clock.
    const h = Number(typed.hour);
    const mm = Number(typed.minute);
    if (h >= 1 && h <= 12) setHour(h);
    if (typed.minute !== "" && mm >= 0 && mm <= 59) setMinute(mm);
    setError("");
    setTyping(false);
  };
  const confirm = () => {
    let h = hour;
    let mm = minute;
    if (typing) {
      h = Number(typed.hour);
      mm = Number(typed.minute);
      if (!typed.hour || h < 1 || h > 12)
        return (haptics.error(), setError("Enter an hour from 1 to 12."));
      if (typed.minute === "" || mm > 59)
        return (haptics.error(), setError("Enter minutes from 00 to 59."));
    }
    onConfirm(timeKey(((h % 12) + (period === "PM" ? 12 : 0)) * 60 + mm));
  };
  return (
    <View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          marginBottom: 20,
        }}
      >
        {typing ? (
          <>
            <TypedField
              label="Hour"
              value={typed.hour}
              autoFocus
              onChange={(text) => {
                setError("");
                setTyped((current) => ({ ...current, hour: text }));
              }}
            />
            <Label size={34} weight="semibold" style={{ marginBottom: 22 }}>
              :
            </Label>
            <TypedField
              label="Minute"
              value={typed.minute}
              onChange={(text) => {
                setError("");
                setTyped((current) => ({ ...current, minute: text }));
              }}
            />
          </>
        ) : (
          <>
            <Segment
              text={String(hour)}
              active={mode === "hour"}
              label={`Hour, ${hour}`}
              onPress={() => {
                if (mode !== "hour") haptics.selection();
                setMode("hour");
              }}
            />
            <Label size={38} weight="semibold" style={{ color: theme.muted }}>
              :
            </Label>
            <Segment
              text={String(minute).padStart(2, "0")}
              active={mode === "minute"}
              label={`Minute, ${minute}`}
              onPress={() => {
                if (mode !== "minute") haptics.selection();
                setMode("minute");
              }}
            />
          </>
        )}
        <View style={{ marginLeft: 6, marginBottom: typing ? 22 : 0 }}>
          <PeriodToggle value={period} onChange={setPeriod} />
        </View>
      </View>
      <Animated.View style={faceMotion}>
        {typing ? (
          <Label
            tone="muted"
            size={13}
            style={{
              textAlign: "center",
              color: error ? theme.danger : theme.muted,
            }}
          >
            {error || "Type the hour and minutes, then choose AM or PM."}
          </Label>
        ) : (
          <ClockFace
            mode={mode}
            hour={hour}
            minute={minute}
            onHour={setHour}
            onMinute={setMinute}
            onHourDone={() => setMode("minute")}
          />
        )}
      </Animated.View>
      <Actions
        onCancel={onCancel}
        onConfirm={confirm}
        confirmLabel="Set Time"
        leading={
          <IconButton
            icon={typing ? "time-outline" : "keypad-outline"}
            label={typing ? "Use the clock" : "Type the time"}
            onPress={typing ? stopTyping : startTyping}
          />
        }
      />
    </View>
  );
}
