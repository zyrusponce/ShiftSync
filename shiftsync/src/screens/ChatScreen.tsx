import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Animated,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Badge, Buddy, Button, Header, Icon, Label } from "../components/ui";
import {
  FadeIn,
  PressableScale,
  easing,
  haptics,
  useReducedMotion,
} from "../components/motion";
import {
  answerScheduleQuestion,
  findConflicts,
  formatDate,
  formatTime,
} from "../domain/schedule";
import { newItem } from "../domain/seed";
import { useApp } from "../store/AppStore";
import { api, isNetworkError } from "../services/api";
import type { ChatAction } from "../domain/contract";
import type { StackProps } from "../navigation/types";
import { fonts, palette, useTheme } from "../theme";

type Message = {
  id: number;
  user: boolean;
  text: string;
  /** A suggestion to review; CalenBud never changes the schedule itself. */
  action?: ChatAction | null;
  note?: string;
  /** Set once the student has acted on the suggestion. */
  done?: string;
};
type Proposal = Exclude<ChatAction, { type: "show_conflicts" }>;
const when = (action: { date: string; start: string; end: string }) =>
  `${formatDate(action.date)}, ${formatTime(action.start)}–${formatTime(action.end)}`;
// Three softly pulsing dots, shown only while a reply is actually pending.
function TypingDots() {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    if (reduced) return;
    const animation = Animated.loop(
      Animated.stagger(
        120,
        dots.map((dot) =>
          Animated.sequence([
            Animated.timing(dot, {
              toValue: 1,
              duration: 260,
              easing: easing.enter,
              useNativeDriver: true,
            }),
            Animated.timing(dot, {
              toValue: 0.3,
              duration: 260,
              easing: easing.exit,
              useNativeDriver: true,
            }),
          ]),
        ),
      ),
    );
    animation.start();
    return () => animation.stop();
  }, [reduced, dots]);
  return (
    <View style={{ flexDirection: "row", gap: 4, marginLeft: 6 }}>
      {dots.map((opacity, n) => (
        <Animated.View
          key={n}
          style={{
            width: 5,
            height: 5,
            borderRadius: 3,
            backgroundColor: theme.muted,
            opacity: reduced ? 0.7 : opacity,
          }}
        />
      ))}
    </View>
  );
}
const prompts = [
  "What's on my schedule today?",
  "Find conflicts",
  "When am I free?",
  "What do I have tomorrow?",
  "Plan my week",
  "Optimize my schedule",
];
export function ChatScreen({ navigation }: StackProps<"Chat">) {
  const { data, account, saveItem, deleteItem } = useApp();
  const theme = useTheme();
  const inset = useSafeAreaInsets();
  const mounted = useRef(true);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0,
      user: false,
      text: "Hey! I'm CalenBud. I can answer questions about your schedule, add or remove things, and help fix conflicts. You always confirm before anything changes. What do you need?",
    },
  ]);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = useRef<TextInput>(null);
  useEffect(
    () => () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const local = (question: string) =>
    answerScheduleQuestion(
      question,
      data.items,
      data.availability,
      data.preferences,
    );
  const preview = (action: Extract<ChatAction, { type: "change_shift" }>) => {
    const shift = data.items.find((item) => item.id === action.shiftId);
    if (!shift) {
      Alert.alert(
        "Shift not found",
        "This shift is no longer on your schedule.",
      );
      return;
    }
    haptics.tap();
    navigation.navigate("ShiftImpact", {
      shift: {
        ...shift,
        date: action.date,
        start: action.start,
        end: action.end,
      },
    });
  };
  const markDone = (id: number, done: string) =>
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, done } : message,
      ),
    );
  const addItem = (
    message: Message,
    action: Extract<ChatAction, { type: "add_item" }>,
  ) => {
    const item = {
      ...newItem(action.kind, action.date),
      title: action.title,
      start: action.start,
      end: action.end,
      category: action.category,
      location: action.location,
    };
    const error = saveItem(item);
    if (error) {
      Alert.alert("Couldn't add this", error);
      return;
    }
    haptics.tap();
    markDone(message.id, "Added to your schedule");
    // Tell the student straight away if the new item collides with something.
    const clash = findConflicts(
      [...data.items, item],
      data.availability,
      data.preferences,
      action.date,
      1,
    ).find((c) => c.first.id === item.id || c.second?.id === item.id);
    if (clash)
      setMessages((current) => [
        ...current,
        {
          id: Date.now(),
          user: false,
          text: `Heads up: ${action.title} overlaps another commitment at that time. Want to sort it out?`,
          action: {
            type: "resolve_conflict",
            conflictId: clash.id,
            title: [clash.first.title, clash.second?.title]
              .filter(Boolean)
              .join(" and "),
          },
        },
      ]);
  };
  const removeItem = (
    message: Message,
    action: Extract<ChatAction, { type: "remove_item" }>,
  ) => {
    if (!data.items.some((item) => item.id === action.itemId)) {
      markDone(message.id, "Already removed");
      return;
    }
    Alert.alert(
      "Remove from your schedule?",
      `${action.title}\n${when(action)}`,
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            deleteItem(action.itemId);
            haptics.tap();
            markDone(message.id, "Removed from your schedule");
          },
        },
      ],
    );
  };
  const act = (message: Message, action: Proposal) => {
    if (action.type === "add_item") addItem(message, action);
    else if (action.type === "remove_item") removeItem(message, action);
    else if (action.type === "resolve_conflict") {
      haptics.tap();
      navigation.navigate("Resolve", { conflictId: action.conflictId });
    } else preview(action);
  };
  const send = async (question: string) => {
    if (!question.trim() || typing || !data.preferences.aiEnabled) return;
    const clean = question.trim();
    haptics.tap();
    const asked: Message = { id: Date.now(), user: true, text: clean };
    // The greeting is not part of the conversation sent to the server.
    const history = [...messages.slice(1), asked].slice(-10);
    setMessages((current) => [...current, asked]);
    setText("");
    setTyping(true);
    let reply: Message;
    if (account) {
      try {
        const result = await api.chat(
          history.map((m) => ({
            role: m.user ? ("user" as const) : ("assistant" as const),
            text: m.text.slice(0, 1500),
          })),
        );
        reply = {
          id: Date.now(),
          user: false,
          text: result.reply,
          action: result.action,
          note:
            result.source === "rules" &&
            result.fallbackReason === "AI_SERVICE_UNAVAILABLE"
              ? "AI is unavailable right now, so this answer uses ShiftSync's built-in rules."
              : undefined,
        };
      } catch (error) {
        reply = {
          id: Date.now(),
          user: false,
          text: local(clean),
          note: isNetworkError(error)
            ? "You're offline, so this answer uses the schedule saved on this phone."
            : undefined,
        };
      }
    } else {
      await new Promise((resolve) => {
        timer.current = setTimeout(resolve, 650);
      });
      reply = { id: Date.now(), user: false, text: local(clean) };
    }
    if (!mounted.current) return;
    setMessages((current) => [...current, reply]);
    setTyping(false);
  };
  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={{ paddingHorizontal: 24, paddingTop: 18 }}>
          <Header
            title="CalenBud"
            subtitle="Your AI scheduling buddy"
            back={navigation.goBack}
            right={<Buddy size={44} />}
          />
          <Badge>
            {account
              ? "Answers from your synced schedule"
              : "Local scheduling assistant"}
          </Badge>
        </View>
        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onContentSizeChange={() =>
            scroll.current?.scrollToEnd({ animated: true })
          }
          contentContainerStyle={{ padding: 24, gap: 18 }}
        >
          {messages.map((message) => (
            <FadeIn key={message.id}>
              <View
                style={{
                  alignSelf: message.user ? "flex-end" : "flex-start",
                  maxWidth: "92%",
                  backgroundColor: message.user
                    ? palette.navy
                    : theme.dark
                      ? "#25424A"
                      : "#DFF2ED",
                  borderRadius: 18,
                  borderBottomRightRadius: message.user ? 5 : 18,
                  borderBottomLeftRadius: message.user ? 18 : 5,
                  padding: 16,
                }}
              >
                <Label
                  style={{ color: message.user ? palette.ivory : theme.text }}
                >
                  {message.text}
                </Label>
                {message.note && (
                  <Label size={12} tone="muted" style={{ marginTop: 8 }}>
                    {message.note}
                  </Label>
                )}
                {message.action && message.action.type !== "show_conflicts" && (
                  <View style={{ marginTop: 12, gap: 8 }}>
                    {(message.action.type === "add_item" ||
                      message.action.type === "remove_item") && (
                      <Label size={13}>
                        {message.action.title}
                        {"\n"}
                        {when(message.action)}
                      </Label>
                    )}
                    {message.done ? (
                      <Badge>{message.done}</Badge>
                    ) : (
                      <Button
                        small
                        variant={
                          message.action.type === "remove_item"
                            ? "secondary"
                            : "primary"
                        }
                        icon={
                          message.action.type === "add_item"
                            ? "add-circle-outline"
                            : message.action.type === "remove_item"
                              ? "trash-outline"
                              : "time-outline"
                        }
                        onPress={() =>
                          message.action &&
                          message.action.type !== "show_conflicts" &&
                          act(message, message.action)
                        }
                      >
                        {message.action.type === "add_item"
                          ? "Add to my schedule"
                          : message.action.type === "remove_item"
                            ? "Remove from my schedule"
                            : message.action.type === "resolve_conflict"
                              ? "Resolve this conflict"
                              : "Preview Shift Change"}
                      </Button>
                    )}
                  </View>
                )}
                {!message.user &&
                  (!message.action || message.action.type === "show_conflicts") &&
                  (message.action?.type === "show_conflicts" ||
                    /conflict|issue|alternatives/i.test(message.text)) && (
                    <View style={{ marginTop: 12, gap: 8 }}>
                      <Button
                        small
                        onPress={() =>
                          navigation.navigate("Main", { screen: "Conflicts" })
                        }
                      >
                        Show Conflict
                      </Button>
                      <Button
                        small
                        variant="secondary"
                        onPress={() => send("When am I free?")}
                      >
                        Find a Better Time
                      </Button>
                    </View>
                  )}
              </View>
            </FadeIn>
          ))}
          {typing && (
            <FadeIn>
              <View
                accessibilityLiveRegion="polite"
                accessibilityLabel="CalenBud is thinking"
                style={{ flexDirection: "row", alignItems: "center" }}
              >
                <Label tone="muted">CalenBud is thinking</Label>
                <TypingDots />
              </View>
            </FadeIn>
          )}
        </ScrollView>
        {!data.preferences.aiEnabled ? (
          <View style={{ padding: 24 }}>
            <Label tone="muted">CalenBud is paused in your preferences.</Label>
            <Button
              variant="secondary"
              onPress={() =>
                navigation.navigate("Settings", { section: "AI Preferences" })
              }
            >
              Open AI Preferences
            </Button>
          </View>
        ) : (
          <View
            style={{
              paddingBottom: Math.max(inset.bottom, 16),
              borderTopWidth: 1,
              borderTopColor: theme.line,
            }}
          >
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: 24,
                paddingVertical: 12,
                gap: 8,
              }}
            >
              {prompts.map((prompt) => (
                <Button
                  key={prompt}
                  variant="secondary"
                  small
                  disabled={typing}
                  onPress={() => send(prompt)}
                >
                  {prompt}
                </Button>
              ))}
            </ScrollView>
            <View
              style={{
                flexDirection: "row",
                gap: 10,
                alignItems: "center",
                paddingHorizontal: 20,
              }}
            >
              <TextInput
                ref={input}
                accessibilityLabel="Message CalenBud"
                placeholder="Ask, or say 'add dentist tomorrow 3pm'…"
                placeholderTextColor={theme.muted}
                value={text}
                onChangeText={setText}
                onSubmitEditing={() => send(text)}
                returnKeyType="send"
                style={{
                  flex: 1,
                  minHeight: 52,
                  borderRadius: 16,
                  backgroundColor: theme.surface,
                  color: theme.text,
                  paddingHorizontal: 16,
                  fontFamily: fonts.regular,
                  fontSize: 14,
                }}
                maxLength={1000}
              />
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Send message"
                accessibilityState={{ disabled: typing || !text.trim() }}
                disabled={typing || !text.trim()}
                onPress={() => send(text)}
                scaleTo={0.9}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 16,
                  backgroundColor: palette.teal,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: typing || !text.trim() ? 0.4 : 1,
                }}
              >
                <Icon name="arrow-up" color={palette.navy} size={26} />
              </PressableScale>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
