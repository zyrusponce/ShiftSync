import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { fonts, palette, useTheme } from "../theme";
import {
  FadeIn,
  Pop,
  PressableScale,
  durations,
  easing,
  haptics,
  settle,
  usePop,
  useReducedMotion,
  useThrottle,
} from "./motion";

export type IconName = React.ComponentProps<typeof Ionicons>["name"];
const FocusContext = createContext<((field: TextInput | null) => void) | null>(
  null,
);
export function Icon({
  name,
  size = 22,
  color,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  const theme = useTheme();
  return (
    <Ionicons
      name={name}
      size={size}
      color={color ?? theme.text}
      accessible={false}
    />
  );
}
export function Label({
  children,
  tone = "normal",
  size = 14,
  weight = "regular",
  style,
}: {
  children: React.ReactNode;
  tone?: "normal" | "muted" | "teal";
  size?: number;
  weight?: keyof typeof fonts;
  style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  return (
    <Text
      style={[
        {
          fontFamily: fonts[weight],
          fontSize: size,
          lineHeight: size * 1.5,
          color:
            tone === "muted"
              ? theme.muted
              : tone === "teal"
                ? theme.dark
                  ? palette.aqua
                  : "#27666C"
                : theme.text,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
export function Screen({
  children,
  scroll = true,
  footer,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  footer?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const inset = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const viewportRef = useRef<View>(null);
  const fieldRef = useRef<TextInput | null>(null);
  const offset = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealField = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      fieldRef.current?.measureInWindow((_x, y, _width, height) => {
        viewportRef.current?.measureInWindow(
          (_sx, top, _sw, availableHeight) => {
            const overflow = y + height - (top + availableHeight - 20);
            if (overflow > 0)
              scrollRef.current?.scrollTo({
                y: offset.current + overflow,
                animated: true,
              });
            else if (y < top + 12)
              scrollRef.current?.scrollTo({
                y: Math.max(0, offset.current + y - top - 12),
                animated: true,
              });
          },
        );
      });
    }, 250);
  };
  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidShow", revealField);
    return () => {
      subscription.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  return (
    <FocusContext.Provider
      value={(field) => {
        fieldRef.current = field;
        revealField();
      }}
    >
      <SafeAreaView
        edges={["top", "left", "right"]}
        style={{ flex: 1, backgroundColor: theme.background }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <View ref={viewportRef} style={{ flex: 1 }}>
            {scroll ? (
              <ScrollView
                style={{ flex: 1 }}
                ref={scrollRef}
                onScroll={(event) => {
                  offset.current = event.nativeEvent.contentOffset.y;
                }}
                scrollEventThrottle={16}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={[s.screen, { paddingBottom: 28 }, style]}
              >
                {children}
              </ScrollView>
            ) : (
              <View style={[s.screen, { flex: 1 }, style]}>{children}</View>
            )}
          </View>
          {footer && (
            <View
              style={{
                paddingHorizontal: 24,
                paddingTop: 12,
                paddingBottom: Math.max(inset.bottom, 16),
                backgroundColor: theme.background,
                borderTopWidth: 1,
                borderTopColor: theme.line,
              }}
            >
              {footer}
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </FocusContext.Provider>
  );
}
export function IconButton({
  icon,
  label,
  onPress,
  background,
  dot,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  background?: string;
  dot?: boolean;
}) {
  const theme = useTheme();
  // The unread dot appearing is the state change worth showing; the bell
  // itself stays still.
  const dotScale = usePop(!!dot);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      throttle={400}
      scaleTo={0.94}
      pressedOpacity={0.85}
      style={[s.iconButton, { backgroundColor: background ?? theme.surface }]}
    >
      <Icon name={icon} />
      <Animated.View
        pointerEvents="none"
        style={[s.dot, { opacity: dotScale, transform: [{ scale: dotScale }] }]}
      />
    </PressableScale>
  );
}
export function Header({
  title,
  subtitle,
  back,
  right,
}: {
  title: string;
  subtitle?: string;
  back?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 24 }}>
      <View style={s.header}>
        {back && (
          <IconButton icon="arrow-back" label="Go back" onPress={back} />
        )}
        <View style={{ flex: 1 }}>
          <Label size={26} weight="bold">
            {title}
          </Label>
        </View>
        {right}
      </View>
      {subtitle && (
        <Label tone="muted" style={{ marginTop: 6 }}>
          {subtitle}
        </Label>
      )}
    </View>
  );
}
export function Card({
  children,
  style,
  onPress,
  label,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  label?: string;
}) {
  const theme = useTheme();
  const cardStyle = [
    s.card,
    { backgroundColor: theme.surface, borderColor: theme.line },
    style,
  ];
  return onPress ? (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      throttle={400}
      scaleTo={0.98}
      pressedOpacity={0.92}
      style={cardStyle}
    >
      {children}
    </PressableScale>
  ) : (
    <View style={cardStyle}>{children}</View>
  );
}
export function Button({
  children,
  onPress,
  variant = "primary",
  icon,
  disabled,
  small = false,
}: {
  children: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: IconName;
  disabled?: boolean;
  small?: boolean;
}) {
  const theme = useTheme();
  const bg =
    variant === "primary"
      ? palette.teal
      : variant === "secondary"
        ? theme.soft
        : variant === "danger"
          ? theme.dark
            ? "#50363C"
            : "#F7E1DA"
          : "transparent";
  const color =
    variant === "primary"
      ? palette.ink
      : variant === "danger"
        ? theme.dark
          ? "#FFC3B4"
          : "#8C352D"
        : theme.text;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      throttle={400}
      // Filled buttons compress like a physical key; ghost buttons read as
      // text links, so they only dim.
      scaleTo={variant === "ghost" ? 1 : small ? 0.96 : 0.97}
      pressedOpacity={variant === "ghost" ? 0.55 : 0.9}
      style={[
        s.button,
        {
          backgroundColor: bg,
          paddingHorizontal: small ? 14 : 20,
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      {icon && <Icon name={icon} color={color} size={20} />}
      <Text
        style={{
          fontFamily: fonts.semibold,
          fontSize: 14,
          color,
          textAlign: "center",
        }}
      >
        {children}
      </Text>
    </PressableScale>
  );
}
export function Field({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  const theme = useTheme();
  const ref = useRef<TextInput>(null);
  const reveal = useContext(FocusContext);
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 8, marginBottom: 16 }}>
      <Label weight="medium">{label}</Label>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={theme.muted}
        selectionColor={palette.teal}
        {...props}
        onFocus={(event) => {
          setFocused(true);
          reveal?.(ref.current);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          reveal?.(null);
          props.onBlur?.(event);
        }}
        style={[
          s.input,
          {
            color: theme.text,
            backgroundColor: theme.surface,
            borderColor: error
              ? "#A34738"
              : focused
                ? palette.teal
                : theme.line,
          },
          props.multiline && { minHeight: 100, textAlignVertical: "top" },
          props.style,
        ]}
      />
      {error && (
        <FadeIn trigger={error}>
          <Label size={13}>{error}</Label>
        </FadeIn>
      )}
    </View>
  );
}
export function Badge({
  children,
  color = palette.aqua,
}: {
  children: string;
  color?: string;
}) {
  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 4,
        backgroundColor: color,
        borderRadius: 8,
      }}
    >
      <Text
        style={{ color: palette.navy, fontFamily: fonts.medium, fontSize: 12 }}
      >
        {children}
      </Text>
    </View>
  );
}
export function Section({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={[s.header, { marginTop: 22, marginBottom: 14 }]}>
      <View style={{ flex: 1 }}>
        <Label size={19} weight="semibold">
          {title}
        </Label>
      </View>
      {action && onPress && (
        <Button small variant="ghost" onPress={onPress}>
          {action}
        </Button>
      )}
    </View>
  );
}
export function Segments<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.indexOf(value));
  const position = useRef(new Animated.Value(index)).current;
  useEffect(() => {
    const animation = Animated.timing(position, {
      toValue: index,
      duration: reduced ? 0 : durations.component,
      easing: easing.enter,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [index, reduced, position]);
  const segmentWidth = width / options.length;
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width - 8)}
      style={[s.segments, { backgroundColor: theme.soft }]}
    >
      {width > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            s.segmentIndicator,
            {
              width: segmentWidth,
              backgroundColor: theme.surface,
              transform: [
                {
                  translateX: position.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, segmentWidth],
                  }),
                },
              ],
            },
          ]}
        />
      )}
      {options.map((option) => (
        <Pressable
          key={option}
          accessibilityRole="button"
          accessibilityState={{ selected: value === option }}
          onPress={() => {
            if (option === value) return;
            haptics.selection();
            onChange(option);
          }}
          style={({ pressed }) => [
            s.segment,
            {
              // Before the first layout pass, show the selection statically.
              backgroundColor:
                value === option && width === 0 ? theme.surface : "transparent",
              opacity: pressed && value !== option ? 0.6 : 1,
            },
          ]}
        >
          <Label size={13} weight={value === option ? "semibold" : "regular"}>
            {option}
          </Label>
        </Pressable>
      ))}
    </View>
  );
}
export function Choice({
  label,
  selected,
  onPress,
  detail,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  detail?: string;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      scaleTo={0.98}
      pressedOpacity={0.9}
      style={[
        s.choice,
        {
          backgroundColor: selected
            ? theme.dark
              ? "#27454D"
              : "#DEF1ED"
            : theme.surface,
          borderColor: selected ? palette.teal : theme.line,
        },
      ]}
    >
      <View>
        <Icon name="ellipse-outline" color={theme.muted} />
        <View style={StyleSheet.absoluteFill}>
          <Pop active={selected}>
            <Icon
              name="checkmark-circle"
              color={theme.dark ? palette.aqua : "#27666C"}
            />
          </Pop>
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <Label weight="medium">{label}</Label>
        {detail && (
          <Label tone="muted" size={12}>
            {detail}
          </Label>
        )}
      </View>
    </PressableScale>
  );
}
export function Row({
  icon,
  title,
  detail,
  onPress,
  trailing,
}: {
  icon: IconName;
  title: string;
  detail?: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
}) {
  const theme = useTheme();
  const press = useThrottle(onPress);
  const content = (
    <>
      <View style={[s.iconButton, { backgroundColor: theme.soft }]}>
        <Icon name={icon} size={20} />
      </View>
      <View style={{ flex: 1 }}>
        <Label weight="medium">{title}</Label>
        {detail && (
          <Label tone="muted" size={12}>
            {detail}
          </Label>
        )}
      </View>
      {trailing ?? (onPress && <Icon name="chevron-forward" size={18} />)}
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      onPress={press}
      // A soft brand-tinted highlight on both platforms instead of the
      // full-width Android ripple.
      style={({ pressed }) => [
        s.row,
        s.rowPressable,
        pressed && { backgroundColor: theme.soft },
      ]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={s.row}>{content}</View>
  );
}
export function Empty({
  icon = "calendar-outline",
  title,
  description,
  action,
  onPress,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Card style={{ alignItems: "center", paddingVertical: 36, gap: 12 }}>
      <View
        style={{ padding: 20, backgroundColor: theme.soft, borderRadius: 30 }}
      >
        <Icon name={icon} size={36} />
      </View>
      <Label size={18} weight="semibold" style={{ textAlign: "center" }}>
        {title}
      </Label>
      {description && (
        <Label tone="muted" style={{ textAlign: "center" }}>
          {description}
        </Label>
      )}
      {action && onPress && <Button onPress={onPress}>{action}</Button>}
    </Card>
  );
}
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const inset = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const [height, setHeight] = useState(() => Dimensions.get("window").height);
  const progress = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  // Keep showing the last content while the sheet slides away, so the sheet
  // doesn't collapse when the parent clears its state on close.
  const content = useRef({ title, children });
  if (visible) content.current = { title, children };
  const close = useRef(onClose);
  close.current = onClose;
  const laidOut = useRef(false);
  const pendingOpen = useRef(false);
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const run = (open: boolean) => {
    animation.current?.stop();
    animation.current = Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: reduced ? 120 : open ? durations.sheet : durations.sheet - 40,
      easing: open ? easing.enter : easing.exit,
      useNativeDriver: true,
    });
    animation.current.start(({ finished }) => {
      if (finished && !open) {
        laidOut.current = false;
        setMounted(false);
      }
    });
  };
  useEffect(() => {
    if (visible) {
      drag.setValue(0);
      // Slide up once the sheet knows its own height, so the motion distance
      // is right from the first frame.
      if (laidOut.current) run(true);
      else {
        pendingOpen.current = true;
        setMounted(true);
      }
    } else if (mounted) {
      pendingOpen.current = false;
      run(false);
    }
  }, [visible]);
  useEffect(() => () => animation.current?.stop(), []);
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 90 || g.vy > 0.9) close.current();
        else
          Animated.spring(drag, {
            toValue: 0,
            ...settle,
            useNativeDriver: true,
          }).start();
      },
      onPanResponderTerminate: () =>
        Animated.spring(drag, {
          toValue: 0,
          ...settle,
          useNativeDriver: true,
        }).start(),
    }),
  ).current;
  const shown = content.current;
  return (
    <Modal
      transparent
      visible={mounted}
      animationType="none"
      onRequestClose={onClose}
    >
      <View
        pointerEvents={visible ? "auto" : "none"}
        style={{ flex: 1, justifyContent: "flex-end" }}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: "#080F2066", opacity: progress },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close sheet"
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          onLayout={(event) => {
            setHeight(event.nativeEvent.layout.height);
            laidOut.current = true;
            if (pendingOpen.current) {
              pendingOpen.current = false;
              run(true);
            }
          }}
          style={{
            backgroundColor: theme.background,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 24,
            paddingBottom: Math.max(inset.bottom, 24),
            maxHeight: "85%",
            opacity: reduced ? progress : 1,
            transform: [
              {
                translateY: reduced
                  ? 0
                  : Animated.add(
                      drag,
                      progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [height + 24, 0],
                      }),
                    ),
              },
            ],
          }}
        >
          <View {...pan.panHandlers}>
            <View
              style={{
                width: 40,
                height: 4,
                backgroundColor: palette.beige,
                alignSelf: "center",
                borderRadius: 2,
                marginBottom: 16,
              }}
            />
            <View style={[s.header, { marginBottom: 16 }]}>
              <View style={{ flex: 1 }}>
                <Label size={20} weight="semibold">
                  {shown.title}
                </Label>
              </View>
              <IconButton icon="close" label="Close sheet" onPress={onClose} />
            </View>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {shown.children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}
export function Buddy({ size = 64 }: { size?: number }) {
  return (
    <Image
      source={require("../../assets/calendar buddy.png")}
      resizeMode="contain"
      accessibilityLabel="CalenBud"
      style={{ width: size, height: size }}
    />
  );
}
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <Image
      source={require("../../assets/logo.png")}
      resizeMode="contain"
      accessibilityLabel="ShiftSync logo"
      style={{ width: size, height: size }}
    />
  );
}
export function Brand() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Logo />
      <Label size={23} weight="bold">
        ShiftSync
      </Label>
    </View>
  );
}
export function Skeleton() {
  const opacity = useRef(new Animated.Value(0.4)).current;
  const theme = useTheme();
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      opacity.setValue(0.6);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.85,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, reduced]);
  return (
    <Animated.View style={{ opacity, gap: 18, marginTop: 36 }}>
      {[0, 1, 2].map((n) => (
        <View
          key={n}
          style={{ height: 95, backgroundColor: theme.soft, borderRadius: 18 }}
        />
      ))}
    </Animated.View>
  );
}
const s = StyleSheet.create({
  screen: { padding: 24 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    marginBottom: 12,
    shadowColor: palette.navy,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.035,
    shadowRadius: 12,
    elevation: 1,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    top: 9,
    right: 10,
    width: 7,
    height: 7,
    backgroundColor: palette.teal,
    borderRadius: 4,
  },
  button: {
    minHeight: 50,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.regular,
    fontSize: 14,
  },
  segments: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 14,
    marginBottom: 18,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  segmentIndicator: {
    position: "absolute",
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: 10,
  },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 54,
    marginBottom: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 68,
    paddingVertical: 10,
  },
  // Room for the pressed highlight; content stays exactly where it was.
  rowPressable: {
    marginHorizontal: -10,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
});
