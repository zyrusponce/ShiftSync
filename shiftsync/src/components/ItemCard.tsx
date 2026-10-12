import React, { useRef } from "react";
import { Animated, PanResponder, StyleSheet, View } from "react-native";
import { Card, Badge, Icon, Label } from "./ui";
import { Pop, PressableScale, animateLayout, haptics, settle } from "./motion";
import { palette } from "../theme";
import {
  formatDate,
  formatTime,
  isTaskCompletedOn,
  setTaskOccurrenceCompleted,
} from "../domain/schedule";
import type { ScheduleItem } from "../domain/types";
import { useRootNavigation } from "../navigation/types";
import { useApp } from "../store/AppStore";

export const categoryColor = (item: ScheduleItem) =>
  item.kind === "unavailable"
    ? palette.beige
    : item.category === "Work"
      ? palette.teal
      : item.category === "Important" || item.category === "Study"
        ? palette.gold
        : item.category === "Class"
          ? palette.aqua
          : palette.beige;
export function ItemCard({
  item,
  showDate = false,
  date,
}: {
  item: ScheduleItem;
  showDate?: boolean;
  date?: string;
}) {
  const navigation = useRootNavigation();
  const { saveItem } = useApp();
  const occurrenceDate = date ?? item.date;
  const completed = isTaskCompletedOn(item, occurrenceDate);
  const shift = useRef(new Animated.Value(0)).current;
  const toggleComplete = () => {
    if (item.kind !== "task") return;
    // Lists that hide completed tasks close the gap smoothly.
    animateLayout();
    // Feedback only after the store accepts the change.
    if (
      saveItem(setTaskOccurrenceCompleted(item, occurrenceDate, !completed)) ===
      null
    )
      completed ? haptics.tap() : haptics.success();
    else haptics.error();
  };
  const onSwipe = useRef(() => {});
  onSwipe.current = toggleComplete;
  const gesture = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        item.kind === "task" &&
        Math.abs(g.dx) > 20 &&
        Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderMove: (_, g) =>
        shift.setValue(Math.max(-100, Math.min(100, g.dx))),
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > 70) onSwipe.current();
        Animated.spring(shift, {
          toValue: 0,
          ...settle,
          useNativeDriver: true,
        }).start();
      },
      onPanResponderTerminate: () =>
        Animated.spring(shift, {
          toValue: 0,
          ...settle,
          useNativeDriver: true,
        }).start(),
    }),
  ).current;
  return (
    <Animated.View
      {...(item.kind === "task" ? gesture.panHandlers : {})}
      style={{ transform: [{ translateX: shift }] }}
    >
      <Card
        onPress={() =>
          navigation.navigate("ItemDetails", {
            id: item.id,
            occurrenceDate,
          })
        }
        label={`${item.title}, ${formatTime(item.start)} to ${formatTime(item.end)}`}
        style={{ borderLeftWidth: 4, borderLeftColor: categoryColor(item) }}
      >
        <View
          style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}
        >
          <View style={{ flex: 1 }}>
            {showDate && (
              <Label size={12} weight="medium" tone="muted">
                {formatDate(date ?? item.date, true).toUpperCase()}
              </Label>
            )}
            <Label
              size={16}
              weight="semibold"
              style={
                completed
                  ? { textDecorationLine: "line-through", opacity: 0.6 }
                  : undefined
              }
            >
              {item.title}
            </Label>
          </View>
          {item.kind === "task" ? (
            <PressableScale
              accessibilityRole="checkbox"
              accessibilityLabel={`${completed ? "Mark incomplete" : "Complete"} ${item.title}`}
              accessibilityState={{ checked: completed }}
              onPress={toggleComplete}
              throttle={300}
              scaleTo={0.88}
              pressedOpacity={1}
              style={{
                minWidth: 44,
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <View>
                <Icon name="ellipse-outline" color={palette.teal} size={26} />
                <View style={StyleSheet.absoluteFill}>
                  <Pop active={completed}>
                    <Icon
                      name="checkmark-circle"
                      color={palette.teal}
                      size={26}
                    />
                  </Pop>
                </View>
              </View>
            </PressableScale>
          ) : (
            <Icon
              name={
                item.kind === "shift"
                  ? "time-outline"
                  : item.kind === "unavailable"
                    ? "ban-outline"
                    : "calendar-outline"
              }
              size={20}
            />
          )}
        </View>
        <Label tone="muted" size={13} style={{ marginTop: 5 }}>
          {item.kind === "task" ? "Due " : ""}
          {formatTime(item.start)} – {formatTime(item.end)}
        </Label>
        {item.location ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              marginTop: 8,
            }}
          >
            <Icon name="location-outline" size={14} />
            <Label size={12} tone="muted">
              {item.location}
            </Label>
          </View>
        ) : null}
        <View
          style={{
            flexDirection: "row",
            gap: 8,
            flexWrap: "wrap",
            marginTop: 12,
          }}
        >
          <Badge color={categoryColor(item)}>
            {item.kind === "unavailable" ? "Unavailable" : item.category}
          </Badge>
          {item.kind === "shift" && (
            <Badge color={item.status === "Open" ? palette.gold : palette.aqua}>
              {item.status}
            </Badge>
          )}
          {item.kind === "task" && (
            <Badge
              color={item.priority === "High" ? palette.gold : palette.beige}
            >{`${item.priority} priority`}</Badge>
          )}
          {item.repeat !== "Never" && <Badge>{item.repeat}</Badge>}
        </View>
      </Card>
    </Animated.View>
  );
}
