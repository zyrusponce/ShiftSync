import React, { useState } from "react";
import { Alert, View } from "react-native";
import {
  Badge,
  Button,
  Card,
  Choice,
  Empty,
  Field,
  Header,
  Label,
  Row,
  Screen,
  Section,
  Sheet,
} from "../components/ui";
import { DateTimeField } from "../components/DateTimeField";
import { newItem } from "../domain/seed";
import {
  dateKey,
  findConflicts,
  formatDate,
  formatTime,
  minutes,
  suggestSlots,
  timeKey,
  validateItem,
} from "../domain/schedule";
import { useApp } from "../store/AppStore";
import type { StackProps } from "../navigation/types";
import type { ScheduleItem } from "../domain/types";
import { palette } from "../theme";

const names = {
  event: "Event",
  shift: "Shift",
  task: "Task",
  unavailable: "Unavailable Time",
};
export function ItemEditorScreen({
  route,
  navigation,
}: StackProps<"ItemEditor">) {
  const { data, saveItem } = useApp();
  const existing = data.items.find((item) => item.id === route.params.id);
  const [item, setItem] = useState<ScheduleItem>(() => {
    if (existing) return { ...existing };
    const draft = newItem(route.params.kind, route.params.date);
    if (draft.kind === "unavailable") draft.title = "Unavailable time";
    draft.end = timeKey(
      minutes(draft.start) + data.preferences.defaultDuration,
    );
    return draft;
  });
  const [error, setError] = useState("");
  const [smart, setSmart] = useState(false);
  const [picker, setPicker] = useState<
    null | "category" | "repeat" | "reminder" | "priority" | "status" | "slots"
  >(null);
  const update = <K extends keyof ScheduleItem>(
    key: K,
    value: ScheduleItem[K],
  ) => {
    setItem((current) => ({ ...current, [key]: value }));
    setError("");
  };
  const save = () => {
    const invalid = validateItem(item);
    if (invalid) {
      setError(invalid);
      return;
    }
    const commit = () => {
      const failure = saveItem(item);
      if (failure) setError(failure);
      else navigation.goBack();
    };
    const issues = findConflicts(
      [...data.items.filter((value) => value.id !== item.id), item],
      data.availability,
      data.preferences,
      item.date,
      item.repeat === "Never" ? 1 : 14,
    ).filter(
      (conflict) =>
        conflict.first.id === item.id || conflict.second?.id === item.id,
    );
    if (
      issues.length &&
      item.kind !== "unavailable" &&
      data.preferences.avoidOverlaps
    )
      Alert.alert(
        "Check this time",
        `${formatDate(issues[0].date, true)}: ${issues[0].reason}${item.repeat !== "Never" ? "\nRecurring schedules are checked for the next 14 days." : ""}\n\nSave this time anyway, or return to the form?`,
        [
          { text: "Review time", style: "cancel" },
          { text: "Save anyway", onPress: commit },
        ],
      );
    else commit();
  };
  if (route.params.id && !existing)
    return (
      <Screen>
        <Header title="Item unavailable" back={navigation.goBack} />
        <Empty
          title="This item was removed."
          action="Go Back"
          onPress={navigation.goBack}
        />
      </Screen>
    );
  const options: Record<string, string[]> = {
    category: ["Work", "Personal", "Important"],
    repeat: ["Never", "Daily", "Weekly"],
    reminder: [
      "None",
      "5 minutes before",
      "15 minutes before",
      "30 minutes before",
      "1 day before",
    ],
    priority: ["Low", "Medium", "High"],
    status: ["Confirmed", "Open", "Cancelled"],
  };
  const slots =
    picker === "slots"
      ? suggestSlots(
          item,
          data.items,
          data.availability,
          data.preferences,
          item.date,
        )
      : [];
  return (
    <Screen
      footer={
        <View style={{ gap: 8 }}>
          {error ? (
            <Label size={13} style={{ color: "#A34738" }}>
              {error}
            </Label>
          ) : null}
          <Button
            icon="checkmark"
            onPress={save}
          >{`Save ${names[item.kind]}`}</Button>
        </View>
      }
    >
      <Header
        title={`${existing ? "Edit" : "Add"} ${names[item.kind]}`}
        subtitle="Make a little room in your day."
        back={navigation.goBack}
      />
      <Field
        label={`${names[item.kind]} title`}
        placeholder={
          item.kind === "task" ? "What needs doing?" : "Give it a name"
        }
        value={item.title}
        onChangeText={(value) => update("title", value)}
        maxLength={120}
      />
      <DateTimeField
        label={item.kind === "task" ? "Due date" : "Date"}
        mode="date"
        value={item.date}
        onChange={(value) => update("date", value)}
      />
      <DateTimeField
        label={item.kind === "task" ? "Planned start time" : "Start time"}
        mode="time"
        value={item.start}
        onChange={(value) => update("start", value)}
      />
      <DateTimeField
        label={item.kind === "task" ? "Due time" : "End time"}
        mode="time"
        value={item.end}
        onChange={(value) => update("end", value)}
      />
      {item.kind !== "unavailable" && (
        <Card>
          <Row
            icon="pricetag-outline"
            title="Event type"
            detail={item.category}
            onPress={() => setPicker("category")}
          />
          {item.kind === "task" && (
            <Row
              icon="flag-outline"
              title="Priority"
              detail={item.priority}
              onPress={() => setPicker("priority")}
            />
          )}
          {item.kind === "shift" && (
            <Row
              icon="checkmark-circle-outline"
              title="Status"
              detail={item.status}
              onPress={() => setPicker("status")}
            />
          )}
        </Card>
      )}
      {item.kind !== "task" && item.kind !== "unavailable" && (
        <Field
          label="Location"
          placeholder="Where will it be?"
          value={item.location}
          onChangeText={(value) => update("location", value)}
        />
      )}
      {item.kind === "shift" && (
        <Field
          label="Position"
          placeholder="Your role for this shift"
          value={item.position}
          onChangeText={(value) => update("position", value)}
        />
      )}
      {item.kind === "event" && (
        <Field
          label="Participants"
          placeholder="Names, separated by commas"
          value={item.participants}
          onChangeText={(value) => update("participants", value)}
        />
      )}
      <Field
        label="Notes"
        placeholder="Anything you want to remember"
        multiline
        value={item.notes}
        onChangeText={(value) => update("notes", value)}
        maxLength={2000}
      />
      <Card>
        <Row
          icon="repeat-outline"
          title="Repeat"
          detail={item.repeat}
          onPress={() => setPicker("repeat")}
        />
        {item.kind !== "unavailable" && (
          <Row
            icon="notifications-outline"
            title="Reminder"
            detail={item.reminder}
            onPress={() => setPicker("reminder")}
          />
        )}
      </Card>
      {item.kind !== "unavailable" && (
        <Label size={12} tone="muted">
          Reminders appear in your in-app notification list. Push notifications
          need a delivery service.
        </Label>
      )}
      {data.preferences.aiEnabled &&
        data.preferences.suggestions &&
        item.kind !== "unavailable" && (
          <View style={{ marginTop: 22 }}>
            <Choice
              label="Let CalenBud help choose a time"
              detail="Find a time within your availability."
              selected={smart}
              onPress={() => setSmart((value) => !value)}
            />
            {smart && (
              <Button
                variant="secondary"
                icon="sparkles-outline"
                onPress={() => {
                  const invalid = validateItem({
                    ...item,
                    title: item.title.trim() || "New event",
                  });
                  if (invalid) setError(invalid);
                  else setPicker("slots");
                }}
              >
                Find available times
              </Button>
            )}
          </View>
        )}
      <Sheet
        visible={picker !== null}
        onClose={() => setPicker(null)}
        title={
          picker === "slots" ? "Suggested times" : `Choose ${picker ?? ""}`
        }
      >
        {picker === "slots" ? (
          slots.length ? (
            <>
              <Label tone="muted" style={{ marginBottom: 14 }}>
                These fit your availability, duration, and buffer. Select one,
                then save your event.
              </Label>
              {slots.map((slot) => (
                <Card key={`${slot.date}-${slot.start}`}>
                  <Badge>Suggestion</Badge>
                  <Label weight="semibold" style={{ marginTop: 8 }}>
                    {formatDate(slot.date, true)}
                  </Label>
                  <Label tone="muted">
                    {formatTime(slot.start)} – {formatTime(slot.end)}
                  </Label>
                  <View style={{ marginTop: 12 }}>
                    <Button
                      onPress={() => {
                        setItem((current) => ({ ...current, ...slot }));
                        setPicker(null);
                      }}
                    >
                      Use this time
                    </Button>
                  </View>
                </Card>
              ))}
            </>
          ) : (
            <Empty
              title="No suitable time yet."
              description="Try changing your availability, preferences, or duration."
            />
          )
        ) : (
          picker &&
          options[picker]?.map((option) => (
            <Choice
              key={option}
              label={option}
              selected={item[picker as keyof ScheduleItem] === option}
              onPress={() => {
                setItem((current) => ({ ...current, [picker]: option }));
                setPicker(null);
              }}
            />
          ))
        )}
      </Sheet>
    </Screen>
  );
}

export function ItemDetailsScreen({
  route,
  navigation,
}: StackProps<"ItemDetails">) {
  const { data, saveItem, deleteItem } = useApp();
  const item = data.items.find((value) => value.id === route.params.id);
  if (!item)
    return (
      <Screen>
        <Header title="Item unavailable" back={navigation.goBack} />
        <Empty
          title="This item was removed."
          action="Go Back"
          onPress={navigation.goBack}
        />
      </Screen>
    );
  const date = route.params.occurrenceDate ?? item.date;
  const issues = findConflicts(
    data.items,
    data.availability,
    data.preferences,
    date,
    1,
  ).filter(
    (value) => value.first.id === item.id || value.second?.id === item.id,
  );
  const deleteThis = () =>
    Alert.alert(
      `Delete ${names[item.kind].toLowerCase()}?`,
      item.repeat !== "Never"
        ? "This removes the whole recurring series from your local schedule."
        : "This removes it from your local schedule.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteItem(item.id);
            navigation.goBack();
          },
        },
      ],
    );
  const requestSwap = () =>
    Alert.alert(
      "Request a swap?",
      "This records a swap request on your device. Sending it to your team needs an organization service.",
      [
        { text: "Keep shift", style: "cancel" },
        {
          text: "Record request",
          onPress: () => saveItem({ ...item, swapRequested: true }),
        },
      ],
    );
  return (
    <Screen
      footer={
        <Button
          icon="create-outline"
          onPress={() => navigation.navigate("ItemEditor", { id: item.id })}
        >{`Edit ${names[item.kind]}`}</Button>
      }
    >
      <Header
        title={
          item.kind === "shift"
            ? "Shift details"
            : item.kind === "task"
              ? "Task details"
              : "Event details"
        }
        back={navigation.goBack}
      />
      <Badge color={item.kind === "task" ? palette.gold : palette.aqua}>
        {item.kind === "unavailable" ? "Unavailable" : item.category}
      </Badge>
      <Label
        size={27}
        weight="bold"
        style={{ marginTop: 14, marginBottom: 22 }}
      >
        {item.title}
      </Label>
      <Card>
        <Row
          icon="calendar-outline"
          title={formatDate(date)}
          detail={
            item.repeat === "Never"
              ? parseDateYear(date)
              : `Repeats ${item.repeat.toLowerCase()} · editing changes the whole series`
          }
        />
        <Row
          icon="time-outline"
          title={`${formatTime(item.start)} – ${formatTime(item.end)}`}
          detail={`${minutes(item.end) - minutes(item.start)} minutes`}
        />
        {item.location && <Row icon="location-outline" title={item.location} />}
        {item.position && (
          <Row icon="briefcase-outline" title={item.position} />
        )}
        {item.participants && (
          <Row
            icon="people-outline"
            title="Participants"
            detail={item.participants}
          />
        )}
        {item.kind !== "unavailable" && (
          <Row
            icon="notifications-outline"
            title="Reminder"
            detail={item.reminder}
          />
        )}
        {item.kind === "shift" && (
          <Row
            icon="checkmark-circle-outline"
            title="Status"
            detail={
              item.swapRequested
                ? `${item.status} · swap requested locally`
                : item.status
            }
          />
        )}
        {item.kind === "task" && (
          <Row
            icon="flag-outline"
            title={`${item.priority} priority`}
            detail={item.completed ? "Completed" : "To do"}
          />
        )}
      </Card>
      <Section title="Notes" />
      <Card>
        <Label tone={item.notes ? "normal" : "muted"}>
          {item.notes || "No notes added."}
        </Label>
      </Card>
      {item.kind === "task" && (
        <Button
          icon="checkmark-circle-outline"
          onPress={() => saveItem({ ...item, completed: !item.completed })}
        >
          {item.completed ? "Mark incomplete" : "Complete Task"}
        </Button>
      )}
      {item.kind === "shift" && (
        <View style={{ gap: 10, marginTop: 12 }}>
          <Button
            variant="secondary"
            disabled={item.swapRequested || item.status === "Cancelled"}
            onPress={requestSwap}
          >
            Request Swap
          </Button>
          <Button
            variant="secondary"
            onPress={() =>
              Alert.alert(
                "Already in your calendar",
                "Your shifts are automatically shown in the ShiftSync calendar.",
              )
            }
          >
            Add to Calendar
          </Button>
          {item.status !== "Cancelled" && (
            <Button
              variant="ghost"
              onPress={() =>
                Alert.alert(
                  "Cancel this local shift?",
                  "This only updates the shift on your device.",
                  [
                    { text: "Keep shift", style: "cancel" },
                    {
                      text: "Cancel shift",
                      onPress: () => saveItem({ ...item, status: "Cancelled" }),
                    },
                  ],
                )
              }
            >
              Cancel Shift
            </Button>
          )}
        </View>
      )}
      {item.kind !== "task" && item.kind !== "unavailable" && (
        <View style={{ marginTop: 14 }}>
          <Button
            variant="secondary"
            icon="shield-checkmark-outline"
            onPress={() =>
              issues.length
                ? navigation.navigate("Resolve", { conflictId: issues[0].id })
                : Alert.alert(
                    "You’re all in sync!",
                    "No scheduling conflicts were found for this event.",
                  )
            }
          >
            Check for Conflicts
          </Button>
        </View>
      )}
      <View style={{ marginTop: 16 }}>
        <Button
          variant="danger"
          icon="trash-outline"
          onPress={deleteThis}
        >{`Delete ${names[item.kind]}`}</Button>
      </View>
    </Screen>
  );
}
function parseDateYear(date: string) {
  return date.slice(0, 4);
}
