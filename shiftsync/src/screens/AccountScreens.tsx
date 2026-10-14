import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
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
} from "../components/ui";
import { ItemCard } from "../components/ItemCard";
import { FadeIn, haptics } from "../components/motion";
import { PROFILE_ROLES } from "../domain/persistence";
import { searchItems } from "../domain/schedule";
import { useApp } from "../store/AppStore";
import type { StackProps } from "../navigation/types";
import { palette } from "../theme";
import type { GoogleStatus } from "../domain/contract";
import { api, messageOf } from "../services/api";
import { accountsEnabled, usesLocalhost } from "../services/config";
import { connectGoogle } from "../services/googleSignIn";

export function SearchScreen({ navigation }: StackProps<"Search">) {
  const { data } = useApp();
  const [query, setQuery] = useState("");
  const results = query.trim() ? searchItems(data.items, query) : [];
  return (
    <Screen>
      <Header
        title="Find your plans"
        subtitle="Events, shifts, tasks, or a date."
        back={navigation.goBack}
      />
      <Field
        label="Search schedule"
        placeholder="Try meeting, a place, or October 9"
        value={query}
        onChangeText={setQuery}
        autoFocus
        clearButtonMode="while-editing"
      />
      {query.trim() ? (
        results.length ? (
          <>
            <Label size={12} tone="muted" style={{ marginBottom: 14 }}>
              {results.length} result{results.length === 1 ? "" : "s"}
            </Label>
            {results.map((item) => (
              <ItemCard key={item.id} item={item} showDate />
            ))}
          </>
        ) : (
          <Empty
            icon="search-outline"
            title="No matches yet."
            description="Try another title, category, location, or date."
          />
        )
      ) : (
        <Empty
          icon="search-outline"
          title="What are you looking for?"
          description="Your plans are just a search away."
        />
      )}
    </Screen>
  );
}
export function ProfileScreen({ navigation }: StackProps<"Profile">) {
  const { data, logout, account, sync } = useApp();
  const profile = data.profile;
  return (
    <Screen>
      <Header title="Your space" back={navigation.goBack} />
      <View style={{ alignItems: "center", gap: 9, marginBottom: 28 }}>
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: 30,
            backgroundColor: palette.beige,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Label size={30} weight="semibold" style={{ color: palette.navy }}>
            {profile?.name[0]?.toUpperCase() ?? "A"}
          </Label>
        </View>
        <Label size={22} weight="bold">
          {profile?.name}
        </Label>
        <Label tone="muted">{profile?.email}</Label>
        {profile?.roles.length ? (
          <Badge>{profile.roles.join(" · ")}</Badge>
        ) : null}
      </View>
      <Card>
        <Row
          icon="person-outline"
          title="Personal Information"
          onPress={() => navigation.navigate("PersonalInfo")}
        />
        <Row
          icon="link-outline"
          title="Connected Services"
          detail="Google Calendar and Gmail"
          onPress={() => navigation.navigate("ConnectedCalendars")}
        />
        <Row
          icon="sunny-outline"
          title="Availability"
          onPress={() => navigation.navigate("Availability")}
        />
        <Row
          icon="checkbox-outline"
          title="Tasks"
          onPress={() => navigation.navigate("Tasks")}
        />
        <Row
          icon="notifications-outline"
          title="Notifications"
          onPress={() => navigation.navigate("Notifications")}
        />
      </Card>
      <Card>
        <Row
          icon="sparkles-outline"
          title="AI Preferences"
          onPress={() =>
            navigation.navigate("Settings", { section: "AI Preferences" })
          }
        />
        <Row
          icon="color-palette-outline"
          title="Appearance"
          detail={data.preferences.appearance}
          onPress={() =>
            navigation.navigate("Settings", { section: "Appearance" })
          }
        />
        <Row
          icon="shield-checkmark-outline"
          title="Security"
          onPress={() =>
            navigation.navigate("Settings", { section: "Security" })
          }
        />
        <Row
          icon="settings-outline"
          title="Settings"
          onPress={() => navigation.navigate("Settings")}
        />
        <Row
          icon="help-circle-outline"
          title="Help & Support"
          onPress={() => navigation.navigate("Support")}
        />
      </Card>
      <Button
        variant="ghost"
        icon="log-out-outline"
        onPress={() =>
          dialog.alert(
            account ? "Log out?" : "Log out of the demo?",
            account
              ? sync.pending
                ? `${sync.pending} change${sync.pending === 1 ? " hasn't" : "s haven't"} synced yet and will be lost if you log out now. Connect to the internet first to keep ${sync.pending === 1 ? "it" : "them"}.`
                : "Your schedule stays safe in your account. It is removed from this phone until you log in again."
              : "Your schedule stays on this device. This demo is not an authenticated account.",
            [
              { text: "Stay Logged In", style: "cancel" },
              {
                text: "Log Out",
                style: sync.pending ? "destructive" : "default",
                onPress: () => void logout(),
              },
            ],
          )
        }
      >
        Log Out
      </Button>
      <Label
        size={12}
        tone="muted"
        style={{ textAlign: "center", marginTop: 20 }}
      >
        {account
          ? `ShiftSync · Signed in as ${account.email} · Version 1.0.0`
          : "ShiftSync · Local demo · Version 1.0.0"}
      </Label>
    </Screen>
  );
}
export function PersonalInfoScreen({ navigation }: StackProps<"PersonalInfo">) {
  const { data, setProfile } = useApp();
  const [profile, setDraft] = useState(data.profile!);
  const [error, setError] = useState("");
  const save = () => {
    if (
      !profile.name.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim())
    ) {
      haptics.error();
      setError("Please add your name and a valid email address.");
      return;
    }
    setProfile({
      ...profile,
      name: profile.name.trim(),
      email: profile.email.trim().toLowerCase(),
    });
    haptics.success();
    navigation.goBack();
  };
  return (
    <Screen
      footer={
        <View style={{ gap: 8 }}>
          {error ? (
            <FadeIn trigger={error}>
              <Label>{error}</Label>
            </FadeIn>
          ) : null}
          <Button onPress={save}>Save Changes</Button>
        </View>
      }
    >
      <Header title="Personal information" back={navigation.goBack} />
      <Field
        label="Full name"
        value={profile.name}
        onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
        autoComplete="name"
      />
      <Field
        label="Email"
        value={profile.email}
        onChangeText={(email) => setDraft((current) => ({ ...current, email }))}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <Field
        label="Work / organization"
        value={profile.organization}
        onChangeText={(organization) =>
          setDraft((current) => ({ ...current, organization }))
        }
      />
      <Section title="How you use ShiftSync" />
      {PROFILE_ROLES.map((role) => (
        <Choice
          key={role}
          label={role}
          selected={profile.roles.includes(role)}
          onPress={() =>
            setDraft((current) => ({
              ...current,
              roles: PROFILE_ROLES.filter((value) =>
                value === role
                  ? !current.roles.includes(role)
                  : current.roles.includes(value),
              ),
            }))
          }
        />
      ))}
    </Screen>
  );
}
export function ConnectedCalendarsScreen({
  navigation,
}: StackProps<"ConnectedCalendars">) {
  const { account, syncGoogleCalendar } = useApp();
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<null | "connect" | "sync" | "disconnect">(
    null,
  );
  const load = useCallback(() => {
    if (!account) return;
    setError("");
    api
      .googleStatus()
      .then(setStatus)
      .catch((failure) => setError(messageOf(failure)));
  }, [account]);
  useEffect(load, [load]);
  // The consent page returns to this deep link with a one-time handle.
  const connect = async () => {
    setBusy("connect");
    try {
      const next = await connectGoogle();
      if (!next) return;
      setStatus(next);
      haptics.success();
    } catch (failure) {
      haptics.error();
      dialog.alert("Google wasn't connected", messageOf(failure), undefined, {
        tone: "warning",
      });
    } finally {
      setBusy(null);
    }
  };
  const syncNow = async () => {
    setBusy("sync");
    try {
      const outcome = await syncGoogleCalendar();
      if (outcome.status !== "synced") {
        haptics.warning();
        dialog.alert(
          "Sync didn't start",
          outcome.status === "reconnect"
            ? "Google access expired. Reconnect Google to keep your calendar in sync."
            : "Connect Google Calendar first.",
          undefined,
          { tone: "warning" },
        );
        load();
        return;
      }
      const { result } = outcome;
      haptics.success();
      const skipped = result.skipped.map(
        (s) => `${s.count} skipped: ${s.reason.toLowerCase()}`,
      );
      dialog.alert(
        "Calendar synced",
        [
          `${result.imported} new, ${result.updated} updated, ${result.unchanged} unchanged.`,
          ...skipped,
          ...result.needsReview.map((title) => `Needs review: ${title}.`),
        ].join("\n"),
        [{ text: "Done" }],
        { tone: "success" },
      );
      load();
    } catch (failure) {
      haptics.error();
      dialog.alert("Sync didn't finish", messageOf(failure), undefined, {
        tone: "warning",
      });
      load();
    } finally {
      setBusy(null);
    }
  };
  const disconnect = () =>
    dialog.alert(
      "Disconnect Google?",
      "ShiftSync will stop reading your calendar and can't save Gmail drafts or send email. Events already imported stay in ShiftSync.",
      [
        { text: "Keep Connected", style: "cancel" },
        {
          text: "Disconnect Google",
          style: "destructive",
          onPress: async () => {
            setBusy("disconnect");
            try {
              setStatus(await api.googleDisconnect());
              haptics.tap();
            } catch (failure) {
              dialog.alert("Still connected", messageOf(failure), undefined, {
                tone: "warning",
              });
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  if (!account)
    return (
      <Screen>
        <Header title="Connected services" back={navigation.goBack} />
        <Empty
          icon="link-outline"
          title="Your calendars, together."
          description={
            accountsEnabled
              ? "Log in to a ShiftSync account to connect Google Calendar and Gmail. The demo keeps everything on this phone."
              : "This demo uses your local ShiftSync calendar. External calendar sync needs the ShiftSync server."
          }
        />
      </Screen>
    );
  const lastSync = status?.lastSyncAt
    ? new Date(status.lastSyncAt).toLocaleString()
    : null;
  return (
    <Screen>
      <Header
        title="Connected services"
        subtitle="Google Calendar and Gmail, on your terms."
        back={navigation.goBack}
      />
      {!status && !error && (
        <View style={{ alignItems: "center", padding: 24 }}>
          <ActivityIndicator color={palette.teal} />
        </View>
      )}
      {error ? (
        <Empty
          icon="cloud-offline-outline"
          title="We couldn't check your connections."
          description={error}
          action="Try Again"
          onPress={load}
        />
      ) : null}
      {status && !status.configured && (
        <Empty
          icon="construct-outline"
          title="Google isn't set up yet."
          description="The ShiftSync server still needs its Google OAuth settings. Everything else works without it."
        />
      )}
      {status?.configured && (
        <>
          <Card>
            <Row
              icon="logo-google"
              title={
                status.connected
                  ? (status.email ?? "Google account")
                  : "Google account"
              }
              detail={
                status.needsReconnect
                  ? "Connection expired · reconnect to keep syncing"
                  : status.connected
                    ? "Connected"
                    : "Not connected"
              }
            />
            <Row
              icon="calendar-outline"
              title="Google Calendar"
              detail={
                status.calendar
                  ? status.lastSyncError
                    ? `Last sync failed: ${status.lastSyncError}`
                    : lastSync
                      ? `Last synced ${lastSync}`
                      : "Connected · not synced yet"
                  : "Not connected"
              }
            />
            <Row
              icon="mail-outline"
              title="Gmail"
              detail={
                status.gmail
                  ? "Drafts and confirmed sends only"
                  : "Not connected"
              }
            />
          </Card>
          <Label size={12} tone="muted" style={{ marginBottom: 16 }}>
            ShiftSync asks only for calendar events and email drafting. It never
            sends an email until you confirm it, and never changes a Google
            event without your approval.
          </Label>
          <View style={{ gap: 10 }}>
            {(!status.connected ||
              status.needsReconnect ||
              !status.calendar ||
              !status.gmail) && (
              <Button
                icon="logo-google"
                disabled={busy !== null}
                onPress={connect}
              >
                {busy === "connect"
                  ? "Opening Google…"
                  : status.connected
                    ? "Reconnect Google"
                    : "Connect Google"}
              </Button>
            )}
            {status.calendar && !status.needsReconnect && (
              <Button
                variant="secondary"
                icon="sync-outline"
                disabled={busy !== null}
                onPress={syncNow}
              >
                {busy === "sync" ? "Syncing…" : "Sync Calendar Now"}
              </Button>
            )}
            {status.connected && (
              <Button
                variant="ghost"
                disabled={busy !== null}
                onPress={disconnect}
              >
                Disconnect Google
              </Button>
            )}
          </View>
        </>
      )}
      {usesLocalhost && (
        <Label size={12} tone="muted" style={{ marginTop: 16 }}>
          This build talks to a server on localhost, which only works in an
          emulator with adb reverse. Use your computer's network address on a
          phone.
        </Label>
      )}
    </Screen>
  );
}
export function SupportScreen({ navigation }: StackProps<"Support">) {
  const { account } = useApp();
  return (
    <Screen>
      <Header
        title="A little help"
        subtitle="Make the most of ShiftSync."
        back={navigation.goBack}
      />
      <Card>
        <Label size={17} weight="semibold">
          Add a plan
        </Label>
        <Label style={{ marginTop: 8 }}>
          Tap the center + to add an event, shift, task, or unavailable time.
          Your saved plans appear in Calendar.
        </Label>
      </Card>
      <Card>
        <Label size={17} weight="semibold">
          Keep your schedule in sync
        </Label>
        <Label style={{ marginTop: 8 }}>
          Conflicts highlights overlapping events, short gaps, and plans outside
          your availability. Choose an alternative time and confirm it before
          the event moves.
        </Label>
      </Card>
      <Card>
        <Label size={17} weight="semibold">
          Meet CalenBud
        </Label>
        <Label style={{ marginTop: 8 }}>
          Tap the friendly face above the bottom navigation. Ask about today,
          tomorrow, conflicts, or available times. This demo uses local
          scheduling rules.
        </Label>
      </Card>
      <Card>
        <Label size={17} weight="semibold">
          Your data
        </Label>
        <Label style={{ marginTop: 8 }}>
          {account
            ? "Your schedule, contacts and preferences are saved to your ShiftSync account and kept on this phone for offline use. Changes made offline sync when you reconnect. Google Calendar and Gmail are used only if you connect them, and you can disconnect at any time."
            : "This demo stores your profile and schedule on this device. There is no cloud backup, online authentication, external calendar sync, or push delivery. Uninstalling or clearing app data removes the local schedule."}
        </Label>
      </Card>
      <Button
        variant="secondary"
        onPress={() => navigation.navigate("Availability")}
      >
        Manage Availability
      </Button>
    </Screen>
  );
}
