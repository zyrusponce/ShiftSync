import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Animated, Pressable, View } from "react-native";
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
  durations,
  easing,
  haptics,
  useEntrance,
  useReducedMotion,
} from "../components/motion";
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
  "Shifts",
  "Class",
  "Study",
  "Work",
  "Personal",
  "Tasks",
  "Important",
] as const;
const DayCell = React.memo(function DayCell({
  date,
  selected,
  today,
  muted,
  count,
  dots,
  onSelect,
}: {
  date: string;
  selected: boolean;
  today: boolean;
  muted: boolean;
  count: number;
  /** Comma-separated dot colors, kept as a string so memo comparison works. */
  dots: string;
  onSelect: (date: string) => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${formatDate(date)}, ${count} events`}
      accessibilityState={{ selected }}
      onPress={() => onSelect(date)}
      style={{
        width: `${100 / 7}%`,
        minHeight: CELL_HEIGHT,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {({ pressed }) => (
        <>
          <View
            style={{
              width: 38,
              height: 38,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 13,
              // The shared selection indicator sits underneath, so a selected
              // cell stays transparent.
              backgroundColor: selected
                ? "transparent"
                : today || pressed
                  ? theme.soft
                  : "transparent",
            }}
          >
            <Label
              size={15}
              weight={selected || today ? "semibold" : "regular"}
              style={{
                color: selected
                  ? palette.ink
                  : muted
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
            {dots
              ? dots.split(",").map((color, n) => (
                  <View
                    key={n}
                    style={{
                      width: 4,
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: color,
                    }}
                  />
                ))
              : null}
          </View>
        </>
      )}
    </Pressable>
  );
});
const CELL_HEIGHT = 55;
const MARK_SIZE = 38;
// One teal mark that glides between dates in the same month or week. When
// the visible period changes it jumps instead, since the grid itself moves.
function SelectionIndicator({
  index,
  width,
  period,
}: {
  index: number;
  width: number;
  period: string;
}) {
  const reduced = useReducedMotion();
  const x = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;
  const placed = useRef<{ period: string; width: number } | null>(null);
  useLayoutEffect(() => {
    if (index < 0 || !width) return;
    const cell = width / 7;
    const toX = (index % 7) * cell + (cell - MARK_SIZE) / 2;
    const toY =
      Math.floor(index / 7) * CELL_HEIGHT + (CELL_HEIGHT - MARK_SIZE - 9) / 2;
    const jump =
      reduced ||
      !placed.current ||
      placed.current.period !== period ||
      placed.current.width !== width;
    placed.current = { period, width };
    if (jump) {
      x.setValue(toX);
      y.setValue(toY);
      return;
    }
    const animation = Animated.parallel(
      [x, y].map((value, n) =>
        Animated.timing(value, {
          toValue: n ? toY : toX,
          duration: durations.component,
          easing: easing.enter,
          useNativeDriver: true,
        }),
      ),
    );
    animation.start();
    return () => animation.stop();
  }, [index, width, period, reduced, x, y]);
  if (index < 0 || !width) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: MARK_SIZE,
        height: MARK_SIZE,
        borderRadius: 13,
        backgroundColor: palette.teal,
        transform: [{ translateX: x }, { translateY: y }],
      }}
    />
  );
}
export function CalendarScreen() {
  const { data } = useApp();
  const navigation = useRootNavigation();
  const theme = useTheme();
  const [selected, setSelected] = useState(dateKey());
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const selectDate = useCallback((date: string) => {
    if (date === selectedRef.current) return;
    haptics.selection();
    setSelected(date);
  }, []);
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
  const rangeStart = view === "Month" ? gridStart : weekFirst;
  const rangeLength = view === "Month" ? gridCount : view === "Week" ? 7 : 0;
  const matches = (item: ScheduleItem) =>
    filter === "All" ||
    (filter === "Shifts"
      ? item.kind === "shift"
      : filter === "Tasks"
        ? item.kind === "task"
        : item.category === filter);
  // Only recompute the grid when the visible range, items, or filter change,
  // not on every date tap.
  const cells = useMemo(
    () =>
      Array.from({ length: rangeLength }, (_, n) => {
        const date = addDays(rangeStart, n);
        const dayEvents = itemsOnDate(data.items, date).filter(
          (item) => !item.completed && matches(item),
        );
        return {
          date,
          count: dayEvents.length,
          dots: dayEvents.slice(0, 3).map(categoryColor).join(","),
        };
      }),
    [data.items, rangeStart, rangeLength, filter],
  );
  const events = itemsOnDate(data.items, selected).filter(matches);
  const todayKey = dateKey();
  // Slide the grid in from the side the user is moving toward.
  const period = useRef({ key: rangeStart, direction: 1 });
  if (period.current.key !== rangeStart)
    period.current = {
      key: rangeStart,
      direction: rangeStart > period.current.key ? 1 : -1,
    };
  const gridMotion = useEntrance(`${view}:${rangeStart}`, {
    axis: "x",
    distance: 16,
    direction: period.current.direction,
    duration: durations.navigation,
    fromOpacity: 1,
    onMount: false,
  });
  const [gridWidth, setGridWidth] = useState(0);
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
            // Keeps the short period glide inside the card.
            overflow: "hidden",
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
          <Animated.View
            onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
            style={[{ flexDirection: "row", flexWrap: "wrap" }, gridMotion]}
          >
            <SelectionIndicator
              index={cells.findIndex((cell) => cell.date === selected)}
              width={gridWidth}
              period={`${view}:${rangeStart}`}
            />
            {cells.map(({ date, count, dots }) => (
              <DayCell
                key={date}
                date={date}
                selected={date === selected}
                today={date === todayKey}
                muted={
                  view === "Month" &&
                  parseDate(date).getMonth() !== selectedDate.getMonth()
                }
                count={count}
                dots={dots}
                onSelect={selectDate}
              />
            ))}
          </Animated.View>
        </View>
      )}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          marginTop: 10,
        }}
      >
        <Button small variant="ghost" onPress={() => selectDate(dateKey())}>
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
