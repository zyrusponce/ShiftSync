import React, { useState } from "react";
import {
  Empty,
  Header,
  IconButton,
  Label,
  Screen,
  Segments,
} from "../components/ui";
import { ItemCard } from "../components/ItemCard";
import { useApp } from "../store/AppStore";
import { useRootNavigation } from "../navigation/types";
import { palette } from "../theme";
import { addDays, dateKey, listShiftOccurrences } from "../domain/schedule";

export function ShiftsScreen() {
  const { data } = useApp();
  const navigation = useRootNavigation();
  const [tab, setTab] = useState<"Upcoming" | "Open" | "Completed">("Upcoming");
  const now = new Date();
  const today = dateKey(now);
  const oneTime = data.items
    .filter(
      (item) =>
        item.kind === "shift" &&
        (item.repeat === "Never" || item.status === "Cancelled"),
    )
    .map((item) => ({ item, date: item.date }));
  const recurring = listShiftOccurrences(
    data.items.filter(
      (item) => item.repeat !== "Never" && item.status !== "Cancelled",
    ),
    addDays(today, -30),
    45,
  );
  const shifts = [...oneTime, ...recurring]
    .filter(({ item, date }) => {
      const ended = new Date(`${date}T${item.end}:00`) < now;
      return tab === "Completed"
        ? ended || item.status === "Cancelled"
        : tab === "Open"
          ? item.status === "Open" && !ended
          : item.status === "Confirmed" && !ended;
    })
    .sort((a, b) =>
      tab === "Completed"
        ? b.date.localeCompare(a.date) ||
          b.item.start.localeCompare(a.item.start)
        : a.date.localeCompare(b.date) ||
          a.item.start.localeCompare(b.item.start),
    );
  return (
    <Screen style={{ paddingBottom: data.preferences.aiEnabled ? 95 : 28 }}>
      <Header
        title="My Shifts"
        subtitle="Your work week, a little more organized."
        right={
          <IconButton
            icon="add"
            label="Add shift"
            background={palette.teal}
            onPress={() => navigation.navigate("ItemEditor", { kind: "shift" })}
          />
        }
      />
      <Segments
        options={["Upcoming", "Open", "Completed"] as const}
        value={tab}
        onChange={setTab}
      />
      {tab === "Open" && (
        <Label size={12} tone="muted" style={{ marginBottom: 16 }}>
          Open shifts are stored locally. Team scheduling needs an organization
          connection.
        </Label>
      )}
      {recurring.length > 0 && (
        <Label size={12} tone="muted" style={{ marginBottom: 12 }}>
          {tab === "Completed"
            ? "Recurring shifts from the last 30 days."
            : "Recurring shifts for the next two weeks."}
        </Label>
      )}
      {shifts.length ? (
        shifts.map(({ item, date }) => (
          <ItemCard
            key={`${item.id}-${date}`}
            item={item}
            date={date}
            showDate
          />
        ))
      ) : (
        <Empty
          icon="time-outline"
          title="No shifts scheduled."
          description={`Your ${tab.toLowerCase()} shifts will appear here.`}
          action="Add Shift"
          onPress={() => navigation.navigate("ItemEditor", { kind: "shift" })}
        />
      )}
    </Screen>
  );
}
