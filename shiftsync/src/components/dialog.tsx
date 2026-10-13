import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, palette, useTheme, type Theme } from "../theme";
import { Icon, Label, type IconName } from "./ui";
import { durations, easing, haptics, useReducedMotion } from "./motion";

// ShiftSync's own confirmation dialog, used everywhere instead of the
// platform's gray Alert box. `dialog.alert` takes the same arguments as
// React Native's Alert.alert, so call sites read the same.
//
// Rules that keep dialogs safe:
// - Dismissing (backdrop tap, Android Back) only runs the "cancel" action,
//   never the primary one. An acknowledgement with a single button runs that
//   button, since it is the only way forward.
// - While an async action runs, every button is disabled, the dialog can't
//   be dismissed, and the pressed button shows a spinner.
// - Dialogs opened while another is showing wait their turn.
export type DialogAction = {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => unknown;
};
export type DialogTone = "default" | "danger" | "warning" | "success";
export type DialogOptions = {
  title: string;
  message?: string;
  actions?: DialogAction[];
  tone?: DialogTone;
  icon?: IconName;
};
type Entry = DialogOptions & { key: number };

let queue: Entry[] = [];
let nextKey = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const current = () => queue[0] ?? null;
const finish = (key: number) => {
  queue = queue.filter((entry) => entry.key !== key);
  emit();
};

export function showDialog(options: DialogOptions) {
  queue = [...queue, { ...options, key: nextKey++ }];
  emit();
}
export const dialog = {
  alert(
    title: string,
    message?: string,
    actions?: DialogAction[],
    extra?: Pick<DialogOptions, "tone" | "icon">,
  ) {
    showDialog({ title, message, actions, ...extra });
  },
};

const toneIcon: Record<DialogTone, IconName> = {
  default: "calendar-clear-outline",
  danger: "warning-outline",
  warning: "alert-circle-outline",
  success: "checkmark-circle-outline",
};
function toneColors(theme: Theme, tone: DialogTone) {
  if (tone === "danger")
    return { icon: theme.danger, background: theme.dangerSoft };
  if (tone === "warning")
    return { icon: theme.warning, background: theme.warningSoft };
  if (tone === "success")
    return { icon: theme.accentText, background: theme.successSoft };
  return {
    icon: theme.dark ? palette.beige : palette.navy,
    background: theme.soft,
  };
}

export function DialogHost() {
  const entry = useSyncExternalStore(subscribe, current);
  // Remount per dialog so busy state and focus never carry over.
  return entry ? <DialogView key={entry.key} entry={entry} /> : null;
}

function DialogView({ entry }: { entry: Entry }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const inset = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [busy, setBusy] = useState<number | null>(null);
  const busyRef = useRef(false);
  const closing = useRef(false);
  const progress = useRef(new Animated.Value(0)).current;
  const titleRef = useRef<Text>(null);
  const actions: DialogAction[] = entry.actions?.length
    ? entry.actions
    : [{ text: "OK" }];
  const destructive = actions.some((action) => action.style === "destructive");
  const tone: DialogTone = entry.tone ?? (destructive ? "danger" : "default");
  const colors = toneColors(theme, tone);
  // The safe choice sits last, nearest the thumb's resting place; the primary
  // action goes on top so it is read first.
  const ordered = [
    ...actions.filter((action) => action.style !== "cancel"),
    ...actions.filter((action) => action.style === "cancel"),
  ];
  const primary = ordered.find((action) => action.style !== "cancel");

  useEffect(() => {
    // A dialog never sits half-hidden behind the keyboard.
    Keyboard.dismiss();
    if (tone === "danger" || tone === "warning") haptics.warning();
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: reduced ? 0 : durations.component,
      easing: easing.enter,
      useNativeDriver: true,
    });
    animation.start();
    // Move screen-reader focus to the title once the dialog is up.
    const timer = setTimeout(() => {
      if (titleRef.current)
        AccessibilityInfo.sendAccessibilityEvent(titleRef.current, "focus");
    }, 250);
    return () => {
      animation.stop();
      clearTimeout(timer);
    };
  }, []);

  const close = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, {
      toValue: 0,
      duration: reduced ? 0 : durations.micro,
      easing: easing.exit,
      useNativeDriver: true,
    }).start(() => {
      finish(entry.key);
      then?.();
    });
  };
  const run = async (action: DialogAction, index: number) => {
    if (busyRef.current || closing.current) return;
    busyRef.current = true;
    try {
      const result = action.onPress?.();
      if (result instanceof Promise) {
        setBusy(index);
        await result.catch(() => {});
      }
    } finally {
      close();
    }
  };
  const dismiss = () => {
    if (busyRef.current || closing.current) return;
    const fallback =
      actions.find((action) => action.style === "cancel") ??
      (actions.length === 1 ? actions[0] : null);
    if (fallback) void run(fallback, ordered.indexOf(fallback));
    else close();
  };

  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      <View style={s.root}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: "#080F2080", opacity: progress },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss dialog"
            onPress={dismiss}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          accessibilityRole="alert"
          style={[
            s.card,
            {
              backgroundColor: theme.surface,
              borderColor: theme.line,
              maxHeight: height - inset.top - inset.bottom - 48,
              opacity: progress,
              transform: [
                {
                  scale: reduced
                    ? 1
                    : progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.96, 1],
                      }),
                },
              ],
            },
          ]}
        >
          <ScrollView
            bounces={false}
            contentContainerStyle={{ padding: 24, paddingBottom: 8 }}
          >
            <View style={[s.iconWrap, { backgroundColor: colors.background }]}>
              <Icon
                name={entry.icon ?? toneIcon[tone]}
                size={26}
                color={colors.icon}
              />
            </View>
            <Text
              ref={titleRef}
              accessibilityRole="header"
              style={[s.title, { color: theme.text }]}
            >
              {entry.title}
            </Text>
            {entry.message ? (
              <Label tone="muted" style={{ marginTop: 8 }}>
                {entry.message}
              </Label>
            ) : null}
          </ScrollView>
          <View style={{ padding: 24, paddingTop: 16, gap: 10 }}>
            {ordered.map((action, index) => (
              <DialogButton
                key={`${action.text}-${index}`}
                action={action}
                primary={action === primary}
                busy={busy === index}
                disabled={busy !== null}
                onPress={() => void run(action, index)}
              />
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function DialogButton({
  action,
  primary,
  busy,
  disabled,
  onPress,
}: {
  action: DialogAction;
  primary: boolean;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const destructive = action.style === "destructive";
  // Primary: deep navy (beige in dark mode). Destructive: red. Everything
  // else is a quiet outlined button, so there is one clear main action.
  const background = destructive
    ? theme.dangerSolid
    : primary
      ? theme.dark
        ? palette.beige
        : palette.navy
      : "transparent";
  const color = destructive
    ? theme.onDangerSolid
    : primary
      ? theme.dark
        ? palette.navy
        : palette.ivory
      : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={action.text}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        {
          backgroundColor: background,
          borderColor: destructive || primary ? "transparent" : theme.line,
          opacity: disabled && !busy ? 0.5 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} accessibilityLabel="Working" />
      ) : (
        <Text style={[s.buttonText, { color }]}>{action.text}</Text>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    borderRadius: 24,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: palette.ink,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontFamily: fonts.semibold,
    fontSize: 20,
    lineHeight: 28,
  },
  button: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  buttonText: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    textAlign: "center",
  },
});
