import React from "react";
import { ScrollView, View } from "react-native";
import { PressableScale } from "../components/motion";
import {
  Badge,
  Buddy,
  Button,
  Card,
  Empty,
  Header,
  Icon,
  IconButton,
  Label,
  Screen,
  Section,
} from "../components/ui";
import { ItemCard } from "../components/ItemCard";
import {
  addDays,
  dateKey,
  findConflicts,
  formatDate,
  itemsOnDate,
} from "../domain/schedule";
import { useApp } from "../store/AppStore";
import { useRootNavigation } from "../navigation/types";
import { palette, useTheme } from "../theme";

export function HomeScreen() {
  const { data } = useApp();
  const navigation = useRootNavigation();
  const theme = useTheme();
  const today = dateKey();
  const dayItems = itemsOnDate(data.items, today).filter(
    (item) => !item.completed && item.kind !== "unavailable",
  );
  const conflicts = findConflicts(
    data.items,
    data.availability,
    data.preferences,
    today,
    7,
  ).filter(
    (conflict) =>
      !data.ignoredConflicts.includes(conflict.id) &&
      data.conflictStatus[conflict.id] !== "resolved",
  );
  const upcoming = Array.from({ length: 7 }, (_, n) => addDays(today, n + 1))
    .flatMap((date) =>
      itemsOnDate(data.items, date)
        .filter((item) => !item.completed && item.kind !== "unavailable")
        .map((item) => ({ item, date })),
    )
    .slice(0, 3);
  const weekCount = Array.from(
    { length: 7 },
    (_, n) =>
      itemsOnDate(data.items, addDays(today, n)).filter(
        (item) => !item.completed && item.kind !== "unavailable",
      ).length,
  ).reduce((a, b) => a + b, 0);
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = data.profile?.name.split(" ")[0] || "friend";
  return (
    <Screen style={{ paddingBottom: data.preferences.aiEnabled ? 95 : 28 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <Badge color={theme.soft}>{formatDate(today, true)}</Badge>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <IconButton
            icon="notifications-outline"
            label="Notifications"
            dot={conflicts.length > 0}
            onPress={() => navigation.navigate("Notifications")}
          />
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Open profile"
            onPress={() => navigation.navigate("Profile")}
            throttle={400}
            scaleTo={0.92}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: palette.beige,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Label weight="semibold" style={{ color: palette.navy }}>
              {name[0].toUpperCase()}
            </Label>
          </PressableScale>
        </View>
      </View>
      <Header
        title={`${greeting},\n${name}.`}
        subtitle="Here's what's happening today."
        right={
          <IconButton
            icon="search-outline"
            label="Search schedule"
            onPress={() => navigation.navigate("Search")}
          />
        }
      />
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Card style={{ flex: 1, marginBottom: 0 }}>
          <Icon name="calendar-outline" color={palette.teal} />
          <Label size={28} weight="bold" style={{ marginTop: 8 }}>
            {weekCount}
          </Label>
          <Label size={12} tone="muted">
            Events this week
          </Label>
        </Card>
        <Card
          onPress={() => navigation.navigate("Main", { screen: "Conflicts" })}
          style={{
            flex: 1,
            marginBottom: 0,
            backgroundColor: theme.dark ? theme.surface : "#F5E0BE",
          }}
          label={`${conflicts.length} scheduling issues`}
        >
          <Icon
            name={
              conflicts.length
                ? "alert-circle-outline"
                : "checkmark-circle-outline"
            }
          />
          <Label size={28} weight="bold" style={{ marginTop: 8 }}>
            {conflicts.length}
          </Label>
          <Label size={12} tone="muted">
            {conflicts.length ? "Need attention" : "All in sync"}
          </Label>
        </Card>
      </View>
      {data.preferences.aiEnabled && (
        <Card
          style={{
            marginTop: 24,
            backgroundColor: theme.dark ? "#253D46" : "#DFF1EA",
            borderColor: theme.dark ? "#3A5961" : "#BCD9D2",
            padding: 20,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              gap: 16,
              alignItems: "center",
              marginBottom: 14,
            }}
          >
            <Buddy size={54} />
            <View style={{ flex: 1 }}>
              <Label size={17} weight="semibold">
                A little help, a little calm.
              </Label>
              <Label size={12} tone="muted">
                Your scheduling buddy, CalenBud
              </Label>
            </View>
          </View>
          <Label size={14}>
            {conflicts.length
              ? `I spotted ${conflicts.length} possible scheduling issue${conflicts.length === 1 ? "" : "s"} this week. Let's find a little breathing room.`
              : "Your schedule looks good. Want a hand planning the rest of your week?"}
          </Label>
          <View style={{ gap: 8, marginTop: 16 }}>
            <Button onPress={() => navigation.navigate("Chat")}>
              Ask CalenBud
            </Button>
            <Button
              variant="ghost"
              onPress={() =>
                navigation.navigate("Main", { screen: "Conflicts" })
              }
            >
              Check Schedule
            </Button>
          </View>
        </Card>
      )}
      <Section
        title="Today's schedule"
        action="Calendar"
        onPress={() => navigation.navigate("Main", { screen: "Calendar" })}
      />
      {dayItems.length ? (
        dayItems.map((item) => (
          <View key={item.id}>
            <ItemCard item={item} date={today} />
          </View>
        ))
      ) : (
        <Empty
          title="Your calendar is clear!"
          description="You don't have any events scheduled today."
          action="Add Your First Event"
          onPress={() => navigation.navigate("ItemEditor", { date: today })}
        />
      )}
      <Section title="Make room for what matters" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingBottom: 8 }}
      >
        <Button
          small
          icon="add-circle-outline"
          variant="secondary"
          onPress={() => navigation.navigate("ItemEditor", { kind: "event" })}
        >
          Add Event
        </Button>
        <Button
          small
          icon="time-outline"
          variant="secondary"
          onPress={() => navigation.navigate("ItemEditor", { kind: "shift" })}
        >
          Add Shift
        </Button>
        <Button
          small
          icon="checkmark-outline"
          variant="secondary"
          onPress={() => navigation.navigate("ItemEditor", { kind: "task" })}
        >
          Add Task
        </Button>
        <Button
          small
          icon="sunny-outline"
          variant="secondary"
          onPress={() => navigation.navigate("Availability")}
        >
          Availability
        </Button>
      </ScrollView>
      <Section title="Coming up" />
      {upcoming.length ? (
        upcoming.map(({ item, date }) => (
          <ItemCard
            key={`${date}-${item.id}`}
            item={item}
            date={date}
            showDate
          />
        ))
      ) : (
        <Label tone="muted">
          Nothing coming up. Enjoy a little open space.
        </Label>
      )}
      <Button
        variant="ghost"
        icon="checkbox-outline"
        onPress={() => navigation.navigate("Tasks")}
      >
        Open your tasks
      </Button>
    </Screen>
  );
}
