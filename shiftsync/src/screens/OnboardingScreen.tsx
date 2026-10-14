import React, { useEffect, useRef, useState } from "react";
import { Animated, PanResponder, View } from "react-native";
import {
  FadeIn,
  durations,
  easing,
  haptics,
  useEntrance,
  useReducedMotion,
} from "../components/motion";
import {
  Brand,
  Buddy,
  Button,
  Card,
  Choice,
  Header,
  Label,
  Screen,
} from "../components/ui";
import { AvailabilityEditor } from "./AvailabilityScreen";
import { useApp } from "../store/AppStore";
import { PROFILE_ROLES } from "../domain/persistence";
import { palette, useTheme } from "../theme";

export function OnboardingScreen() {
  const theme = useTheme();
  const {
    data,
    setProfile,
    setAvailability,
    setPreferences,
    setOnboardingStep,
    finishOnboarding,
  } = useApp();
  // Resume where this device left off if the app closed mid-way.
  const [step, setStep] = useState(data.onboardingStep ?? 0);
  const [met, setMet] = useState(false);
  const [rolesMissed, setRolesMissed] = useState(false);
  const roles = data.profile?.roles ?? [];
  useEffect(() => setOnboardingStep(step), [step, setOnboardingStep]);
  /** Moves to a step; leaving step 1 needs at least one role chosen. */
  const goTo = (next: number) => {
    const target = Math.max(0, Math.min(3, next));
    if (step === 0 && target > 0 && !roles.length) {
      haptics.error();
      setRolesMissed(true);
      return;
    }
    setStep(target);
  };
  // The swipe handler is created once, so it reads the latest step through this.
  const swipe = useRef((_delta: number) => {});
  swipe.current = (delta) => goTo(step + delta);
  const toggleRole = (role: string) => {
    if (!data.profile) return;
    const next = roles.includes(role)
      ? roles.filter((value) => value !== role)
      : [...roles, role];
    // Kept in the same order as the options, however they were tapped.
    setProfile({
      ...data.profile,
      roles: PROFILE_ROLES.filter((value) => next.includes(value)),
    });
    if (next.length) setRolesMissed(false);
  };
  const stepRef = useRef(step);
  // Content enters from the side the user is moving toward.
  const direction = useRef(1);
  if (step !== stepRef.current)
    direction.current = step > stepRef.current ? 1 : -1;
  stepRef.current = step;
  const stepMotion = useEntrance(step, {
    axis: "x",
    distance: 16,
    direction: direction.current,
    duration: durations.navigation,
    // A short glide, not a fade: the new step is readable immediately.
    fromOpacity: 1,
    onMount: false,
  });
  const gesture = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 35 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > 80) swipe.current(g.dx < 0 ? 1 : -1);
      },
    }),
  ).current;
  const titles = [
    "A little about you",
    "Your time, your terms",
    "Find your rhythm",
    "Meet your new buddy",
  ];
  const preferences = data.preferences;
  return (
    <Screen
      footer={
        <View style={{ gap: 8 }}>
          {step === 0 && rolesMissed ? (
            <FadeIn trigger={rolesMissed}>
              <Label size={13} style={{ color: theme.danger }}>
                Choose at least one option to continue.
              </Label>
            </FadeIn>
          ) : null}
          <Button
            onPress={() => (step === 3 ? finishOnboarding() : goTo(step + 1))}
          >
            {step === 3 ? "Go to ShiftSync" : "Continue"}
          </Button>
          {step > 0 && (
            <Button variant="ghost" onPress={() => goTo(step - 1)}>
              Back
            </Button>
          )}
        </View>
      }
    >
      <Brand />
      <View
        style={{
          flexDirection: "row",
          gap: 8,
          marginTop: 26,
          marginBottom: 26,
        }}
      >
        {[0, 1, 2, 3].map((n) => (
          <ProgressSegment key={n} filled={n <= step} />
        ))}
      </View>
      <Animated.View {...gesture.panHandlers} style={stepMotion}>
        <Label size={12} tone="muted">
          STEP {step + 1} OF 4
        </Label>
        <Header title={titles[step]} />
        {step === 0 && (
          <>
            <Label size={17} weight="medium">
              How do you use ShiftSync?
            </Label>
            <Label tone="muted" size={13} style={{ marginBottom: 18 }}>
              Select all that apply.
            </Label>
            {PROFILE_ROLES.map((role) => (
              <Choice
                key={role}
                label={role}
                selected={roles.includes(role)}
                onPress={() => toggleRole(role)}
              />
            ))}
          </>
        )}
        {step === 1 && (
          <>
            <Label tone="muted" style={{ marginBottom: 18 }}>
              Select your available days and tap a day to set its hours. You can
              change this anytime.
            </Label>
            <AvailabilityEditor
              value={data.availability}
              onChange={setAvailability}
            />
          </>
        )}
        {step === 2 && (
          <>
            <Choice
              label="Avoid overlapping events"
              selected={preferences.avoidOverlaps}
              onPress={() =>
                setPreferences({ avoidOverlaps: !preferences.avoidOverlaps })
              }
            />
            <Choice
              label="Avoid back-to-back events"
              selected={preferences.avoidBackToBack}
              onPress={() =>
                setPreferences({
                  avoidBackToBack: !preferences.avoidBackToBack,
                })
              }
            />
            <Choice
              label="Prefer morning schedules"
              selected={preferences.preferredPeriod === "Morning"}
              onPress={() =>
                setPreferences({
                  preferredPeriod:
                    preferences.preferredPeriod === "Morning"
                      ? "Any"
                      : "Morning",
                })
              }
            />
            <Choice
              label="Prefer evening schedules"
              selected={preferences.preferredPeriod === "Evening"}
              onPress={() =>
                setPreferences({
                  preferredPeriod:
                    preferences.preferredPeriod === "Evening"
                      ? "Any"
                      : "Evening",
                })
              }
            />
            <Choice
              label="Add buffer time between events"
              detail="Leave a 15-minute gap."
              selected={preferences.bufferMinutes > 0}
              onPress={() =>
                setPreferences({
                  bufferMinutes: preferences.bufferMinutes ? 0 : 15,
                })
              }
            />
          </>
        )}
        {step === 3 && (
          <View style={{ alignItems: "center", gap: 24, paddingVertical: 22 }}>
            <Buddy size={120} />
            <Label size={25} weight="bold">
              Hi! I'm CalenBud 👋
            </Label>
            <Label tone="muted" style={{ textAlign: "center" }}>
              I'll help you keep your schedule organized and spot conflicts
              before they become problems.
            </Label>
            <Card style={{ width: "100%" }}>
              <Label>
                {met
                  ? "You are always in charge. I suggest available times, explain conflicts, and wait for your confirmation before anything changes."
                  : "A friendly extra pair of eyes on your calendar. In this demo, I use local rules to check your saved schedule."}
              </Label>
            </Card>
            <Button variant="secondary" onPress={() => setMet(true)}>
              Meet CalenBud
            </Button>
          </View>
        )}
      </Animated.View>
    </Screen>
  );
}
function ProgressSegment({ filled }: { filled: boolean }) {
  const reduced = useReducedMotion();
  const fill = useRef(new Animated.Value(filled ? 1 : 0)).current;
  useEffect(() => {
    const animation = Animated.timing(fill, {
      toValue: filled ? 1 : 0,
      duration: reduced ? 0 : durations.component,
      easing: filled ? easing.enter : easing.exit,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [filled, reduced, fill]);
  return (
    <View
      style={{
        flex: 1,
        height: 4,
        borderRadius: 2,
        backgroundColor: palette.beige,
        overflow: "hidden",
      }}
    >
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: palette.teal,
          transformOrigin: "left",
          transform: [{ scaleX: fill }],
        }}
      />
    </View>
  );
}
