import React, { useRef, useState } from "react";
import { PanResponder, View } from "react-native";
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
import { palette } from "../theme";

export function OnboardingScreen() {
  const {
    data,
    setProfile,
    setAvailability,
    setPreferences,
    finishOnboarding,
  } = useApp();
  const [step, setStep] = useState(0);
  const [met, setMet] = useState(false);
  const stepRef = useRef(step);
  stepRef.current = step;
  const gesture = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 35 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > 80)
          setStep(
            Math.max(0, Math.min(3, stepRef.current + (g.dx < 0 ? 1 : -1))),
          );
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
          <Button
            onPress={() =>
              step === 3 ? finishOnboarding() : setStep((value) => value + 1)
            }
          >
            {step === 3 ? "Go to ShiftSync" : "Continue"}
          </Button>
          {step > 0 && (
            <Button
              variant="ghost"
              onPress={() => setStep((value) => value - 1)}
            >
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
          <View
            key={n}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: n <= step ? palette.teal : palette.beige,
            }}
          />
        ))}
      </View>
      <View {...gesture.panHandlers}>
        <Label size={12} tone="muted">
          STEP {step + 1} OF 4
        </Label>
        <Header title={titles[step]} />
        {step === 0 && (
          <>
            <Label size={17} weight="medium" style={{ marginBottom: 18 }}>
              How do you use ShiftSync?
            </Label>
            {["Student", "Employee", "Manager", "Freelancer", "Other"].map(
              (role) => (
                <Choice
                  key={role}
                  label={role}
                  selected={data.profile?.role === role}
                  onPress={() => {
                    if (data.profile) setProfile({ ...data.profile, role });
                  }}
                />
              ),
            )}
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
      </View>
    </Screen>
  );
}
