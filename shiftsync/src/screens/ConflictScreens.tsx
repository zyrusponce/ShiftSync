import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { dialog } from "../components/dialog";
import {
  Badge,
  Buddy,
  Button,
  Card,
  Choice,
  Empty,
  Header,
  Icon,
  Label,
  Screen,
  Section,
  type IconName,
} from "../components/ui";
import { categoryColor } from "../components/ItemCard";
import { ExplainCard } from "../components/ExplainCard";
import { FadeIn, animateLayout, haptics } from "../components/motion";
import {
  dateKey,
  formatDate,
  formatTime,
  minutes,
  openConflicts,
} from "../domain/schedule";
import { isFixed, resolutionPlan, type PairType } from "../domain/policy";
import { formatDuration } from "../domain/recovery";
import { uuid } from "../domain/ids";
import { ApiError, messageOf } from "../services/api";
import { useApp } from "../store/AppStore";
import {
  useRecovery,
  type Option,
  type Suggestions,
} from "../store/useRecovery";
import { useRootNavigation, type StackProps } from "../navigation/types";
import { palette, useTheme, type Theme } from "../theme";
import type { Conflict, ConflictStatus, ScheduleItem } from "../domain/types";

const pairLabel: Record<PairType, string> = {
  fixed_fixed: "Fixed + fixed",
  fixed_flexible: "Fixed + flexible",
  flexible_flexible: "Flexible + flexible",
};
export const statusLabel: Record<ConflictStatus, string> = {
  unresolved: "Unresolved",
  draft_prepared: "Message prepared",
  user_contacted: "Contacted",
  resolved: "Resolved",
  dismissed: "Ignored",
};
const pairOf = (conflict: Conflict): PairType | null =>
  conflict.second
    ? resolutionPlan(conflict.first, conflict.second).pairType
    : null;
const contactsOf = (conflict: Conflict) =>
  new Set(
    [conflict.first, conflict.second].flatMap((item) => item?.contactIds ?? []),
  );

// How a conflict presents itself. Only real overlaps get the red treatment;
// short gaps and availability issues are amber heads-ups.
export function conflictLook(conflict: Conflict, theme: Theme) {
  const urgent = conflict.type === "overlap";
  return {
    urgent,
    title: urgent
      ? "Schedule Conflict"
      : conflict.type === "buffer"
        ? "Short Gap"
        : "Outside Availability",
    icon: (urgent ? "warning" : "alert-circle") as IconName,
    color: urgent ? theme.danger : theme.warning,
    soft: urgent ? theme.dangerSoft : theme.warningSoft,
    line: urgent ? theme.dangerLine : theme.line,
  };
}
// The conflict's headline: icon + words + when, read before anything else.
function ConflictHeading({ conflict }: { conflict: Conflict }) {
  const theme = useTheme();
  const look = conflictLook(conflict, theme);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: look.soft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={look.icon} size={22} color={look.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Label size={16} weight="semibold" style={{ color: look.color }}>
          {look.title}
        </Label>
        <Label size={12} tone="muted">
          {`${formatDate(conflict.date, true)}${conflict.type === "overlap" ? ` · ${conflict.minutes} min overlap` : ""}`}
        </Label>
      </View>
    </View>
  );
}
// An affected event. The whole row opens its details, with the date of the
// clash, so the detail screen shows the right occurrence.
function AffectedEvent({
  item,
  date,
  urgent,
}: {
  item: ScheduleItem;
  date: string;
  urgent: boolean;
}) {
  const theme = useTheme();
  const navigation = useRootNavigation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${formatTime(item.start)} to ${formatTime(item.end)}. Open details`}
      onPress={() =>
        navigation.navigate("ItemDetails", {
          id: item.id,
          occurrenceDate: date,
        })
      }
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 56,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 12,
        backgroundColor: pressed ? theme.soft : theme.background,
      })}
    >
      <View
        style={{
          width: 4,
          alignSelf: "stretch",
          borderRadius: 2,
          backgroundColor: urgent ? theme.danger : categoryColor(item),
        }}
      />
      <View style={{ flex: 1 }}>
        <Label weight="semibold">{item.title}</Label>
        <Label size={13} tone="muted">
          {`${formatTime(item.start)} – ${formatTime(item.end)}`}
        </Label>
      </View>
      <Icon name="chevron-forward" size={18} color={theme.muted} />
    </Pressable>
  );
}
export function ConflictsScreen() {
  const { data, ignoreConflict } = useApp();
  const navigation = useRootNavigation();
  const theme = useTheme();
  const conflicts = openConflicts(data, dateKey());
  const urgentCount = conflicts.filter(
    (conflict) => conflict.type === "overlap",
  ).length;
  const otherCount = conflicts.length - urgentCount;
  return (
    <Screen style={{ paddingBottom: data.preferences.aiEnabled ? 95 : 28 }}>
      <Header
        title="Schedule Conflicts"
        subtitle="Let's get your schedule back in sync."
      />
      {conflicts.length ? (
        <>
          <View
            accessibilityRole="summary"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              padding: 14,
              borderRadius: 14,
              marginBottom: 16,
              borderWidth: 1,
              backgroundColor: urgentCount
                ? theme.dangerSoft
                : theme.warningSoft,
              borderColor: urgentCount ? theme.dangerLine : theme.line,
            }}
          >
            <Icon
              name={urgentCount ? "warning" : "alert-circle"}
              size={20}
              color={urgentCount ? theme.danger : theme.warning}
            />
            <View style={{ flex: 1 }}>
              <Label
                weight="semibold"
                style={{ color: urgentCount ? theme.danger : theme.warning }}
              >
                {urgentCount
                  ? `${urgentCount} schedule conflict${urgentCount === 1 ? "" : "s"} need${urgentCount === 1 ? "s" : ""} attention`
                  : `${otherCount} heads-up${otherCount === 1 ? "" : "s"} to review`}
              </Label>
              <Label size={12} tone="muted">
                {urgentCount && otherCount
                  ? `Plus ${otherCount} smaller heads-up${otherCount === 1 ? "" : "s"} · next two weeks`
                  : "In the next two weeks"}
              </Label>
            </View>
          </View>
          {conflicts.map((conflict) => {
            const pair = pairOf(conflict);
            const status = data.conflictStatus[conflict.id] ?? "unresolved";
            const bothFixed = pair === "fixed_fixed";
            const look = conflictLook(conflict, theme);
            return (
              <Card
                key={conflict.id}
                style={{
                  borderColor: look.line,
                  borderLeftWidth: 4,
                  borderLeftColor: look.color,
                }}
              >
                <ConflictHeading conflict={conflict} />
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 12,
                  }}
                >
                  {status === "unresolved" ? (
                    <Badge
                      icon="ellipse"
                      color={look.soft}
                      textColor={look.color}
                      borderColor={look.line}
                    >
                      Unresolved
                    </Badge>
                  ) : (
                    <Badge icon="time-outline" color={theme.successSoft}>
                      {statusLabel[status]}
                    </Badge>
                  )}
                  {pair && (
                    <Badge color={palette.beige}>{pairLabel[pair]}</Badge>
                  )}
                </View>
                <View style={{ marginVertical: 14, gap: 8 }}>
                  {[conflict.first, conflict.second]
                    .filter((item): item is ScheduleItem => !!item)
                    .map((item) => (
                      <AffectedEvent
                        key={item.id}
                        item={item}
                        date={conflict.date}
                        urgent={look.urgent}
                      />
                    ))}
                </View>
                <Label style={{ marginBottom: 16 }}>{conflict.reason}</Label>
                {bothFixed ? (
                  <Button
                    icon="mail-outline"
                    onPress={() =>
                      navigation.navigate("Compose", {
                        conflictId: conflict.id,
                      })
                    }
                  >
                    {contactsOf(conflict).size
                      ? "Contact Employer or Professor"
                      : "Write a Message"}
                  </Button>
                ) : (
                  <Button
                    onPress={() =>
                      navigation.navigate("Resolve", {
                        conflictId: conflict.id,
                      })
                    }
                  >
                    Resolve Conflict
                  </Button>
                )}
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                  }}
                >
                  <Button
                    variant="ghost"
                    small
                    onPress={() =>
                      bothFixed
                        ? navigation.navigate("Resolve", {
                            conflictId: conflict.id,
                          })
                        : navigation.navigate("ItemEditor", {
                            id: conflict.first.id,
                          })
                    }
                  >
                    {bothFixed ? "Details" : "Edit Event"}
                  </Button>
                  <Button
                    variant="ghost"
                    small
                    onPress={() => {
                      animateLayout();
                      haptics.tap();
                      ignoreConflict(conflict.id);
                    }}
                  >
                    Ignore
                  </Button>
                </View>
              </Card>
            );
          })}
        </>
      ) : (
        <Empty
          icon="checkmark-circle-outline"
          title="You're all in sync!"
          description="No scheduling conflicts were found."
        />
      )}
      {data.preferences.aiEnabled && data.preferences.conflictSuggestions && (
        <Button
          variant="secondary"
          icon="sparkles-outline"
          onPress={() => navigation.navigate("Chat")}
        >
          Ask CalenBud to Fix
        </Button>
      )}
    </Screen>
  );
}

function OptionCard({
  option,
  target,
  busy,
  disabled,
  onChoose,
}: {
  option: Option;
  target: ScheduleItem;
  busy: boolean;
  disabled: boolean;
  onChoose: () => void;
}) {
  // The time is shown above, so the explanation starts at its reasoning.
  const reasoning = option.explanation.replace(/^.*?\. (?=This )/, "");
  return (
    <Card>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Badge>
          {option.rank === 1 ? "Best fit" : `Option ${option.rank}`}
        </Badge>
        <Badge
          color={palette.beige}
        >{`${Math.round(option.score * 100)}% match`}</Badge>
        {option.kind === "split" && (
          <Badge
            color={palette.gold}
          >{`Split into ${option.blocks.length} blocks`}</Badge>
        )}
      </View>
      <Label size={17} weight="semibold" style={{ marginTop: 12 }}>
        {option.kind === "split"
          ? `Split ${target.title}`
          : `Move ${target.title}`}
      </Label>
      {option.blocks.map((block) => (
        <Label key={`${block.date}-${block.start}`} tone="muted">
          {`${formatDate(block.date)} · ${formatTime(block.start)} – ${formatTime(block.end)}`}
        </Label>
      ))}
      <Label size={12} tone="muted" style={{ marginTop: 10, marginBottom: 14 }}>
        {reasoning}
      </Label>
      <Button disabled={disabled} onPress={onChoose}>
        {busy ? "Saving…" : "Choose this time"}
      </Button>
    </Card>
  );
}

export function ResolveScreen({ route, navigation }: StackProps<"Resolve">) {
  const { data, ignoreConflict, setConflictStatus } = useApp();
  const theme = useTheme();
  const recovery = useRecovery();
  // Reloads always use the latest schedule, even from older callbacks.
  const latest = useRef(recovery);
  latest.current = recovery;
  const conflict = recovery.findConflict(route.params.conflictId);
  const plan = conflict?.second
    ? resolutionPlan(conflict.first, conflict.second)
    : null;
  const [chosenId, setChosenId] = useState<string | null>(null);
  const target: ScheduleItem | null = !conflict
    ? null
    : !conflict.second
      ? isFixed(conflict.first)
        ? null
        : conflict.first
      : plan?.action === "reschedule"
        ? plan.move
        : plan?.action === "choose"
          ? (plan.options.find((item) => item.id === chosenId) ?? null)
          : null;
  const [result, setResult] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; suggestions: Suggestions }
  >({ status: "idle" });
  const [approving, setApproving] = useState<string | null>(null);
  // One idempotency key per option, reused if the student retries.
  const keys = useRef(new Map<string, string>());
  const targetId = target?.id;
  const load = useCallback(() => {
    if (!target || !conflict) return;
    setResult({ status: "loading" });
    latest.current
      .suggestions(target, conflict.date, conflict.id)
      .then((suggestions) => setResult({ status: "ready", suggestions }))
      .catch((error) =>
        setResult({ status: "error", message: messageOf(error) }),
      );
    // Reload when the event to move changes, not on every schedule edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, conflict?.id]);
  useEffect(load, [load]);

  if (!conflict)
    return (
      <Screen>
        <Header title="All in sync" back={navigation.goBack} />
        <Empty
          title="This conflict is resolved."
          action="Go Back"
          onPress={navigation.goBack}
        />
      </Screen>
    );
  const status = data.conflictStatus[conflict.id] ?? "unresolved";
  const look = conflictLook(conflict, theme);
  const items = [conflict.first, conflict.second].filter(
    (item): item is ScheduleItem => !!item,
  );
  const apply = (option: Option) => {
    if (!target) return;
    const times = option.blocks
      .map(
        (block) =>
          `${formatDate(block.date, true)} · ${formatTime(block.start)} – ${formatTime(block.end)}`,
      )
      .join("\n");
    dialog.alert(
      option.kind === "split"
        ? `Split ${target.title}?`
        : `Move ${target.title}?`,
      `${times}${option.kind === "split" ? `\n\nThe ${formatDuration(minutes(target.end) - minutes(target.start))} session becomes ${option.blocks.length} shorter blocks.` : ""}${target.repeat !== "Never" ? `\n\nOnly the ${formatDate(conflict.date, true)} occurrence moves. The rest of the series stays.` : ""}`,
      [
        { text: "Keep Current Time", style: "cancel" },
        {
          text: option.kind === "split" ? "Split Session" : "Confirm New Time",
          onPress: async () => {
            setApproving(option.suggestionId);
            try {
              const key = keys.current.get(option.suggestionId) ?? uuid();
              keys.current.set(option.suggestionId, key);
              const calendar = await recovery.approve(option, key, conflict.id);
              haptics.success();
              if (calendar?.status === "failed")
                dialog.alert(
                  "Saved in ShiftSync",
                  calendar.message,
                  undefined,
                  {
                    tone: "warning",
                  },
                );
              else if (calendar?.status === "not_connected")
                dialog.alert(
                  "Saved in ShiftSync",
                  "Google Calendar wasn't updated because it's no longer connected.",
                  undefined,
                  { tone: "warning" },
                );
              navigation.goBack();
            } catch (error) {
              haptics.warning();
              if (
                error instanceof ApiError &&
                error.code === "STALE_SUGGESTION"
              ) {
                dialog.alert(
                  "That time is no longer free",
                  `${error.message}\n\nHere are updated options.`,
                  [{ text: "See Updated Options" }],
                  { tone: "warning" },
                );
                load();
              } else
                dialog.alert(
                  "We couldn't save this change",
                  messageOf(error),
                  undefined,
                  { tone: "warning" },
                );
            } finally {
              setApproving(null);
            }
          },
        },
      ],
    );
  };
  const options =
    result.status === "ready" && result.suggestions.status === "OK"
      ? result.suggestions.options
      : [];
  const summary =
    plan?.action === "communicate"
      ? "Both commitments are fixed, so I won't move either one."
      : plan?.action === "choose" && !target
        ? "Both are flexible and equally important. Which one should move?"
        : !target
          ? "This commitment is fixed, so I won't move it."
          : result.status === "loading"
            ? "Looking for times that fit…"
            : options.length
              ? `I found ${options.length} time${options.length === 1 ? "" : "s"} for ${target.title}. You decide what works.`
              : result.status === "ready"
                ? "No valid time fits right now."
                : "Let's find a better time.";
  return (
    <Screen>
      <Header
        title="Find a better fit"
        subtitle="A little breathing room for your schedule."
        back={navigation.goBack}
      />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 18,
          marginBottom: 24,
        }}
      >
        <Buddy />
        <View style={{ flex: 1 }}>
          <Label weight="semibold">
            {data.preferences.aiEnabled
              ? "CalenBud’s suggestions"
              : "Available alternatives"}
          </Label>
          <Label tone="muted">{summary}</Label>
        </View>
      </View>
      <Card
        style={{
          borderColor: look.line,
          borderLeftWidth: 4,
          borderLeftColor: look.color,
        }}
      >
        <ConflictHeading conflict={conflict} />
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 12,
            marginBottom: 12,
          }}
        >
          {status === "unresolved" ? (
            <Badge
              icon="ellipse"
              color={look.soft}
              textColor={look.color}
              borderColor={look.line}
            >
              Unresolved
            </Badge>
          ) : (
            <Badge
              icon={status === "resolved" ? "checkmark-circle" : "time-outline"}
              color={theme.successSoft}
            >
              {statusLabel[status]}
            </Badge>
          )}
          {plan && (
            <Badge color={palette.beige}>{pairLabel[plan.pairType]}</Badge>
          )}
        </View>
        {items.map((item) => (
          <View key={item.id} style={{ marginBottom: 8 }}>
            <Label weight="semibold">{item.title}</Label>
            <Label size={13} tone="muted">
              {`${formatTime(item.start)} – ${formatTime(item.end)} · ${isFixed(item) ? "Fixed" : `Flexible · ${item.priority} priority`}`}
            </Label>
          </View>
        ))}
        <Label style={{ marginTop: 4 }}>{conflict.reason}</Label>
      </Card>
      {plan?.action === "communicate" && (
        <Card>
          <Label weight="semibold">Neither can be moved automatically</Label>
          <Label style={{ marginTop: 8 }}>
            You can write to your employer, your professor, or both. You'll
            review every message and choose whether to send it.
          </Label>
          <View style={{ marginTop: 14, gap: 8 }}>
            <Button
              icon="mail-outline"
              onPress={() =>
                navigation.navigate("Compose", { conflictId: conflict.id })
              }
            >
              Contact Employer or Professor
            </Button>
            {status !== "resolved" && (
              <Button
                variant="secondary"
                onPress={() => {
                  haptics.success();
                  setConflictStatus(conflict.id, "resolved");
                  navigation.goBack();
                }}
              >
                Mark as Resolved
              </Button>
            )}
          </View>
        </Card>
      )}
      {plan?.action === "choose" && (
        <>
          <Section title="Which one should move?" />
          {plan.options.map((item) => (
            <Choice
              key={item.id}
              label={`Move ${item.title}`}
              detail={`${formatTime(item.start)} – ${formatTime(item.end)} · ${item.priority} priority`}
              selected={chosenId === item.id}
              onPress={() => {
                animateLayout();
                setChosenId(item.id);
              }}
            />
          ))}
        </>
      )}
      {!conflict.second && !target && (
        <Card>
          <Label>
            This fixed commitment is outside your available hours. Update your
            availability or edit the event if the time is wrong.
          </Label>
          <View style={{ marginTop: 12 }}>
            <Button
              variant="secondary"
              onPress={() => navigation.navigate("Availability")}
            >
              Update Availability
            </Button>
          </View>
        </Card>
      )}
      {target && result.status === "loading" && (
        <View
          accessibilityLiveRegion="polite"
          style={{ alignItems: "center", padding: 24, gap: 10 }}
        >
          <ActivityIndicator color={palette.teal} />
          <Label tone="muted">
            Checking your availability, breaks and deadlines…
          </Label>
        </View>
      )}
      {target && result.status === "error" && (
        <Empty
          icon="cloud-offline-outline"
          title="We couldn't load suggestions."
          description={result.message}
          action="Try Again"
          onPress={load}
        />
      )}
      {target &&
        result.status === "ready" &&
        result.suggestions.status !== "OK" && (
          <Empty
            icon="hourglass-outline"
            title={
              result.suggestions.status === "NOT_MOVABLE"
                ? "This one stays put."
                : "No valid time fits."
            }
            description={result.suggestions.reason}
          />
        )}
      {target && options.length > 0 && (
        <FadeIn>
          {options.map((option) => (
            <OptionCard
              key={option.suggestionId}
              option={option}
              target={target}
              busy={approving === option.suggestionId}
              disabled={approving !== null}
              onChoose={() => apply(option)}
            />
          ))}
          <Label size={12} tone="muted" style={{ marginBottom: 12 }}>
            Every option fits your availability, breaks, travel time and
            deadlines. It's checked again when you choose it.
          </Label>
        </FadeIn>
      )}
      {data.preferences.aiEnabled && (
        <ExplainCard load={() => recovery.explain({ conflict })} />
      )}
      <Button
        variant="secondary"
        onPress={() =>
          navigation.navigate("ItemEditor", {
            id: target?.id ?? conflict.first.id,
          })
        }
      >
        Edit Event
      </Button>
      <View style={{ marginTop: 12 }}>
        <Button
          variant="ghost"
          onPress={() => {
            haptics.tap();
            ignoreConflict(conflict.id);
            navigation.goBack();
          }}
        >
          Keep Both · Ignore Conflict
        </Button>
      </View>
    </Screen>
  );
}
