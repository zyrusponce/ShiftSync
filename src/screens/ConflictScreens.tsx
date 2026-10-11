import React from "react";
import { Alert, View } from "react-native";
import {
  Badge,
  Buddy,
  Button,
  Card,
  Empty,
  Header,
  Label,
  Screen,
} from "../components/ui";
import {
  dateKey,
  findConflicts,
  formatDate,
  formatTime,
  rescheduleOccurrence,
  suggestSlots,
} from "../domain/schedule";
import { animateLayout, haptics } from "../components/motion";
import { newItem } from "../domain/seed";
import { useApp } from "../store/AppStore";
import { useRootNavigation, type StackProps } from "../navigation/types";
import { palette } from "../theme";
import type { ScheduleItem, Slot } from "../domain/types";

export function ConflictsScreen() {
  const { data, ignoreConflict } = useApp();
  const navigation = useRootNavigation();
  const conflicts = findConflicts(
    data.items,
    data.availability,
    data.preferences,
    dateKey(),
  ).filter((conflict) => !data.ignoredConflicts.includes(conflict.id));
  return (
    <Screen style={{ paddingBottom: data.preferences.aiEnabled ? 95 : 28 }}>
      <Header
        title="Schedule Conflicts"
        subtitle="Let's get your schedule back in sync."
      />
      {conflicts.length ? (
        <>
          <Label tone="muted" style={{ marginBottom: 16 }}>
            {conflicts.length} issue{conflicts.length === 1 ? "" : "s"} in the
            next two weeks
          </Label>
          {conflicts.map((conflict) => (
            <Card key={conflict.id}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <Badge
                  color={
                    conflict.severity === "High" ? palette.gold : palette.aqua
                  }
                >{`${conflict.severity} · ${conflict.severity === "High" ? "Overlap" : conflict.severity === "Medium" ? "Short gap" : "Availability"}`}</Badge>
                <Label size={12} tone="muted">
                  {formatDate(conflict.date, true)}
                </Label>
              </View>
              <View style={{ marginVertical: 16 }}>
                <Label size={16} weight="semibold">
                  {conflict.first.title}
                </Label>
                <Label size={13} tone="muted">
                  {formatTime(conflict.first.start)} –{" "}
                  {formatTime(conflict.first.end)}
                </Label>
                {conflict.second && (
                  <View style={{ marginTop: 12 }}>
                    <Label size={16} weight="semibold">
                      {conflict.second.title}
                    </Label>
                    <Label size={13} tone="muted">
                      {formatTime(conflict.second.start)} –{" "}
                      {formatTime(conflict.second.end)}
                    </Label>
                  </View>
                )}
              </View>
              <Label style={{ marginBottom: 16 }}>{conflict.reason}</Label>
              <Button
                onPress={() =>
                  navigation.navigate("Resolve", { conflictId: conflict.id })
                }
              >
                Resolve Conflict
              </Button>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                <Button
                  variant="ghost"
                  small
                  onPress={() =>
                    navigation.navigate("ItemEditor", { id: conflict.first.id })
                  }
                >
                  Edit Event
                </Button>
                <Button
                  variant="ghost"
                  small
                  onPress={() => {
                    animateLayout();
                    haptics.tap();
                    ignoreConflict(conflict.id);
                  }}
                >
                  Ignore
                </Button>
              </View>
            </Card>
          ))}
        </>
      ) : (
        <Empty
          icon="checkmark-circle-outline"
          title="You're all in sync!"
          description="No scheduling conflicts were found."
        />
      )}
      {data.preferences.aiEnabled && data.preferences.conflictSuggestions && (
        <Button
          variant="secondary"
          icon="sparkles-outline"
          onPress={() => navigation.navigate("Chat")}
        >
          Ask CalenBud to Fix
        </Button>
      )}
    </Screen>
  );
}
export function ResolveScreen({ route, navigation }: StackProps<"Resolve">) {
  const { data, moveOccurrence, ignoreConflict } = useApp();
  const today = dateKey();
  const conflictDate = route.params.conflictId.split(":")[0];
  const from = conflictDate > today ? conflictDate : today;
  const conflict = findConflicts(
    data.items,
    data.availability,
    data.preferences,
    from,
  ).find((value) => value.id === route.params.conflictId);
  if (!conflict)
    return (
      <Screen>
        <Header title="All in sync" back={navigation.goBack} />
        <Empty
          title="This conflict is resolved."
          action="Go Back"
          onPress={navigation.goBack}
        />
      </Screen>
    );
  const movable = [conflict.second, conflict.first].filter(
    (item): item is ScheduleItem => !!item && item.kind !== "unavailable",
  );
  const options = movable.flatMap((item) => {
    const remaining = data.items.map((value) =>
      value.id === item.id
        ? { ...value, exceptions: [...(value.exceptions ?? []), conflict.date] }
        : value,
    );
    const proposal = {
      ...item,
      id: `${item.id}-proposal`,
      date: conflict.date,
      repeat: "Never" as const,
    };
    return suggestSlots(
      proposal,
      remaining,
      data.availability,
      data.preferences,
      conflict.date,
      movable.length === 1 ? 3 : 1,
    ).map((slot) => ({ item, slot }));
  });
  const apply = (item: ScheduleItem, slot: Slot) =>
    Alert.alert(
      `Move ${item.title}?`,
      `${formatDate(slot.date)}\n${formatTime(slot.start)} – ${formatTime(slot.end)}${item.repeat !== "Never" ? `\nOnly the ${formatDate(conflict.date, true)} occurrence moves. The rest of the series stays.` : ""}`,
      [
        { text: "Keep Current Time", style: "cancel" },
        {
          text: "Move Event",
          onPress: () => {
            const current = data.items.find((value) => value.id === item.id);
            if (!current) {
              haptics.warning();
              Alert.alert(
                "Event removed",
                "This event is no longer on your schedule.",
              );
              return;
            }
            if (new Date(`${slot.date}T${slot.start}:00`) < new Date()) {
              haptics.warning();
              Alert.alert(
                "That time has passed",
                "Choose another suggested time.",
              );
              return;
            }
            try {
              const proposedId = newItem().id;
              const proposed = rescheduleOccurrence(
                data.items,
                current.id,
                conflict.date,
                slot,
                proposedId,
              );
              const movedId =
                current.repeat === "Never" ? current.id : proposedId;
              const issues = findConflicts(
                proposed,
                data.availability,
                data.preferences,
                slot.date,
                1,
              ).filter(
                (value) =>
                  value.first.id === movedId || value.second?.id === movedId,
              );
              if (issues.length) {
                haptics.warning();
                Alert.alert(
                  "This time needs another look",
                  "That time conflicts with your schedule. Please choose another option or edit the event.",
                );
                return;
              }
              moveOccurrence(current.id, conflict.date, slot);
              haptics.success();
              navigation.goBack();
            } catch (error) {
              haptics.error();
              Alert.alert(
                "Check this event",
                error instanceof Error ? error.message : "Please try again.",
              );
            }
          },
        },
      ],
    );
  return (
    <Screen>
      <Header
        title="Find a better fit"
        subtitle="A little breathing room for your schedule."
        back={navigation.goBack}
      />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 18,
          marginBottom: 24,
        }}
      >
        <Buddy />
        <View style={{ flex: 1 }}>
          <Label weight="semibold">
            {data.preferences.aiEnabled
              ? "CalenBud’s suggestions"
              : "Available alternatives"}
          </Label>
          <Label tone="muted">
            {options.length
              ? `I found ${options.length} possible time${options.length === 1 ? "" : "s"}. You decide what works.`
              : "No suitable times found. Try updating your availability."}
          </Label>
        </View>
      </View>
      <Card>
        <Label weight="semibold">
          {conflict.first.title}
          {conflict.second ? ` + ${conflict.second.title}` : ""}
        </Label>
        <Label style={{ marginTop: 8 }} tone="muted">
          {conflict.reason}
        </Label>
      </Card>
      {options.map(({ item, slot }) => (
        <Card key={`${item.id}-${slot.date}-${slot.start}`}>
          <Badge>Suggestion</Badge>
          <Label
            size={17}
            weight="semibold"
            style={{ marginTop: 12 }}
          >{`Move ${item.title}`}</Label>
          <Label tone="muted">{formatDate(slot.date)}</Label>
          <Label tone="muted">
            {formatTime(slot.start)} – {formatTime(slot.end)}
          </Label>
          <Label
            size={12}
            tone="muted"
            style={{ marginTop: 10, marginBottom: 14 }}
          >
            Fits your availability, event duration, and current commitments.
          </Label>
          <Button onPress={() => apply(item, slot)}>Choose this time</Button>
        </Card>
      ))}
      <Button
        variant="secondary"
        onPress={() =>
          navigation.navigate("ItemEditor", {
            id: movable[0]?.id ?? conflict.first.id,
          })
        }
      >
        Edit Event
      </Button>
      <View style={{ marginTop: 12 }}>
        <Button
          variant="ghost"
          onPress={() => {
            haptics.tap();
            ignoreConflict(conflict.id);
            navigation.goBack();
          }}
        >
          Keep Both · Ignore Conflict
        </Button>
      </View>
    </Screen>
  );
}
