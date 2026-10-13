import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import {
  Button,
  Choice,
  Empty,
  Header,
  Icon,
  IconButton,
  Label,
  Screen,
  Section,
  Segments,
  Sheet,
} from "../components/ui";
import { ItemCard, categoryColor } from "../components/ItemCard";
import {
  CalendarSyncButton,
  CalendarSyncNote,
  useCalendarSync,
} from "../components/CalendarSyncButton";
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
  openConflicts,
  parseDate,
} from "../domain/schedule";
import { useApp } from "../store/AppStore";
import { useRootNavigation, type TabParamList } from "../navigation/types";
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
  conflict,
  onSelect,
}: {
  date: string;
  selected: boolean;
  today: boolean;
  muted: boolean;
  count: number;
  /** Comma-separated dot colors, kept as a string so memo comparison works. */
  dots: string;
  /** An unresolved overlap happens on this day. */
  conflict: boolean;
  onSelect: (date: string) => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${today ? "Today, " : ""}${formatDate(date)}, ${count} event${count === 1 ? "" : "s"}${conflict ? ", schedule conflict" : ""}`}
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
                    ? theme.faint
                    : theme.text,
              }}
            >
              {parseDate(date).getDate()}
            </Label>
            {today && (
              // Today is marked by shape too, not only by a tint.
              <View
                style={{
                  position: "absolute",
                  bottom: 4,
                  width: 14,
                  height: 2,
                  borderRadius: 1,
                  backgroundColor: selected ? palette.ink : theme.accentText,
                }}
              />
            )}
          </View>
          <View
            style={{
              height: 8,
              marginTop: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 3,
            }}
          >
            {conflict ? (
              <Icon name="warning" size={9} color={theme.danger} />
            ) : null}
            {dots
              ? dots
                  .split(",")
                  .slice(0, conflict ? 2 : 3)
                  .map((color, n) => (
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
  const route = useRoute<RouteProp<TabParamList, "Calendar">>();
  const theme = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const calendarSync = useCalendarSync();
  const [selected, setSelected] = useState(route.params?.date ?? dateKey());
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const scrollRef = useRef<ScrollView>(null);
  const listRef = useRef<View>(null);
  const listY = useRef(0);
  const revealPending = useRef(false);
  // Tapping a day answers with that day's events: if the list is below the
  // fold, bring its heading into view. If it's already visible, stay put.
  const revealList = useCallback(() => {
    listRef.current?.measureInWindow((_x, y) => {
      if (y > windowHeight - 240)
        scrollRef.current?.scrollTo({
          y: Math.max(0, listY.current - 12),
          animated: true,
        });
    });
  }, [windowHeight]);
  const selectDate = useCallback(
    (date: string) => {
      if (date === selectedRef.current) {
        // A second tap on the selected day is a request to see its events.
        revealList();
        return;
      }
      haptics.selection();
      revealPending.current = true;
      setSelected(date);
    },
    [revealList],
  );
  const [view, setView] = useState<CalendarView>(
    route.params?.view ?? data.preferences.defaultView,
  );
  // Other screens can open the calendar on a particular day's events.
  useEffect(() => {
    if (route.params?.date) {
      setSelected(route.params.date);
      revealPending.current = true;
    }
    if (route.params?.view) setView(route.params.view);
  }, [route.params?.date, route.params?.view]);
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
  const cells = useMemo(() => {
    const conflictDays = new Set(
      rangeLength
        ? openConflicts(data, rangeStart, rangeLength)
            .filter((conflict) => conflict.type === "overlap")
            .map((conflict) => conflict.date)
        : [],
    );
    return Array.from({ length: rangeLength }, (_, n) => {
      const date = addDays(rangeStart, n);
      const dayEvents = itemsOnDate(data.items, date).filter(
        (item) => !item.completed && matches(item),
      );
      return {
        date,
        count: dayEvents.length,
        dots: dayEvents.slice(0, 3).map(categoryColor).join(","),
        conflict: conflictDays.has(date),
      };
    });
  }, [
    data.items,
    data.availability,
    data.preferences,
    data.ignoredConflicts,
    data.conflictStatus,
    rangeStart,
    rangeLength,
    filter,
  ]);
  const events = itemsOnDate(data.items, selected).filter(matches);
  const todayKey = dateKey();
  useEffect(() => {
    if (!revealPending.current) return;
    revealPending.current = false;
    if (!events.length) return;
    // Wait a frame so the new list has been laid out before measuring.
    const frame = requestAnimationFrame(revealList);
    return () => cancelAnimationFrame(frame);
  }, [selected]);
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
      scrollRef={scrollRef}
      style={{
        paddingHorizontal: 16,
        paddingBottom: data.preferences.aiEnabled ? 95 : 28,
      }}
    >
      <Header
        title="Calendar"
        subtitle="A little clarity for the days ahead."
        right={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <CalendarSyncButton
              state={calendarSync.state}
              onPress={() => void calendarSync.press()}
            />
            <IconButton
              icon="add"
              label="Add event"
              background={palette.teal}
              onPress={() =>
                navigation.navigate("ItemEditor", { date: selected })
              }
            />
          </View>
        }
      />
      <CalendarSyncNote note={calendarSync.note} />
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
            {cells.map(({ date, count, dots, conflict }) => (
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
                conflict={conflict}
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
      <View
        ref={listRef}
        onLayout={(event) => {
          listY.current = event.nativeEvent.layout.y;
        }}
        accessibilityLiveRegion="polite"
      >
        <Section
          title={`${selected === todayKey ? "Today · " : ""}${formatDate(selected)}`}
        />
        <Label
          tone="muted"
          size={13}
          style={{ marginTop: -8, marginBottom: 12 }}
        >
          {events.length
            ? `${events.length} ${filter === "All" ? "event" : filter.toLowerCase()}${events.length === 1 || filter !== "All" ? "" : "s"} on this day`
            : filter === "All"
              ? "Nothing scheduled"
              : `Showing ${filter.toLowerCase()} only`}
        </Label>
      </View>
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
