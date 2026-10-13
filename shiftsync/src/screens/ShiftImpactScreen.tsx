// Shift Impact Analysis: preview every commitment a shift change affects,
// confirm the change, then start recovery for each affected commitment.
import React, { useCallback, useEffect, useState } from "react";
import { Alert, View } from "react-native";
import {
  Badge,
  Button,
  Card,
  Empty,
  Header,
  Label,
  Screen,
  Section,
  Skeleton,
} from "../components/ui";
import { ExplainCard } from "../components/ExplainCard";
import { FadeIn, animateLayout, haptics } from "../components/motion";
import type { ImpactEntry, ImpactReport } from "../domain/impact";
import { formatDate, formatTime } from "../domain/schedule";
import type { Slot } from "../domain/types";
import { messageOf } from "../services/api";
import { useApp } from "../store/AppStore";
import { useRecovery } from "../store/useRecovery";
import type { StackProps } from "../navigation/types";
import { palette } from "../theme";

const when = (slot: Slot) =>
  `${formatDate(slot.date, true)} · ${formatTime(slot.start)} – ${formatTime(slot.end)}`;
const actionText: Record<ImpactEntry["action"], string> = {
  reschedule: "Flexible · can move to a new time",
  communicate: "Fixed · can't move automatically",
  review: "Your unavailable time",
};

export function ShiftImpactScreen({
  route,
  navigation,
}: StackProps<"ShiftImpact">) {
  const { data, saveItem, flush } = useApp();
  const recovery = useRecovery();
  const proposed = route.params.shift;
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; report: ImpactReport; offline: boolean }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [confirmed, setConfirmed] = useState(false);
  const load = useCallback(() => {
    setState({ status: "loading" });
    recovery
      .analyzeShift(proposed)
      .then((result) => setState({ status: "ready", ...result }))
      .catch((error) =>
        setState({ status: "error", message: messageOf(error) }),
      );
    // Analyse the proposal once; the stored schedule only changes on confirm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposed]);
  useEffect(load, [load]);

  const confirm = () => {
    const failure = saveItem(proposed);
    if (failure) {
      haptics.error();
      Alert.alert("Check this shift", failure);
      return;
    }
    haptics.success();
    animateLayout();
    setConfirmed(true);
    void flush();
  };
  const entryCard = (entry: ImpactEntry) => (
    <Card key={`${entry.conflictId}-${entry.type}`}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Badge color={entry.type === "direct" ? palette.gold : palette.aqua}>
          {entry.type === "direct" ? "Overlap" : "Too close"}
        </Badge>
        <Badge color={entry.fixed ? palette.beige : palette.aqua}>
          {entry.fixed ? "Fixed" : "Flexible"}
        </Badge>
        {entry.preexisting && (
          <Badge color={palette.beige}>Already a problem</Badge>
        )}
      </View>
      <Label size={16} weight="semibold" style={{ marginTop: 12 }}>
        {entry.item.title}
      </Label>
      <Label size={13} tone="muted">
        {when({
          date: entry.date,
          start: entry.item.start,
          end: entry.item.end,
        })}
      </Label>
      <Label style={{ marginTop: 8 }}>{entry.description}</Label>
      <Label size={12} tone="muted" style={{ marginTop: 6 }}>
        {actionText[entry.action]}
        {entry.item.deadline
          ? ` · due ${formatDate(entry.item.deadline.slice(0, 10), true)}, ${formatTime(entry.item.deadline.slice(11))}`
          : ""}
      </Label>
      {confirmed && entry.action !== "review" && (
        <FadeIn style={{ marginTop: 12 }}>
          {entry.action === "reschedule" ? (
            <Button
              small
              onPress={() =>
                navigation.navigate("Resolve", { conflictId: entry.conflictId })
              }
            >
              Find a new time
            </Button>
          ) : (
            <Button
              small
              icon="mail-outline"
              onPress={() =>
                navigation.navigate("Compose", { conflictId: entry.conflictId })
              }
            >
              Contact someone
            </Button>
          )}
        </FadeIn>
      )}
      {confirmed && entry.action === "review" && (
        <View style={{ marginTop: 12 }}>
          <Button
            small
            variant="secondary"
            onPress={() =>
              navigation.navigate("ItemEditor", { id: entry.item.id })
            }
          >
            Edit unavailable time
          </Button>
        </View>
      )}
    </Card>
  );
  const original = data.items.find((item) => item.id === proposed.id);
  const report = state.status === "ready" ? state.report : null;
  const entries = report ? [...report.direct, ...report.buffer] : [];
  return (
    <Screen
      footer={
        confirmed ? (
          <View style={{ gap: 8 }}>
            <Label size={13} tone="muted">
              Shift saved. Work through each affected commitment above, or
              review them all in Conflicts.
            </Label>
            <Button
              onPress={() =>
                navigation.navigate("Main", { screen: "Conflicts" })
              }
            >
              Go to Conflicts
            </Button>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <Button
              icon="checkmark"
              disabled={state.status !== "ready"}
              onPress={confirm}
            >
              Confirm shift change
            </Button>
            <Button variant="ghost" onPress={navigation.goBack}>
              Keep current shift
            </Button>
          </View>
        )
      }
    >
      <Header
        title="Shift impact"
        subtitle={
          confirmed
            ? "Your shift is updated. Let's recover what it affects."
            : "See what changes before you commit."
        }
        back={navigation.goBack}
      />
      <Card>
        <Label size={17} weight="semibold">
          {proposed.title}
        </Label>
        {original && (
          <Label
            tone="muted"
            style={{
              marginTop: 6,
              textDecorationLine: confirmed ? "line-through" : "none",
            }}
          >
            {`Was ${when(original)}`}
          </Label>
        )}
        <Label weight="medium" style={{ marginTop: 4 }}>
          {`${confirmed ? "Now" : "New"} ${when(proposed)}`}
        </Label>
        {proposed.repeat !== "Never" && (
          <Label size={12} tone="muted" style={{ marginTop: 6 }}>
            {`Repeats ${proposed.repeat.toLowerCase()}. Every occurrence in the next ${data.preferences.planningHorizonDays} days is checked.`}
          </Label>
        )}
      </Card>
      {state.status === "loading" && (
        <>
          <Label tone="muted" style={{ marginBottom: 12 }}>
            Checking every commitment in your planning window…
          </Label>
          <Skeleton />
        </>
      )}
      {state.status === "error" && (
        <Empty
          icon="cloud-offline-outline"
          title="We couldn't check this change."
          description={state.message}
          action="Try Again"
          onPress={load}
        />
      )}
      {report && (
        <FadeIn>
          {state.status === "ready" && state.offline && (
            <Label size={12} tone="muted" style={{ marginBottom: 12 }}>
              You're offline, so this preview uses the schedule saved on this
              phone.
            </Label>
          )}
          {entries.length ? (
            <Label tone="muted" style={{ marginBottom: 4 }}>
              {`${report.counts.affected} commitment${report.counts.affected === 1 ? "" : "s"} affected between ${formatDate(report.window.from, true)} and ${formatDate(report.window.to, true)}.`}
            </Label>
          ) : (
            <Empty
              icon="checkmark-circle-outline"
              title="Nothing else is affected."
              description="This change fits around your other commitments, breaks and travel time."
            />
          )}
          {report.direct.length > 0 && <Section title="Overlaps" />}
          {report.direct.map(entryCard)}
          {report.buffer.length > 0 && (
            <Section title="Not enough time between" />
          )}
          {report.buffer.map(entryCard)}
          {report.cleared.length > 0 && (
            <>
              <Section title="No longer a problem" />
              {report.cleared.map((entry) => (
                <Card key={entry.conflictId}>
                  <Label weight="semibold">{entry.item.title}</Label>
                  <Label size={13} tone="muted">
                    {`${when({ date: entry.date, start: entry.item.start, end: entry.item.end })} · no longer clashes with this shift`}
                  </Label>
                </Card>
              ))}
            </>
          )}
          {!confirmed && report.plan.length > 0 && (
            <>
              <Section title="Recovery preview" />
              {report.plan.map((plan) => (
                <Card key={plan.conflictId}>
                  <Badge
                    color={
                      plan.result.status === "OK" ? palette.aqua : palette.gold
                    }
                  >
                    {plan.result.status === "OK"
                      ? "Suggested new time"
                      : "No free time found"}
                  </Badge>
                  <Label weight="semibold" style={{ marginTop: 10 }}>
                    {plan.title}
                  </Label>
                  <Label size={13} style={{ marginTop: 4 }}>
                    {plan.result.status === "OK"
                      ? plan.result.options[0].explanation
                      : plan.result.reason}
                  </Label>
                </Card>
              ))}
              <Label size={12} tone="muted" style={{ marginBottom: 8 }}>
                Nothing moves until you choose a time for each one.
              </Label>
            </>
          )}
          {!confirmed && report.knockOn.length > 0 && (
            <>
              <Section title="If you approve these" />
              <Label size={12} tone="muted" style={{ marginBottom: 10 }}>
                Possible knock-on effects of the suggestions above. These are
                not conflicts yet.
              </Label>
              {report.knockOn.map((effect) => (
                <Card key={`knock-${effect.conflictId}`}>
                  <Label size={13}>{effect.message}</Label>
                </Card>
              ))}
            </>
          )}
          {entries.length > 0 && (
            <ExplainCard
              title="What does this change mean?"
              load={() => recovery.explain({ shift: proposed, report })}
            />
          )}
        </FadeIn>
      )}
    </Screen>
  );
}
