import React, { useRef } from "react";
import { Animated, PanResponder, Pressable, View } from "react-native";
import { Card, Badge, Icon, Label } from "./ui";
import { palette } from "../theme";
import { formatDate, formatTime } from "../domain/schedule";
import type { ScheduleItem } from "../domain/types";
import { useRootNavigation } from "../navigation/types";
import { useApp } from "../store/AppStore";

export const categoryColor = (item: ScheduleItem) =>
  item.kind === "unavailable"
    ? palette.beige
    : item.category === "Work"
      ? palette.teal
      : item.category === "Important"
        ? palette.gold
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
  const shift = useRef(new Animated.Value(0)).current;
  const onSwipe = useRef(() => {});
  onSwipe.current = () => {
    if (item.kind === "task") saveItem({ ...item, completed: !item.completed });
  };
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
        Animated.spring(shift, { toValue: 0, useNativeDriver: true }).start();
      },
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
            occurrenceDate: date,
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
                item.completed
                  ? { textDecorationLine: "line-through", opacity: 0.6 }
                  : undefined
              }
            >
              {item.title}
            </Label>
          </View>
          {item.kind === "task" ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={`Complete ${item.title}`}
              accessibilityState={{ checked: item.completed }}
              onPress={() => saveItem({ ...item, completed: !item.completed })}
              style={{
                minWidth: 44,
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon
                name={item.completed ? "checkmark-circle" : "ellipse-outline"}
                color={palette.teal}
                size={26}
              />
            </Pressable>
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
