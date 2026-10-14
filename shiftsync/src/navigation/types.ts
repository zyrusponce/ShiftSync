import {
  useNavigation,
  type NavigatorScreenParams,
} from "@react-navigation/native";
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from "@react-navigation/native-stack";
import type { CalendarView, ItemKind, ScheduleItem } from "../domain/types";

export type RootStackParamList = {
  Welcome: undefined;
  Login: undefined;
  SignUp: undefined;
  Onboarding: undefined;
  Main: NavigatorScreenParams<TabParamList> | undefined;
  ItemDetails: { id: string; occurrenceDate?: string };
  ItemEditor: { kind?: ItemKind; id?: string; date?: string };
  Resolve: { conflictId: string };
  ShiftImpact: { shift: ScheduleItem };
  Compose: { conflictId: string };
  Chat: undefined;
  Search: undefined;
  Notifications: undefined;
  Profile: undefined;
  Availability: undefined;
  Tasks: undefined;
  Settings: { section?: string } | undefined;
  PersonalInfo: undefined;
  ConnectedCalendars: undefined;
  Support: undefined;
};
export type TabParamList = {
  Home: undefined;
  /** Opens the calendar on a date's event list (and optionally a view). */
  Calendar: { date?: string; view?: CalendarView } | undefined;
  Add: undefined;
  Conflicts: undefined;
  Shifts: undefined;
};
export type StackProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;
export const useRootNavigation = () =>
  useNavigation<NativeStackNavigationProp<RootStackParamList>>();
