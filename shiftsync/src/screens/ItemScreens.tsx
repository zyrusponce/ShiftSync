import React, { useState } from "react";
import { View } from "react-native";
import { dialog } from "../components/dialog";
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
import { FadeIn, animateLayout, haptics } from "../components/motion";
import { newItem } from "../domain/seed";
import { uuid } from "../domain/ids";
import { CATEGORIES } from "../domain/persistence";
import {
  isFixed,
  minBlock,
  planCategory,
  planCategoryLabel,
} from "../domain/policy";
import {
  addDays,
  crossesMidnight,
  dateKey,
  findConflicts,
  formatDate,
  formatTime,
  minutes,
  isTaskCompletedOn,
  occursOn,
  setTaskOccurrenceCompleted,
  setItemRepeat,
  splitOvernight,
  suggestSlots,
  timeKey,
  validateItem,
} from "../domain/schedule";
import { useApp } from "../store/AppStore";
import { ApiError, api, messageOf } from "../services/api";
import type { StackProps } from "../navigation/types";
import type { Contact, ContactRole, ScheduleItem } from "../domain/types";
import { palette, useTheme } from "../theme";

const roleLabel: Record<ContactRole, string> = {
  Work: "Work contact",
  School: "School contact",
  Other: "Other contact",
};
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
  const { data, saveItems, saveContact } = useApp();
  const theme = useTheme();
  const existing = data.items.find((item) => item.id === route.params.id);
  const [contactDraft, setContactDraft] = useState<Contact | null>(null);
  const [contactError, setContactError] = useState("");
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
    | null
    | "category"
    | "repeat"
    | "reminder"
    | "priority"
    | "status"
    | "slots"
    | "minBlock"
  >(null);
  const update = <K extends keyof ScheduleItem>(
    key: K,
    value: ScheduleItem[K],
  ) => {
    setItem((current) => ({ ...current, [key]: value }));
    setError("");
  };
  const save = () => {
    // A shift that ends after midnight is saved as one part on each day.
    const parts = splitOvernight(item, data.items, uuid());
    const [first] = parts;
    const invalid = parts.map(validateItem).find(Boolean);
    if (invalid) {
      haptics.error();
      setError(invalid);
      return;
    }
    // A changed work shift is previewed first: Shift Impact Analysis shows
    // every affected commitment before anything is saved.
    if (
      existing?.kind === "shift" &&
      first.kind === "shift" &&
      first.status !== "Cancelled" &&
      (parts.length > 1 ||
        (["date", "start", "end", "repeat"] as const).some(
          (key) => existing[key] !== first[key],
        ))
    ) {
      haptics.selection();
      navigation.replace("ShiftImpact", { shift: first, continued: parts[1] });
      return;
    }
    const commit = () => {
      const failure = saveItems(parts);
      if (failure) {
        haptics.error();
        setError(failure);
      } else {
        haptics.success();
        navigation.goBack();
      }
    };
    const ids = new Set(parts.map((part) => part.id));
    const issues = findConflicts(
      [...data.items.filter((value) => !ids.has(value.id)), ...parts],
      data.availability,
      data.preferences,
      first.date,
      item.repeat === "Never" ? parts.length : 14,
    ).filter(
      (conflict) =>
        ids.has(conflict.first.id) || ids.has(conflict.second?.id ?? ""),
    );
    if (
      issues.length &&
      item.kind !== "unavailable" &&
      data.preferences.avoidOverlaps
    ) {
      const overlap = issues[0].type === "overlap";
      dialog.alert(
        overlap ? "Schedule conflict" : "Check this time",
        `${formatDate(issues[0].date, true)}: ${issues[0].reason}${item.repeat !== "Never" ? "\nRecurring schedules are checked for the next 14 days." : ""}\n\nSave this time anyway, or go back and adjust it?`,
        [
          { text: "Review Time", style: "cancel" },
          { text: `Save ${names[item.kind]} Anyway`, onPress: commit },
        ],
        { tone: overlap ? "danger" : "warning" },
      );
    } else commit();
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
    category: [...CATEGORIES],
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
            <FadeIn trigger={error}>
              <Label size={13} style={{ color: theme.danger }}>
                {error}
              </Label>
            </FadeIn>
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
      {crossesMidnight(item) && (
        <FadeIn>
          <Label size={13} tone="muted" style={{ marginBottom: 12 }}>
            {item.end === "00:00"
              ? `Ends at midnight. Saved as ${formatTime(item.start)} – 11:59 PM on ${formatDate(item.date, true)}.`
              : `Ends the next day. Saved as two parts: ${formatDate(item.date, true)}, ${formatTime(item.start)} – 11:59 PM, and ${formatDate(addDays(item.date, 1), true)}, 12:00 AM – ${formatTime(item.end)}.`}
          </Label>
        </FadeIn>
      )}
      {item.kind !== "unavailable" && (
        <Card>
          <Row
            icon="pricetag-outline"
            title="Event type"
            detail={item.kind === "shift" ? "Work shift" : item.category}
            onPress={
              item.kind === "shift" ? undefined : () => setPicker("category")
            }
          />
          <Row
            icon="flag-outline"
            title="Priority"
            detail={item.priority}
            onPress={() => setPicker("priority")}
          />
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
      {(item.kind === "event" || item.kind === "shift") && (
        <>
          <Section title="If plans change" />
          <Choice
            label="Fixed commitment"
            detail={
              isFixed(item)
                ? "ShiftSync will never move this automatically."
                : `Flexible: ShiftSync may suggest new times. ${planCategoryLabel[planCategory(item)]}s are ${isFixed({ ...item, fixed: undefined }) ? "fixed" : "flexible"} by default.`
            }
            selected={isFixed(item)}
            onPress={() => {
              animateLayout();
              update("fixed", !isFixed(item));
            }}
          />
          {!isFixed(item) && (
            <>
              <Choice
                label="Has a deadline"
                detail="New times must finish before it."
                selected={!!item.deadline}
                onPress={() => {
                  animateLayout();
                  update(
                    "deadline",
                    item.deadline
                      ? undefined
                      : `${addDays(item.date, 1)}T09:00`,
                  );
                }}
              />
              {item.deadline && (
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <DateTimeField
                      label="Deadline date"
                      mode="date"
                      min={item.date}
                      value={item.deadline.slice(0, 10)}
                      onChange={(value) =>
                        update(
                          "deadline",
                          `${value}T${item.deadline!.slice(11)}`,
                        )
                      }
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <DateTimeField
                      label="Deadline time"
                      mode="time"
                      value={item.deadline.slice(11)}
                      onChange={(value) =>
                        update(
                          "deadline",
                          `${item.deadline!.slice(0, 10)}T${value}`,
                        )
                      }
                    />
                  </View>
                </View>
              )}
              <Choice
                label="Can be split into shorter blocks"
                detail="If no full-length time is free, ShiftSync may suggest several blocks with the same total time."
                selected={!!item.splittable}
                onPress={() => {
                  animateLayout();
                  update("splittable", !item.splittable);
                }}
              />
              {item.splittable && (
                <Card>
                  <Row
                    icon="hourglass-outline"
                    title="Shortest useful block"
                    detail={`${minBlock(item)} minutes`}
                    onPress={() => setPicker("minBlock")}
                  />
                </Card>
              )}
            </>
          )}
          <Section title="Who to contact about conflicts" />
          {data.contacts.length ? (
            data.contacts.map((contact) => (
              <Choice
                key={contact.id}
                label={`${contact.name} · ${roleLabel[contact.role]}`}
                detail={contact.email}
                selected={!!item.contactIds?.includes(contact.id)}
                onPress={() =>
                  update(
                    "contactIds",
                    item.contactIds?.includes(contact.id)
                      ? item.contactIds.filter((id) => id !== contact.id)
                      : [...(item.contactIds ?? []), contact.id],
                  )
                }
              />
            ))
          ) : (
            <Label size={12} tone="muted" style={{ marginBottom: 12 }}>
              Optional. Add your supervisor or professor so ShiftSync can help
              you write to them when this can't be moved.
            </Label>
          )}
          {contactDraft ? (
            <Card>
              <Field
                label="Contact name"
                placeholder="e.g. Prof. Reyes"
                value={contactDraft.name}
                onChangeText={(name) =>
                  setContactDraft({ ...contactDraft, name })
                }
                autoComplete="name"
                maxLength={120}
              />
              <Field
                label="Contact email"
                placeholder="name@example.com"
                value={contactDraft.email}
                onChangeText={(email) =>
                  setContactDraft({ ...contactDraft, email })
                }
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                maxLength={254}
              />
              {(["Work", "School", "Other"] as const).map((role) => (
                <Choice
                  key={role}
                  label={roleLabel[role]}
                  selected={contactDraft.role === role}
                  onPress={() => setContactDraft({ ...contactDraft, role })}
                />
              ))}
              {contactError ? (
                <Label
                  size={13}
                  style={{ color: theme.danger, marginBottom: 8 }}
                >
                  {contactError}
                </Label>
              ) : null}
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    small
                    onPress={() => {
                      const failure = saveContact(contactDraft);
                      if (failure) {
                        haptics.error();
                        setContactError(failure);
                        return;
                      }
                      haptics.success();
                      animateLayout();
                      update("contactIds", [
                        ...(item.contactIds ?? []),
                        contactDraft.id,
                      ]);
                      setContactDraft(null);
                    }}
                  >
                    Save contact
                  </Button>
                </View>
                <Button
                  small
                  variant="ghost"
                  onPress={() => {
                    animateLayout();
                    setContactDraft(null);
                  }}
                >
                  Cancel
                </Button>
              </View>
            </Card>
          ) : (
            <Button
              small
              variant="secondary"
              icon="person-add-outline"
              onPress={() => {
                animateLayout();
                setContactError("");
                setContactDraft({
                  id: uuid(),
                  name: "",
                  email: "",
                  role:
                    item.kind === "shift" || item.category === "Work"
                      ? "Work"
                      : item.category === "Class"
                        ? "School"
                        : "Other",
                });
              }}
            >
              Add a contact
            </Button>
          )}
          <View style={{ height: 16 }} />
        </>
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
              onPress={() => {
                animateLayout();
                setSmart((value) => !value);
              }}
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
                  if (invalid) {
                    haptics.error();
                    setError(invalid);
                  } else setPicker("slots");
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
          picker === "slots"
            ? "Suggested times"
            : picker === "minBlock"
              ? "Shortest useful block"
              : `Choose ${picker ?? ""}`
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
                        haptics.selection();
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
        ) : picker === "minBlock" ? (
          [30, 45, 60, 90].map((value) => (
            <Choice
              key={value}
              label={`${value} minutes`}
              selected={minBlock(item) === value}
              onPress={() => {
                update("minBlockMinutes", value);
                setPicker(null);
              }}
            />
          ))
        ) : (
          picker &&
          options[picker]?.map((option) => (
            <Choice
              key={option}
              label={option}
              selected={item[picker as keyof ScheduleItem] === option}
              onPress={() => {
                setItem((current) =>
                  picker === "repeat"
                    ? setItemRepeat(current, option as ScheduleItem["repeat"])
                    : picker === "category"
                      ? // A new type brings its own fixed/flexible default.
                        {
                          ...current,
                          category: option as ScheduleItem["category"],
                          fixed: undefined,
                        }
                      : { ...current, [picker]: option },
                );
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
  const { data, saveItem, deleteItem, account, flush, applyServerItems } =
    useApp();
  const [adding, setAdding] = useState(false);
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
  const date =
    item.kind === "task" && item.repeat === "Never"
      ? item.date
      : (route.params.occurrenceDate ?? item.date);
  if (item.kind === "task" && !occursOn(item, date))
    return (
      <Screen>
        <Header title="Task updated" back={navigation.goBack} />
        <Empty
          title="This task occurrence is no longer scheduled."
          description="Open the task from your updated calendar or task list."
          action="Go Back"
          onPress={navigation.goBack}
        />
      </Screen>
    );
  const taskCompleted = isTaskCompletedOn(item, date);
  // Saves a change and gives haptic feedback that matches the real result.
  const confirm = (next: ScheduleItem) => {
    if (saveItem(next) === null) haptics.success();
    else haptics.error();
  };
  const issues = findConflicts(
    data.items,
    data.availability,
    data.preferences,
    date,
    1,
  ).filter(
    (value) => value.first.id === item.id || value.second?.id === item.id,
  );
  // Adds this event to the student's Google Calendar (once; retries are safe).
  const addToCalendar = async () => {
    if (!account) {
      dialog.alert(
        "Already in your calendar",
        "It's shown in the ShiftSync calendar. Log in and connect Google to add it to Google Calendar too.",
      );
      return;
    }
    if (item.googleEventId) {
      dialog.alert(
        "Already in Google Calendar",
        "This is linked to your Google Calendar, and changes you make here are sent there.",
      );
      return;
    }
    setAdding(true);
    try {
      if (!(await flush()))
        throw new ApiError(
          "NETWORK_ERROR",
          "Your latest changes haven't synced yet. Connect to the internet and try again.",
        );
      const result = await api.addToGoogleCalendar(item.id);
      applyServerItems([result.item]);
      haptics.success();
      dialog.alert(
        "Added to Google Calendar",
        `${item.title} is now in your Google Calendar.`,
        [{ text: "Done" }],
        { tone: "success" },
      );
    } catch (error) {
      haptics.error();
      if (error instanceof ApiError && error.code === "GOOGLE_NOT_CONNECTED")
        dialog.alert(
          "Connect Google first",
          error.message,
          [
            { text: "Not Now", style: "cancel" },
            {
              text: "Connect Google",
              onPress: () => navigation.navigate("ConnectedCalendars"),
            },
          ],
          { icon: "logo-google" },
        );
      else
        dialog.alert("Not added", messageOf(error), undefined, {
          tone: "warning",
        });
    } finally {
      setAdding(false);
    }
  };
  const calendarLabel = !account
    ? "Add to Calendar"
    : item.googleEventId
      ? "In Google Calendar"
      : adding
        ? "Adding…"
        : "Add to Google Calendar";
  const deleteThis = () =>
    dialog.alert(
      `Delete ${names[item.kind].toLowerCase()}?`,
      item.repeat !== "Never"
        ? `${item.title} and every repeat in its series will be removed from your schedule. This can't be undone.`
        : `${item.title} will be removed from your schedule. This can't be undone.`,
      [
        { text: `Keep ${names[item.kind]}`, style: "cancel" },
        {
          text: `Delete ${names[item.kind]}`,
          style: "destructive",
          onPress: () => {
            deleteItem(item.id);
            haptics.tap();
            navigation.goBack();
          },
        },
      ],
    );
  const requestSwap = () =>
    dialog.alert(
      "Request a swap?",
      "This records a swap request on your device. Sending it to your team needs an organization service.",
      [
        { text: "Not Now", style: "cancel" },
        {
          text: "Record Swap Request",
          onPress: () => confirm({ ...item, swapRequested: true }),
        },
      ],
      { icon: "swap-horizontal-outline" },
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
        {(item.kind === "event" || item.kind === "shift") && (
          <Row
            icon={
              isFixed(item) ? "lock-closed-outline" : "swap-horizontal-outline"
            }
            title={
              isFixed(item)
                ? "Fixed commitment"
                : `Flexible · ${item.priority} priority`
            }
            detail={
              isFixed(item)
                ? "Never moved automatically"
                : item.splittable
                  ? `Can be split into blocks of ${minBlock(item)}+ minutes`
                  : "Can be moved to a better time"
            }
          />
        )}
        {item.deadline && (
          <Row
            icon="alarm-outline"
            title="Deadline"
            detail={`${formatDate(item.deadline.slice(0, 10), true)} · ${formatTime(item.deadline.slice(11))}`}
          />
        )}
        {!!item.contactIds?.length && (
          <Row
            icon="mail-outline"
            title="Contacts"
            detail={data.contacts
              .filter((contact) => item.contactIds!.includes(contact.id))
              .map((contact) => `${contact.name} (${contact.email})`)
              .join(", ")}
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
            detail={taskCompleted ? "Completed" : "To do"}
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
          onPress={() =>
            confirm(setTaskOccurrenceCompleted(item, date, !taskCompleted))
          }
        >
          {taskCompleted ? "Mark incomplete" : "Complete Task"}
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
            icon="logo-google"
            disabled={adding}
            onPress={addToCalendar}
          >
            {calendarLabel}
          </Button>
          {item.status !== "Cancelled" && (
            <Button
              variant="ghost"
              onPress={() =>
                dialog.alert(
                  "Cancel this shift?",
                  "This marks the shift as cancelled in ShiftSync. Your employer is not notified automatically.",
                  [
                    { text: "Keep Shift", style: "cancel" },
                    {
                      text: "Cancel Shift",
                      style: "destructive",
                      onPress: () => confirm({ ...item, status: "Cancelled" }),
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
                : dialog.alert(
                    "You’re all in sync!",
                    "No scheduling conflicts were found for this event.",
                    [{ text: "Great" }],
                    { tone: "success" },
                  )
            }
          >
            Check for Conflicts
          </Button>
          {item.kind === "event" && account && (
            <View style={{ marginTop: 10 }}>
              <Button
                variant="secondary"
                icon="logo-google"
                disabled={adding}
                onPress={addToCalendar}
              >
                {calendarLabel}
              </Button>
            </View>
          )}
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
