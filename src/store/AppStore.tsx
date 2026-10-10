import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createInitialData } from "../domain/seed";
import { rescheduleOccurrence, validateItem } from "../domain/schedule";
import { restoreData } from "../domain/persistence";
import { newItem } from "../domain/seed";
import type {
  AppData,
  AvailabilityDay,
  Preferences,
  Profile,
  ScheduleItem,
  Slot,
} from "../domain/types";

const STORAGE_KEY = "@shiftsync/local/v1";
type Store = {
  data: AppData;
  loading: boolean;
  loadError: boolean;
  saveError: boolean;
  retryLoad: () => void;
  retrySave: () => void;
  saveItem: (item: ScheduleItem) => string | null;
  moveOccurrence: (id: string, occurrenceDate: string, slot: Slot) => void;
  deleteItem: (id: string) => void;
  setProfile: (profile: Profile | null) => void;
  finishOnboarding: () => void;
  setAvailability: (days: AvailabilityDay[]) => void;
  setPreferences: (preferences: Partial<Preferences>) => void;
  ignoreConflict: (id: string) => void;
  markNotification: (id: string) => void;
  deleteNotification: (id: string) => void;
  logout: () => void;
};
const Context = createContext<Store | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState(createInitialData);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setLoadError(false);
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        const restored = raw ? restoreData(raw) : createInitialData();
        restored.preferences.timeZone =
          Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Manila";
        if (mounted) setData(restored);
      })
      .catch(() => {
        if (mounted) setLoadError(true);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [loadAttempt]);
  useEffect(() => {
    if (loading || loadError) return;
    const snapshot = JSON.stringify(data);
    queue.current = queue.current
      .then(() => AsyncStorage.setItem(STORAGE_KEY, snapshot))
      .then(() => setSaveError(false))
      .catch(() => setSaveError(true));
  }, [data, loading, loadError, saveAttempt]);
  const saveItem = useCallback((item: ScheduleItem) => {
    const error = validateItem(item);
    if (error) return error;
    setData((current) => ({
      ...current,
      items: current.items.some((value) => value.id === item.id)
        ? current.items.map((value) =>
            value.id === item.id
              ? { ...item, title: item.title.trim() }
              : value,
          )
        : [...current.items, { ...item, title: item.title.trim() }],
      ignoredConflicts: current.ignoredConflicts.filter(
        (id) => !id.split(":").includes(item.id),
      ),
    }));
    return null;
  }, []);
  const store = useMemo<Store>(
    () => ({
      data,
      loading,
      loadError,
      saveError,
      saveItem,
      moveOccurrence: (id, occurrenceDate, slot) => {
        const newId = newItem().id;
        setData((current) => ({
          ...current,
          items: rescheduleOccurrence(
            current.items,
            id,
            occurrenceDate,
            slot,
            newId,
          ),
          ignoredConflicts: current.ignoredConflicts.filter(
            (value) => !value.split(":").includes(id),
          ),
        }));
      },
      retryLoad: () => setLoadAttempt((value) => value + 1),
      retrySave: () => setSaveAttempt((value) => value + 1),
      deleteItem: (id) =>
        setData((current) => ({
          ...current,
          items: current.items.filter((value) => value.id !== id),
        })),
      setProfile: (profile) => setData((current) => ({ ...current, profile })),
      finishOnboarding: () =>
        setData((current) => ({ ...current, onboarded: true })),
      setAvailability: (availability) =>
        setData((current) => ({
          ...current,
          availability,
          ignoredConflicts: [],
        })),
      setPreferences: (preferences) =>
        setData((current) => ({
          ...current,
          preferences: { ...current.preferences, ...preferences },
          ignoredConflicts: [],
        })),
      ignoreConflict: (id) =>
        setData((current) => ({
          ...current,
          ignoredConflicts: [...new Set([...current.ignoredConflicts, id])],
        })),
      markNotification: (id) =>
        setData((current) => ({
          ...current,
          readNotifications: [...new Set([...current.readNotifications, id])],
        })),
      deleteNotification: (id) =>
        setData((current) => ({
          ...current,
          deletedNotifications: [
            ...new Set([...current.deletedNotifications, id]),
          ],
        })),
      logout: () =>
        setData((current) => ({ ...current, profile: null, onboarded: false })),
    }),
    [data, loading, loadError, saveError, saveItem],
  );
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useApp(): Store {
  const value = useContext(Context);
  if (!value) throw new Error("AppProvider is required");
  return value;
}
