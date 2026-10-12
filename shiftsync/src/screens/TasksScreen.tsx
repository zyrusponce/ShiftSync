import React, { useState } from "react";
import {
  Header,
  IconButton,
  Screen,
  Segments,
  Empty,
  Label,
} from "../components/ui";
import { ItemCard } from "../components/ItemCard";
import { useApp } from "../store/AppStore";
import { dateKey, listTaskOccurrences } from "../domain/schedule";
import type { StackProps } from "../navigation/types";
import { palette } from "../theme";

export function TasksScreen({ navigation }: StackProps<"Tasks">) {
  const { data } = useApp();
  const [tab, setTab] = useState<"Today" | "Upcoming" | "Completed">("Today");
  const today = dateKey();
  const tasks = listTaskOccurrences(data.items, today, tab);
  return (
    <Screen>
      <Header
        title="Your tasks"
        subtitle="One small step at a time."
        back={navigation.goBack}
        right={
          <IconButton
            icon="add"
            label="Add task"
            background={palette.teal}
            onPress={() => navigation.navigate("ItemEditor", { kind: "task" })}
          />
        }
      />
      <Segments
        options={["Today", "Upcoming", "Completed"] as const}
        value={tab}
        onChange={setTab}
      />
      {tab === "Upcoming" && (
        <Label size={12} tone="muted" style={{ marginBottom: 16 }}>
          Recurring tasks are shown for the next two weeks.
        </Label>
      )}
      {tasks.length ? (
        <>
          <Label size={12} tone="muted" style={{ marginBottom: 16 }}>
            Tap the checkmark or swipe a task to complete it.
          </Label>
          {tasks.map(({ item, date }) => (
            <ItemCard
              key={`${item.id}:${date}`}
              item={item}
              date={date}
              showDate
            />
          ))}
        </>
      ) : (
        <Empty
          icon="checkbox-outline"
          title={
            tab === "Completed"
              ? "A fresh start."
              : "Nothing on your to-do list yet."
          }
          description={
            tab === "Completed"
              ? "Completed tasks will appear here."
              : `No ${tab.toLowerCase()} tasks. Add one when you're ready.`
          }
          action="Add Task"
          onPress={() => navigation.navigate("ItemEditor", { kind: "task" })}
        />
      )}
    </Screen>
  );
}
