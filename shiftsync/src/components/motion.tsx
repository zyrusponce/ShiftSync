import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import * as Haptics from "expo-haptics";

// The motion system has three tiers. Pick the tier by purpose, not by feel:
// - micro: acknowledging a touch (icons, buttons)
// - component: a control or piece of content changing state (indicators,
//   checkmarks, list changes)
// - navigation: moving between places in the app
// Bottom sheets are the one larger surface and take slightly longer.
export const durations = {
  micro: 120,
  component: 200,
  navigation: 220,
  sheet: 260,
};
// Natural deceleration in, quicker acceleration out. No bounce anywhere.
export const easing = {
  enter: Easing.out(Easing.cubic),
  exit: Easing.in(Easing.cubic),
};
// Used for things returning to rest after a touch (release, swipe-back).
export const settle = { speed: 40, bounciness: 0 };

let reduceMotion = false;
const listeners = new Set<() => void>();
const setReduceMotion = (value: boolean) => {
  reduceMotion = value;
  listeners.forEach((listener) => listener());
};
AccessibilityInfo.isReduceMotionEnabled()
  .then(setReduceMotion)
  .catch(() => {});
AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const isReducedMotion = () => reduceMotion;
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, isReducedMotion);
}

// Haptics are a bonus: unsupported devices or builds without the native
// module simply skip them. Android uses performHapticFeedback, which follows
// the system touch-feedback setting; iOS follows the system haptics setting.
const run = (ios: () => Promise<void>, android: Haptics.AndroidHaptics) => {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return;
  try {
    (Platform.OS === "android"
      ? Haptics.performAndroidHapticsAsync(android)
      : ios()
    ).catch(() => {});
  } catch {
    // Haptics never block an interaction.
  }
};
export const haptics = {
  selection: () =>
    run(Haptics.selectionAsync, Haptics.AndroidHaptics.Segment_Tick),
  tap: () =>
    run(
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
      Haptics.AndroidHaptics.Virtual_Key,
    ),
  success: () =>
    run(
      () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
      Haptics.AndroidHaptics.Confirm,
    ),
  warning: () =>
    run(
      () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
      Haptics.AndroidHaptics.Reject,
    ),
  error: () =>
    run(
      () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
      Haptics.AndroidHaptics.Reject,
    ),
};

// Smoothly animates the next layout change (items added, removed, expanded),
// so content below closes or opens a gap instead of jumping.
export function animateLayout() {
  if (reduceMotion) return;
  LayoutAnimation.configureNext(
    LayoutAnimation.create(
      durations.component,
      LayoutAnimation.Types.easeInEaseOut,
      LayoutAnimation.Properties.opacity,
    ),
  );
}

// Animates 0 → 1 whenever `trigger` changes (and on mount if `onMount`),
// without remounting the content.
export function useEntrance(
  trigger: unknown,
  {
    distance = 8,
    axis = "y",
    direction = 1,
    duration = durations.component,
    fromOpacity = 0,
    onMount = true,
  }: {
    distance?: number;
    axis?: "x" | "y";
    direction?: number;
    duration?: number;
    fromOpacity?: number;
    onMount?: boolean;
  } = {},
) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(onMount ? 0 : 1)).current;
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      if (!onMount) return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: reduced ? 0 : duration,
      easing: easing.enter,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [trigger]);
  const offset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [reduced ? 0 : distance * direction, 0],
  });
  return {
    opacity: progress.interpolate({
      inputRange: [0, 1],
      outputRange: [fromOpacity, 1],
    }),
    transform: [axis === "x" ? { translateX: offset } : { translateY: offset }],
  };
}
// For content that newly appears because of something the user did
// (a sent message, a validation error). Not for decorating static screens.
export function FadeIn({
  children,
  trigger,
  style,
}: {
  children: React.ReactNode;
  trigger?: unknown;
  style?: StyleProp<ViewStyle>;
}) {
  const entrance = useEntrance(trigger);
  return <Animated.View style={[style, entrance]}>{children}</Animated.View>;
}

// 0 → 1 when `active` turns on, 1 → 0 when it turns off. Starts at rest, so
// state that is already true on mount does not animate.
export function usePop(active: boolean) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(active ? 1 : 0)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const animation = Animated.timing(value, {
      toValue: active ? 1 : 0,
      duration: reduced ? 0 : durations.component,
      easing: active ? easing.enter : easing.exit,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [active, reduced]);
  return value;
}
// A completion mark (checkmark, unread dot) that grows in from slightly
// smaller rather than bouncing.
export function Pop({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  const value = usePop(active);
  return (
    <Animated.View
      style={{
        opacity: value,
        transform: [
          {
            scale: value.interpolate({
              inputRange: [0, 1],
              outputRange: [0.7, 1],
            }),
          },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

// Drops repeat presses inside `window` ms so a double tap can't run an action twice.
export function useThrottle<A extends unknown[]>(
  action: ((...args: A) => void) | null | undefined,
  window = 400,
) {
  const last = useRef(0);
  return (...args: A) => {
    const now = Date.now();
    if (window && now - last.current < window) return;
    last.current = now;
    action?.(...args);
  };
}

// Touch-down eases in immediately; release settles back without overshoot.
// Returns a 0 → 1 "pressed" value plus handlers to wire into a Pressable.
export function usePressFeedback() {
  const pressed = useRef(new Animated.Value(0)).current;
  useEffect(() => () => pressed.stopAnimation(), [pressed]);
  return {
    pressed,
    pressIn: () =>
      Animated.timing(pressed, {
        toValue: 1,
        duration: durations.micro,
        easing: easing.enter,
        useNativeDriver: true,
      }).start(),
    pressOut: () =>
      Animated.spring(pressed, {
        toValue: 0,
        ...settle,
        useNativeDriver: true,
      }).start(),
  };
}
export function pressScale(
  pressed: Animated.Value,
  scaleTo: number,
  reduced: boolean,
) {
  return reduced
    ? 1
    : pressed.interpolate({
        inputRange: [0, 1],
        outputRange: [1, scaleTo],
        extrapolate: "clamp",
      });
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
type PressableScaleProps = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  /** 1 disables the scale (for text-like controls that should only dim). */
  scaleTo?: number;
  pressedOpacity?: number;
  /** Ignore repeat presses within this window (ms) to avoid duplicate actions. */
  throttle?: number;
};
// A Pressable that compresses slightly on touch. Never uses a ripple.
export function PressableScale({
  style,
  scaleTo = 0.97,
  pressedOpacity = 0.9,
  throttle = 0,
  onPress,
  onPressIn,
  onPressOut,
  disabled,
  children,
  ...props
}: PressableScaleProps) {
  const reduced = useReducedMotion();
  const { pressed, pressIn, pressOut } = usePressFeedback();
  const handlePress = useThrottle(onPress, throttle);
  const flatOpacity = StyleSheet.flatten(style)?.opacity;
  const restingOpacity = typeof flatOpacity === "number" ? flatOpacity : 1;
  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      onPress={handlePress}
      onPressIn={(event: GestureResponderEvent) => {
        pressIn();
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        pressOut();
        onPressOut?.(event);
      }}
      style={[
        style,
        {
          opacity: pressed.interpolate({
            inputRange: [0, 1],
            outputRange: [restingOpacity, restingOpacity * pressedOpacity],
            extrapolate: "clamp",
          }),
          transform: [{ scale: pressScale(pressed, scaleTo, reduced) }],
        },
      ]}
    >
      {children}
    </AnimatedPressable>
  );
}
