import React, { useState } from "react";
import { Pressable, View } from "react-native";
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Brand,
  Buddy,
  Icon,
  Row,
  Sheet,
  type IconName,
} from "../components/ui";
import { useApp } from "../store/AppStore";
import { fonts, palette, useTheme } from "../theme";
import type { ItemKind } from "../domain/types";
import type { RootStackParamList, TabParamList } from "./types";
import { useRootNavigation } from "./types";
import { HomeScreen } from "../screens/HomeScreen";
import { CalendarScreen } from "../screens/CalendarScreen";
import { ShiftsScreen } from "../screens/ShiftsScreen";
import { ConflictsScreen, ResolveScreen } from "../screens/ConflictScreens";
import { ItemDetailsScreen, ItemEditorScreen } from "../screens/ItemScreens";
import { AvailabilityScreen } from "../screens/AvailabilityScreen";
import { TasksScreen } from "../screens/TasksScreen";
import {
  LoginScreen,
  SignUpScreen,
  WelcomeScreen,
} from "../screens/AuthScreens";
import { OnboardingScreen } from "../screens/OnboardingScreen";
import { ChatScreen } from "../screens/ChatScreen";
import {
  ConnectedCalendarsScreen,
  PersonalInfoScreen,
  ProfileScreen,
  SearchScreen,
  SupportScreen,
} from "../screens/AccountScreens";
import { SettingsScreen } from "../screens/SettingsScreen";
import { NotificationsScreen } from "../screens/NotificationsScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<TabParamList>();
const icons: Record<keyof TabParamList, [IconName, IconName]> = {
  Home: ["home", "home-outline"],
  Calendar: ["calendar", "calendar-outline"],
  Add: ["add", "add"],
  Conflicts: ["shield-checkmark", "shield-checkmark-outline"],
  Shifts: ["time", "time-outline"],
};
function AddPlaceholder() {
  return <View />;
}
function MainTabs() {
  const theme = useTheme();
  const { data } = useApp();
  const inset = useSafeAreaInsets();
  const navigation = useRootNavigation();
  const [addOpen, setAddOpen] = useState(false);
  const add = (kind: ItemKind) => {
    setAddOpen(false);
    navigation.navigate("ItemEditor", { kind });
  };
  return (
    <View style={{ flex: 1 }}>
      <Tabs.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          sceneStyle: { backgroundColor: theme.background },
          tabBarActiveTintColor: theme.dark ? palette.aqua : "#27666C",
          tabBarInactiveTintColor: theme.muted,
          tabBarStyle: {
            backgroundColor: theme.surface,
            borderTopColor: theme.line,
            height: 72 + Math.max(inset.bottom, 12),
            paddingTop: 8,
            paddingBottom: Math.max(inset.bottom, 12),
            elevation: 0,
          },
          tabBarLabelStyle: {
            fontFamily: fonts.medium,
            fontSize: 12,
            marginTop: 4,
          },
          tabBarIcon: ({ focused, color }) =>
            route.name === "Add" ? (
              <View
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 18,
                  backgroundColor: palette.teal,
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: -17,
                  borderWidth: 4,
                  borderColor: theme.surface,
                }}
              >
                <Icon name="add" size={30} color={palette.ink} />
              </View>
            ) : (
              <View
                style={{
                  width: 45,
                  height: 30,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 10,
                  backgroundColor: focused
                    ? theme.dark
                      ? "#304E55"
                      : "#E2F1E9"
                    : "transparent",
                }}
              >
                <Icon
                  name={icons[route.name][focused ? 0 : 1]}
                  color={color}
                  size={23}
                />
              </View>
            ),
        })}
      >
        <Tabs.Screen name="Home" component={HomeScreen} />
        <Tabs.Screen name="Calendar" component={CalendarScreen} />
        <Tabs.Screen
          name="Add"
          component={AddPlaceholder}
          listeners={{
            tabPress: (event) => {
              event.preventDefault();
              setAddOpen(true);
            },
          }}
          options={{
            tabBarAccessibilityLabel:
              "Add event, shift, task, or unavailable time",
          }}
        />
        <Tabs.Screen name="Conflicts" component={ConflictsScreen} />
        <Tabs.Screen name="Shifts" component={ShiftsScreen} />
      </Tabs.Navigator>
      {data.preferences.aiEnabled && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ask CalenBud"
          onPress={() => navigation.navigate("Chat")}
          style={({ pressed }) => ({
            position: "absolute",
            right: 22,
            bottom: 84 + Math.max(inset.bottom, 12),
            padding: 6,
            borderRadius: 24,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.line,
            shadowColor: palette.navy,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.12,
            shadowRadius: 10,
            elevation: 5,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Buddy size={44} />
        </Pressable>
      )}
      <Sheet
        visible={addOpen}
        title="What would you like to add?"
        onClose={() => setAddOpen(false)}
      >
        <Row
          icon="calendar-outline"
          title="Event"
          detail="Appointments, meetings, and personal plans"
          onPress={() => add("event")}
        />
        <Row
          icon="time-outline"
          title="Shift"
          detail="Keep your work hours together"
          onPress={() => add("shift")}
        />
        <Row
          icon="checkbox-outline"
          title="Task"
          detail="Make a little progress"
          onPress={() => add("task")}
        />
        <Row
          icon="ban-outline"
          title="Unavailable Time"
          detail="Protect some time for yourself"
          onPress={() => add("unavailable")}
        />
      </Sheet>
    </View>
  );
}
export function AppNavigator() {
  const { data } = useApp();
  const theme = useTheme();
  const base = theme.dark ? DarkTheme : DefaultTheme;
  return (
    <NavigationContainer
      theme={{
        ...base,
        colors: {
          ...base.colors,
          primary: palette.teal,
          background: theme.background,
          card: theme.surface,
          text: theme.text,
          border: theme.line,
          notification: palette.gold,
        },
      }}
    >
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.background },
          animation: "slide_from_right",
          animationDuration: 200,
        }}
      >
        {!data.profile ? (
          <Stack.Group navigationKey="signed-out">
            <Stack.Screen name="Welcome" component={WelcomeScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="SignUp" component={SignUpScreen} />
          </Stack.Group>
        ) : !data.onboarded ? (
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        ) : (
          <Stack.Group navigationKey="signed-in">
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="ItemEditor" component={ItemEditorScreen} />
            <Stack.Screen name="ItemDetails" component={ItemDetailsScreen} />
            <Stack.Screen name="Resolve" component={ResolveScreen} />
            <Stack.Screen name="Availability" component={AvailabilityScreen} />
            <Stack.Screen name="Tasks" component={TasksScreen} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="Search" component={SearchScreen} />
            <Stack.Screen
              name="Notifications"
              component={NotificationsScreen}
            />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="PersonalInfo" component={PersonalInfoScreen} />
            <Stack.Screen
              name="ConnectedCalendars"
              component={ConnectedCalendarsScreen}
            />
            <Stack.Screen name="Support" component={SupportScreen} />
          </Stack.Group>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
