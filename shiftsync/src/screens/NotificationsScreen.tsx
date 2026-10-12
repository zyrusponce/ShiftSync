import React, { useEffect, useRef } from "react";
import { Animated, Dimensions, PanResponder, View } from "react-native";
import {
  Pop,
  animateLayout,
  durations,
  easing,
  haptics,
  settle,
  useReducedMotion,
} from "../components/motion";
import {
  Badge,
  Button,
  Card,
  Empty,
  Header,
  IconButton,
  Label,
  Screen,
} from "../components/ui";
import {
  addDays,
  dateKey,
  findConflicts,
  formatDate,
  formatTime,
  itemsOnDate,
} from "../domain/schedule";
import { useApp } from "../store/AppStore";
import type { StackProps } from "../navigation/types";
import { palette } from "../theme";

type Notice = {
  id: string;
  category: string;
  text: string;
  date: string;
  itemId?: string;
  conflictId?: string;
};
function NotificationCard({
  notice,
  read,
  onRead,
  onDelete,
  onOpen,
}: {
  notice: Notice;
  read: boolean;
  onRead: () => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const reduced = useReducedMotion();
  const x = useRef(new Animated.Value(0)).current;
  const readOpacity = useRef(new Animated.Value(read ? 0.65 : 1)).current;
  const leaving = useRef(false);
  useEffect(() => {
    const animation = Animated.timing(readOpacity, {
      toValue: read ? 0.65 : 1,
      duration: reduced ? 0 : durations.component,
      easing: easing.enter,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [read, reduced, readOpacity]);
  useEffect(() => () => x.stopAnimation(), [x]);
  const settle = () =>
    Animated.spring(x, {
      toValue: 0,
      ...settle,
      useNativeDriver: true,
    }).start();
  // Slide the card away first, then remove it and let the list close up.
  const remove = () => {
    if (leaving.current) return;
    leaving.current = true;
    haptics.tap();
    Animated.timing(x, {
      toValue: -Dimensions.get("window").width,
      duration: reduced ? 0 : durations.component,
      easing: easing.exit,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) {
        leaving.current = false;
        return;
      }
      animateLayout();
      onDelete();
    });
  };
  const markRead = () => {
    if (!read) haptics.selection();
    onRead();
  };
  const callbacks = useRef({ remove, markRead });
  callbacks.current = { remove, markRead };
  const gesture = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderMove: (_, g) =>
        x.setValue(Math.max(-100, Math.min(100, g.dx))),
      onPanResponderRelease: (_, g) => {
        if (g.dx < -70) {
          callbacks.current.remove();
          return;
        }
        if (g.dx > 70) callbacks.current.markRead();
        settle();
      },
      onPanResponderTerminate: settle,
    }),
  ).current;
  return (
    <Animated.View
      {...gesture.panHandlers}
      style={{ transform: [{ translateX: x }], opacity: readOpacity }}
    >
      <Card>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Badge
            color={
              notice.category === "Conflicts" ? palette.gold : palette.aqua
            }
          >
            {notice.category}
          </Badge>
          <View
            accessible={!read}
            accessibilityLabel={read ? undefined : "Unread"}
          >
            <Pop active={!read}>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: palette.teal,
                }}
              />
            </Pop>
          </View>
        </View>
        <Label weight="medium" style={{ marginTop: 14 }}>
          {notice.text}
        </Label>
        <Label tone="muted" size={12} style={{ marginTop: 8 }}>
          {formatDate(notice.date, true)}
        </Label>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 8,
          }}
        >
          <Button variant="ghost" small onPress={onOpen}>
            View
          </Button>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <IconButton
              icon={read ? "checkmark-done-outline" : "checkmark-outline"}
              label="Mark as read"
              onPress={markRead}
            />
            <IconButton
              icon="trash-outline"
              label="Delete notification"
              onPress={remove}
            />
          </View>
        </View>
      </Card>
    </Animated.View>
  );
}
export function NotificationsScreen({
  navigation,
}: StackProps<"Notifications">) {
  const { data, markNotification, deleteNotification } = useApp();
  const today = dateKey();
  const notices: Notice[] = [];
  for (let n = 0; n < 2; n++) {
    const date = addDays(today, n);
    itemsOnDate(data.items, date)
      .filter(
        (item) =>
          !item.completed &&
          item.kind !== "unavailable" &&
          item.reminder !== "None",
      )
      .forEach((item) => {
        if (
          item.kind === "shift"
            ? !data.preferences.shiftNotifications
            : !data.preferences.reminders
        )
          return;
        notices.push({
          id: `item:${date}:${item.id}`,
          category:
            item.kind === "shift"
              ? "Shifts"
              : item.kind === "task"
                ? "Tasks"
                : "Reminders",
          text:
            item.kind === "task"
              ? `“${item.title}” is due ${n ? "tomorrow" : "today"} at ${formatTime(item.end)}.`
              : `${item.title} starts ${n ? "tomorrow" : "today"} at ${formatTime(item.start)}.`,
          date,
          itemId: item.id,
        });
      });
  }
  const conflicts = findConflicts(
    data.items,
    data.availability,
    data.preferences,
    today,
    7,
  ).filter(
    (value) =>
      !data.ignoredConflicts.includes(value.id) &&
      data.conflictStatus[value.id] !== "resolved",
  );
  if (data.preferences.conflictAlerts)
    conflicts.forEach((conflict) =>
      notices.push({
        id: `conflict:${conflict.id}`,
        category: "Conflicts",
        text: `${conflict.first.title}: ${conflict.reason}`,
        date: conflict.date,
        conflictId: conflict.id,
      }),
    );
  if (
    data.preferences.aiEnabled &&
    data.preferences.suggestions &&
    data.preferences.aiFrequency !== "Off"
  ) {
    const period =
      data.preferences.aiFrequency === "Weekly"
        ? addDays(today, -((new Date(`${today}T12:00:00`).getDay() + 6) % 7))
        : today;
    notices.push({
      id: `buddy:${period}`,
      category: "CalenBud",
      text: conflicts.length
        ? "I noticed a scheduling issue. Want to check your week together?"
        : "Your schedule is looking calm. Ask me when you have a free hour.",
      date: today,
    });
  }
  const visible = notices.filter(
    (notice) => !data.deletedNotifications.includes(notice.id),
  );
  return (
    <Screen>
      <Header
        title="Notifications"
        subtitle="The little things worth remembering."
        back={navigation.goBack}
      />
      <Label size={12} tone="muted" style={{ marginBottom: 18 }}>
        Swipe right to mark read, left to delete. These are in-app schedule
        notices.
      </Label>
      {visible.length ? (
        visible.map((notice) => (
          <NotificationCard
            key={notice.id}
            notice={notice}
            read={data.readNotifications.includes(notice.id)}
            onRead={() => markNotification(notice.id)}
            onDelete={() => deleteNotification(notice.id)}
            onOpen={() => {
              markNotification(notice.id);
              if (notice.itemId)
                navigation.navigate("ItemDetails", {
                  id: notice.itemId,
                  occurrenceDate: notice.date,
                });
              else if (notice.conflictId)
                navigation.navigate("Resolve", {
                  conflictId: notice.conflictId,
                });
              else navigation.navigate("Chat");
            }}
          />
        ))
      ) : (
        <Empty
          icon="notifications-outline"
          title="You're all caught up."
          description="New reminders and schedule updates will appear here."
        />
      )}
    </Screen>
  );
}
