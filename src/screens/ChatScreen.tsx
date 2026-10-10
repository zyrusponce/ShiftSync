import React, { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Badge, Buddy, Button, Header, Icon, Label } from "../components/ui";
import { answerScheduleQuestion } from "../domain/schedule";
import { useApp } from "../store/AppStore";
import type { StackProps } from "../navigation/types";
import { fonts, palette, useTheme } from "../theme";

type Message = { id: number; user: boolean; text: string };
const prompts = [
  "What's on my schedule today?",
  "Find conflicts",
  "When am I free?",
  "What do I have tomorrow?",
  "Plan my week",
  "Optimize my schedule",
];
export function ChatScreen({ navigation }: StackProps<"Chat">) {
  const { data } = useApp();
  const theme = useTheme();
  const inset = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0,
      user: false,
      text: "Hey! I'm CalenBud. I can help you understand your schedule, spot conflicts, and find a little breathing room. What would you like to check?",
    },
  ]);
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const input = useRef<TextInput>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const send = (question: string) => {
    if (!question.trim() || typing || !data.preferences.aiEnabled) return;
    const clean = question.trim();
    setMessages((current) => [
      ...current,
      { id: Date.now(), user: true, text: clean },
    ]);
    setText("");
    setTyping(true);
    const reply = answerScheduleQuestion(
      clean,
      data.items,
      data.availability,
      data.preferences,
    );
    timer.current = setTimeout(() => {
      setMessages((current) => [
        ...current,
        { id: Date.now(), user: false, text: reply },
      ]);
      setTyping(false);
    }, 650);
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
          <Badge>Local scheduling assistant</Badge>
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
            <View
              key={message.id}
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
              {!message.user &&
                /conflict|issue|alternatives/i.test(message.text) && (
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
          ))}
          {typing && (
            <View accessibilityLiveRegion="polite">
              <Label tone="muted">CalenBud is thinking · · ·</Label>
            </View>
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
                placeholder="Ask about your schedule…"
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                accessibilityState={{ disabled: typing || !text.trim() }}
                disabled={typing || !text.trim()}
                onPress={() => send(text)}
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
              </Pressable>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
