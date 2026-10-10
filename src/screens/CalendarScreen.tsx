import React, { useState } from "react";
import { Pressable, View } from "react-native";
import {
  Button,
  Choice,
  Empty,
  Header,
  IconButton,
  Label,
  Screen,
  Section,
  Segments,
  Sheet,
} from "../components/ui";
import { ItemCard, categoryColor } from "../components/ItemCard";
import {
  addDays,
  dateKey,
  formatDate,
  itemsOnDate,
  parseDate,
} from "../domain/schedule";
import { useApp } from "../store/AppStore";
import { useRootNavigation } from "../navigation/types";
import { palette, useTheme } from "../theme";
import type { CalendarView, ScheduleItem } from "../domain/types";

const filters = [
  "All",
  "Work",
  "Personal",
  "Shifts",
  "Tasks",
  "Important",
] as const;
export function CalendarScreen() {
  const { data } = useApp();
  const navigation = useRootNavigation();
  const theme = useTheme();
  const [selected, setSelected] = useState(dateKey());
  const [view, setView] = useState<CalendarView>(data.preferences.defaultView);
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [filterOpen, setFilterOpen] = useState(false);
  const selectedDate = parseDate(selected);
  const weekStart = data.preferences.weekStarts === "Monday" ? 1 : 0;
  const first = dateKey(
    new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1),
  );
  const gridStart = addDays(
    first,
    -((parseDate(first).getDay() - weekStart + 7) % 7),
  );
  const daysInMonth = new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth() + 1,
    0,
  ).getDate();
  const gridCount =
    Math.ceil(
      (((parseDate(first).getDay() - weekStart + 7) % 7) + daysInMonth) / 7,
    ) * 7;
  const weekFirst = addDays(
    selected,
    -((selectedDate.getDay() - weekStart + 7) % 7),
  );
  const dates = Array.from(
    { length: view === "Month" ? gridCount : view === "Week" ? 7 : 0 },
    (_, n) => addDays(view === "Month" ? gridStart : weekFirst, n),
  );
  const matches = (item: ScheduleItem) =>
    filter === "All" ||
    (filter === "Shifts"
      ? item.kind === "shift"
      : filter === "Tasks"
        ? item.kind === "task"
        : item.category === filter);
  const events = itemsOnDate(data.items, selected).filter(matches);
  const changePeriod = (direction: number) => {
    if (view === "Month") {
      const next = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth() + direction,
        1,
      );
      setSelected(dateKey(next));
    } else
      setSelected(addDays(selected, direction * (view === "Week" ? 7 : 1)));
  };
  const dayNames =
    weekStart === 1
      ? ["M", "T", "W", "T", "F", "S", "S"]
      : ["S", "M", "T", "W", "T", "F", "S"];
  return (
    <Screen
      style={{
        paddingHorizontal: 16,
        paddingBottom: data.preferences.aiEnabled ? 95 : 28,
      }}
    >
      <Header
        title="Calendar"
        subtitle="A little clarity for the days ahead."
        right={
          <IconButton
            icon="add"
            label="Add event"
            background={palette.teal}
            onPress={() =>
              navigation.navigate("ItemEditor", { date: selected })
            }
          />
        }
      />
      <Segments
        options={["Month", "Week", "Day"] as const}
        value={view}
        onChange={setView}
      />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <IconButton
          icon="chevron-back"
          label={`Previous ${view.toLowerCase()}`}
          onPress={() => changePeriod(-1)}
        />
        <View style={{ flex: 1, alignItems: "center" }}>
          <Label size={18} weight="semibold">
            {view === "Day"
              ? formatDate(selected, true)
              : selectedDate.toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
          </Label>
        </View>
        <IconButton
          icon="chevron-forward"
          label={`Next ${view.toLowerCase()}`}
          onPress={() => changePeriod(1)}
        />
      </View>
      {view !== "Day" && (
        <View
          style={{
            marginHorizontal: -12,
            backgroundColor: theme.surface,
            borderRadius: 18,
            paddingVertical: 12,
            borderWidth: 1,
            borderColor: theme.line,
          }}
        >
          <View style={{ flexDirection: "row" }}>
            {dayNames.map((day, n) => (
              <View
                key={n}
                style={{
                  width: `${100 / 7}%`,
                  alignItems: "center",
                  paddingBottom: 10,
                }}
              >
                <Label size={12} tone="muted" weight="medium">
                  {day}
                </Label>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {dates.map((date) => {
              const isSelected = date === selected;
              const dayEvents = itemsOnDate(data.items, date).filter(
                (item) => !item.completed && matches(item),
              );
              const inMonth =
                parseDate(date).getMonth() === selectedDate.getMonth();
              return (
                <Pressable
                  key={date}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatDate(date)}, ${dayEvents.length} events`}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => setSelected(date)}
                  style={{
                    width: `${100 / 7}%`,
                    minHeight: 55,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 13,
                      backgroundColor: isSelected
                        ? palette.teal
                        : date === dateKey()
                          ? theme.soft
                          : "transparent",
                    }}
                  >
                    <Label
                      size={15}
                      weight={
                        isSelected || date === dateKey()
                          ? "semibold"
                          : "regular"
                      }
                      style={{
                        color: isSelected
                          ? palette.ink
                          : !inMonth && view === "Month"
                            ? theme.muted
                            : theme.text,
                      }}
                    >
                      {parseDate(date).getDate()}
                    </Label>
                  </View>
                  <View
                    style={{
                      height: 6,
                      marginTop: 3,
                      flexDirection: "row",
                      gap: 3,
                    }}
                  >
                    {dayEvents.slice(0, 3).map((item) => (
                      <View
                        key={item.id}
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: 2,
                          backgroundColor: categoryColor(item),
                        }}
                      />
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          marginTop: 10,
        }}
      >
        <Button small variant="ghost" onPress={() => setSelected(dateKey())}>
          Today
        </Button>
        <Button
          small
          variant="ghost"
          icon="options-outline"
          onPress={() => setFilterOpen(true)}
        >
          {filter === "All" ? "Filters" : filter}
        </Button>
        <IconButton
          icon="search-outline"
          label="Search calendar"
          onPress={() => navigation.navigate("Search")}
        />
      </View>
      <Section title={formatDate(selected)} />
      {events.length ? (
        events.map((item) => (
          <ItemCard item={item} key={item.id} date={selected} />
        ))
      ) : (
        <Empty
          title="A little open space."
          description={
            filter === "All"
              ? "No events scheduled for this day."
              : `No ${filter.toLowerCase()} on this day.`
          }
          action="Add Event"
          onPress={() => navigation.navigate("ItemEditor", { date: selected })}
        />
      )}
      <Sheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Show in calendar"
      >
        {filters.map((option) => (
          <Choice
            key={option}
            label={option}
            selected={filter === option}
            onPress={() => {
              setFilter(option);
              setFilterOpen(false);
            }}
          />
        ))}
      </Sheet>
    </Screen>
  );
}
