import React, { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import type { ExplainResponse } from "../domain/contract";
import { messageOf } from "../services/api";
import { palette, useTheme } from "../theme";
import { FadeIn, haptics } from "./motion";
import { Badge, Buddy, Button, Card, Label } from "./ui";

const fallbackNote: Record<string, string> = {
  AI_SERVICE_UNAVAILABLE:
    "CalenBud's AI isn't available right now, so this is the standard explanation.",
  AI_OUTPUT_REJECTED:
    "The AI answer didn't match your schedule exactly, so this is the standard explanation.",
  AI_DISABLED:
    "AI is turned off in your preferences, so this is the standard explanation.",
};

/** Plain-language explanation of verified scheduling facts, on request. */
export function ExplainCard({
  load,
  title = "What does this mean?",
}: {
  load: () => Promise<ExplainResponse>;
  title?: string;
}) {
  const theme = useTheme();
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "done"; result: ExplainResponse }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const run = async () => {
    haptics.tap();
    setState({ status: "loading" });
    try {
      setState({ status: "done", result: await load() });
    } catch (error) {
      setState({ status: "error", message: messageOf(error) });
    }
  };
  return (
    <Card
      style={{
        backgroundColor: theme.dark ? "#253D46" : "#DFF1EA",
        borderColor: theme.dark ? "#3A5961" : "#BCD9D2",
      }}
    >
      <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
        <Buddy size={40} />
        <View style={{ flex: 1 }}>
          <Label weight="semibold">{title}</Label>
          <Label size={12} tone="muted">
            CalenBud explains; your schedule rules decide.
          </Label>
        </View>
      </View>
      {state.status === "idle" && (
        <View style={{ marginTop: 14 }}>
          <Button
            small
            variant="secondary"
            icon="sparkles-outline"
            onPress={run}
          >
            Explain with CalenBud
          </Button>
        </View>
      )}
      {state.status === "loading" && (
        <View
          accessibilityLiveRegion="polite"
          style={{
            flexDirection: "row",
            gap: 10,
            marginTop: 14,
            alignItems: "center",
          }}
        >
          <ActivityIndicator color={palette.teal} />
          <Label tone="muted">CalenBud is thinking…</Label>
        </View>
      )}
      {state.status === "done" && (
        <FadeIn style={{ marginTop: 14, gap: 8 }}>
          <Badge
            color={state.result.source === "ai" ? palette.aqua : palette.beige}
          >
            {state.result.source === "ai"
              ? "Written by CalenBud (AI)"
              : "Standard explanation"}
          </Badge>
          <View accessibilityLiveRegion="polite">
            <Label>{state.result.text}</Label>
          </View>
          {state.result.fallbackReason &&
            fallbackNote[state.result.fallbackReason] && (
              <Label size={12} tone="muted">
                {fallbackNote[state.result.fallbackReason]}
              </Label>
            )}
        </FadeIn>
      )}
      {state.status === "error" && (
        <View style={{ marginTop: 14, gap: 8 }}>
          <Label size={13}>{state.message}</Label>
          <Button small variant="ghost" onPress={run}>
            Try again
          </Button>
        </View>
      )}
    </Card>
  );
}
