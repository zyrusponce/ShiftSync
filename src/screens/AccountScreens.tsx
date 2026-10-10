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
} from "../components/ui";
import { ItemCard } from "../components/ItemCard";
import { searchItems } from "../domain/schedule";
import { useApp } from "../store/AppStore";
import type { StackProps } from "../navigation/types";
import { palette } from "../theme";

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
  const { data, logout } = useApp();
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
        <Badge>{profile?.role || "Employee"}</Badge>
      </View>
      <Card>
        <Row
          icon="person-outline"
          title="Personal Information"
          onPress={() => navigation.navigate("PersonalInfo")}
        />
        <Row
          icon="calendar-outline"
          title="Connected Calendars"
          detail="Connect your work and personal calendars"
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
          Alert.alert(
            "Log out of the demo?",
            "Your schedule stays on this device. This demo is not an authenticated account.",
            [
              { text: "Stay here", style: "cancel" },
              { text: "Log Out", onPress: logout },
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
        ShiftSync · Local demo · Version 1.0.0
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
      setError("Please add your name and a valid email address.");
      return;
    }
    setProfile({
      ...profile,
      name: profile.name.trim(),
      email: profile.email.trim().toLowerCase(),
    });
    navigation.goBack();
  };
  return (
    <Screen
      footer={
        <View style={{ gap: 8 }}>
          {error ? <Label>{error}</Label> : null}
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
      {["Student", "Employee", "Manager", "Freelancer", "Other"].map((role) => (
        <Choice
          key={role}
          label={role}
          selected={profile.role === role}
          onPress={() => setDraft((current) => ({ ...current, role }))}
        />
      ))}
    </Screen>
  );
}
export function ConnectedCalendarsScreen({
  navigation,
}: StackProps<"ConnectedCalendars">) {
  return (
    <Screen>
      <Header title="Connected calendars" back={navigation.goBack} />
      <Empty
        icon="link-outline"
        title="Your calendars, together."
        description="This demo uses your local ShiftSync calendar. External calendar sync needs an authorized calendar service."
      />
      <Card>
        <Row
          icon="logo-google"
          title="Google Calendar"
          detail="Not connected"
          onPress={() =>
            Alert.alert(
              "Connect Google Calendar",
              "Google OAuth and a calendar-sync backend need to be configured before you can connect an account. Your ShiftSync events are available in the Calendar tab.",
            )
          }
        />
        <Row
          icon="logo-microsoft"
          title="Microsoft Outlook"
          detail="Not connected"
          onPress={() =>
            Alert.alert(
              "Connect Outlook",
              "Microsoft OAuth and a calendar-sync backend need to be configured before you can connect an account.",
            )
          }
        />
      </Card>
    </Screen>
  );
}
export function SupportScreen({ navigation }: StackProps<"Support">) {
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
          This demo stores your profile and schedule on this device. There is no
          cloud backup, online authentication, external calendar sync, or push
          delivery. Uninstalling or clearing app data removes the local
          schedule.
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
