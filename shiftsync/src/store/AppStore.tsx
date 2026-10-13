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
import { AppState } from "react-native";
import { createEmptyData, createInitialData } from "../domain/seed";
import { rescheduleOccurrence, validateItem } from "../domain/schedule";
import { isValidContact, restoreData } from "../domain/persistence";
import { newItem } from "../domain/seed";
import type {
  AuthUser,
  CalendarSyncResponse,
  Session,
} from "../domain/contract";
import { shiftChanges, shiftNotice } from "../domain/notify";
import type {
  AppData,
  AvailabilityDay,
  ConflictStatus,
  Contact,
  Preferences,
  Profile,
  ScheduleItem,
  Slot,
} from "../domain/types";
import { accountsEnabled } from "../services/config";
import {
  ApiError,
  api,
  isNetworkError,
  onSessionChange,
  setApiSession,
} from "../services/api";
import { clearSession, loadSession, saveSession } from "../services/session";
import { signInWithGoogle as googleSignIn } from "../services/googleSignIn";
import {
  announceSyncProblem,
  clearSyncProblem,
  presentNow,
} from "../services/notifications";
import { diffOps, enqueue, flushQueue, mergeServer, type Op } from "./sync";

const STORAGE_KEY = "@shiftsync/local/v1";
const accountKey = (id: string) => `@shiftsync/account/${id}/v1`;
const outboxKey = (id: string) => `@shiftsync/outbox/${id}/v1`;
/** Where the CalenBud conversation is kept; a null id is the on-device demo. */
export const chatKey = (id: string | null) =>
  `@shiftsync/chat/${id ?? "local"}/v1`;
const deviceTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Manila";

export type SyncStatus = {
  state: "idle" | "syncing" | "offline" | "error";
  message: string | null;
  pending: number;
};
/** How a Google Calendar sync ended; failures are thrown as ApiError. */
export type CalendarSyncOutcome =
  | { status: "synced"; result: CalendarSyncResponse }
  /** The on-device demo has no account to connect Google to. */
  | { status: "no_account" }
  | { status: "not_configured" }
  | { status: "not_connected" }
  /** Connected once, but Google access expired or was revoked. */
  | { status: "reconnect" };
type Store = {
  data: AppData;
  loading: boolean;
  loadError: boolean;
  saveError: boolean;
  retryLoad: () => void;
  retrySave: () => void;
  /** The signed-in ShiftSync account; null in the on-device demo. */
  account: AuthUser | null;
  sync: SyncStatus;
  dismissSyncMessage: () => void;
  /** Sends queued changes; resolves true when nothing is left to send. */
  flush: () => Promise<boolean>;
  refresh: () => Promise<void>;
  /** Imports Google Calendar now; repeated calls share the sync in progress. */
  syncGoogleCalendar: () => Promise<CalendarSyncOutcome>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    name: string,
    email: string,
    password: string,
  ) => Promise<"signed_in" | "confirm_email">;
  /** Signs in with Google (also connecting Calendar and Gmail); false if cancelled. */
  signInWithGoogle: () => Promise<boolean>;
  /** Applies records the server already saved, without sending them back. */
  applyServerItems: (items: ScheduleItem[]) => void;
  saveItem: (item: ScheduleItem) => string | null;
  replaceItems: (items: ScheduleItem[]) => void;
  moveOccurrence: (id: string, occurrenceDate: string, slot: Slot) => void;
  deleteItem: (id: string) => void;
  saveContact: (contact: Contact) => string | null;
  deleteContact: (id: string) => void;
  setProfile: (profile: Profile | null) => void;
  finishOnboarding: () => void;
  setAvailability: (days: AvailabilityDay[]) => void;
  setPreferences: (preferences: Partial<Preferences>) => void;
  ignoreConflict: (id: string) => void;
  setConflictStatus: (id: string, status: ConflictStatus) => void;
  markNotification: (id: string) => void;
  deleteNotification: (id: string) => void;
  logout: () => Promise<void>;
};
const Context = createContext<Store | null>(null);

function accountSeed(user: AuthUser): AppData {
  const data = createEmptyData();
  data.profile = {
    name: user.displayName || user.email.split("@")[0],
    email: user.email,
    organization: "",
    role: "Student",
  };
  data.preferences.timeZone = deviceTimeZone();
  return data;
}
function restoreOr(raw: string | null, fallback: () => AppData): AppData {
  if (!raw) return fallback();
  try {
    return restoreData(raw);
  } catch {
    return fallback();
  }
}
async function loadQueue(userId: string): Promise<Op[]> {
  try {
    const raw = await AsyncStorage.getItem(outboxKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState(createInitialData);
  const [account, setAccount] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [sync, setSync] = useState<SyncStatus>({
    state: "idle",
    message: null,
    pending: 0,
  });
  const writes = useRef(Promise.resolve());
  const dataRef = useRef(data);
  const sessionRef = useRef<Session | null>(null);
  const queueRef = useRef<Op[]>([]);
  const flushing = useRef<Promise<boolean> | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPull = useRef(0);
  const lastCalendarSync = useRef(0);
  const calendarSync = useRef<Promise<CalendarSyncOutcome> | null>(null);
  const pullRef = useRef<(afterRejection?: boolean) => Promise<void>>(
    async () => {},
  );

  const show = useCallback((next: AppData) => {
    dataRef.current = next;
    setData(next);
  }, []);
  const persistQueue = useCallback(() => {
    const user = sessionRef.current?.user;
    if (!user) return;
    const snapshot = JSON.stringify(queueRef.current);
    writes.current = writes.current
      .then(() => AsyncStorage.setItem(outboxKey(user.id), snapshot))
      .catch(() => setSaveError(true));
    setSync((current) => ({ ...current, pending: queueRef.current.length }));
  }, []);

  /** Ends an account session on this device and returns to the welcome screen. */
  const leaveAccount = useCallback(
    async (removeCache: boolean, message: string | null) => {
      const user = sessionRef.current?.user;
      sessionRef.current = null;
      setApiSession(null);
      await clearSession();
      if (user && removeCache)
        await AsyncStorage.multiRemove([
          accountKey(user.id),
          outboxKey(user.id),
          chatKey(user.id),
        ]).catch(() => undefined);
      queueRef.current = [];
      const local = restoreOr(
        await AsyncStorage.getItem(STORAGE_KEY).catch(() => null),
        createInitialData,
      );
      setAccount(null);
      show({ ...local, profile: null, onboarded: false });
      setSync({ state: message ? "error" : "idle", message, pending: 0 });
    },
    [show],
  );

  const flush = useCallback((): Promise<boolean> => {
    if (!sessionRef.current) return Promise.resolve(true);
    if (flushing.current) return flushing.current;
    flushing.current = (async () => {
      if (queueRef.current.length) setSync((s) => ({ ...s, state: "syncing" }));
      const result = await flushQueue(queueRef, api, {
        data: () => dataRef.current,
        confirmItem: (item) =>
          show({
            ...dataRef.current,
            items: dataRef.current.items.map((value) =>
              value.id === item.id
                ? { ...value, version: item.version }
                : value,
            ),
          }),
        persist: persistQueue,
      });
      if (result.unauthorized) {
        await leaveAccount(false, "Your session expired. Please log in again.");
        return false;
      }
      setSync({
        state: result.offline
          ? "offline"
          : result.rejected.length
            ? "error"
            : "idle",
        message: result.rejected.length
          ? `${result.rejected[0].message} We've loaded the latest version from the server.`
          : result.offline
            ? "You're offline. Changes are saved on this phone and will sync when you're back online."
            : (result.notices[0] ?? null),
        pending: queueRef.current.length,
      });
      if (result.rejected.length) void pullRef.current(true);
      return queueRef.current.length === 0;
    })().finally(() => {
      flushing.current = null;
    });
    return flushing.current;
  }, [leaveAccount, persistQueue, show]);

  const pull = useCallback(
    async (afterRejection = false) => {
      if (!sessionRef.current) return;
      if (!afterRejection && !(await flush())) return;
      try {
        const [events, contacts, settings, conflicts] = await Promise.all([
          api.listEvents(),
          api.listContacts(),
          api.getPreferences(),
          api.listConflicts(),
        ]);
        // Edits made while loading are newer; the next refresh catches up.
        if (queueRef.current.length || !sessionRef.current) return;
        lastPull.current = Date.now();
        const before = dataRef.current.items;
        show(
          mergeServer(dataRef.current, {
            items: events.items,
            contacts: contacts.contacts,
            settings,
            conflicts: conflicts.conflicts,
          }),
        );
        if (!afterRejection) {
          setSync((s) => ({ ...s, state: "idle", message: null }));
          // Shifts changed elsewhere (Google Calendar, another phone). A
          // refused local edit is not news, so rejections stay quiet.
          const changes = shiftChanges(before, events.items);
          if (
            changes.length &&
            dataRef.current.preferences.shiftNotifications
          ) {
            const notice = shiftNotice(changes);
            void presentNow(notice.title, notice.body, notice.target);
          }
        }
      } catch (error) {
        if (error instanceof ApiError && error.code === "UNAUTHORIZED")
          await leaveAccount(
            false,
            "Your session expired. Please log in again.",
          );
        else
          setSync((s) => ({
            ...s,
            state: isNetworkError(error) ? "offline" : "error",
            message: isNetworkError(error)
              ? "You're offline. Showing the schedule saved on this phone."
              : error instanceof Error
                ? error.message
                : "We couldn't refresh your schedule.",
          }));
      }
    },
    [flush, leaveAccount, show],
  );
  pullRef.current = pull;

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => void flush(), 300);
  }, [flush]);

  /** Applies a local change; signed-in changes are queued for the server. */
  const commit = useCallback(
    (change: (current: AppData) => AppData) => {
      const prev = dataRef.current;
      const next = change(prev);
      if (next === prev) return;
      show(next);
      if (!sessionRef.current) return;
      const ops = diffOps(prev, next);
      if (!ops.length) return;
      queueRef.current = enqueue(queueRef.current, ops);
      persistQueue();
      scheduleFlush();
    },
    [persistQueue, scheduleFlush, show],
  );

  // One Google Calendar import at a time: a second request while one is
  // running waits for the same result instead of starting another.
  const runCalendarSync = useCallback((): Promise<CalendarSyncOutcome> => {
    if (!sessionRef.current) return Promise.resolve({ status: "no_account" });
    calendarSync.current ??= (async (): Promise<CalendarSyncOutcome> => {
      const status = await api.googleStatus();
      if (!status.configured) return { status: "not_configured" };
      if (!status.connected || !status.calendar)
        return { status: "not_connected" };
      if (status.needsReconnect) return { status: "reconnect" };
      let result: CalendarSyncResponse;
      try {
        result = await api.syncCalendar();
      } catch (error) {
        if (error instanceof ApiError && error.code === "GOOGLE_NOT_CONNECTED")
          return { status: "reconnect" };
        throw error;
      }
      lastCalendarSync.current = Date.now();
      // The refreshed schedule also re-checks conflicts with the new events.
      if (result.imported || result.updated) await pullRef.current();
      const user = sessionRef.current?.user;
      if (user) void clearSyncProblem(user.id);
      return { status: "synced", result };
    })().finally(() => {
      calendarSync.current = null;
    });
    return calendarSync.current;
  }, []);
  // Brings in Google Calendar changes after sign-in and when the app reopens.
  const syncCalendar = useCallback(async () => {
    const user = sessionRef.current?.user;
    if (!user || Date.now() - lastCalendarSync.current < 15 * 60_000) return;
    lastCalendarSync.current = Date.now();
    try {
      const outcome = await runCalendarSync();
      if (outcome.status === "reconnect")
        void announceSyncProblem(
          user.id,
          "Reconnect Google Calendar",
          "Google stopped allowing ShiftSync to read your calendar. Tap to reconnect your account.",
        );
    } catch (error) {
      // Being offline is temporary and retried on the next open, so only
      // real failures are worth an alert.
      if (
        error instanceof ApiError &&
        !error.transient &&
        error.code !== "UNAUTHORIZED"
      )
        void announceSyncProblem(
          user.id,
          "Calendar Sync Failed",
          "We couldn't synchronize your Google Calendar. Tap to try again.",
        );
    }
  }, [runCalendarSync]);

  const adopt = useCallback(
    async (session: Session) => {
      await saveSession(session);
      setApiSession(session);
      sessionRef.current = session;
      const user = session.user;
      queueRef.current = await loadQueue(user.id);
      const cached = await AsyncStorage.getItem(accountKey(user.id)).catch(
        () => null,
      );
      show(restoreOr(cached, () => accountSeed(user)));
      setAccount(user);
      await pull();
      void syncCalendar();
    },
    [pull, show, syncCalendar],
  );

  useEffect(
    () =>
      onSessionChange((session) => {
        if (session) {
          sessionRef.current = session;
          void saveSession(session);
        } else if (sessionRef.current)
          void leaveAccount(
            false,
            "Your session expired. Please log in again.",
          );
      }),
    [leaveAccount],
  );
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setLoadError(false);
    (async () => {
      const session = accountsEnabled ? await loadSession() : null;
      if (session) {
        setApiSession(session);
        sessionRef.current = session;
        queueRef.current = await loadQueue(session.user.id);
        const cached = await AsyncStorage.getItem(accountKey(session.user.id));
        if (!mounted) return;
        show(restoreOr(cached, () => accountSeed(session.user)));
        setAccount(session.user);
        setSync((s) => ({ ...s, pending: queueRef.current.length }));
        void pull().then(syncCalendar);
        return;
      }
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const restored = raw ? restoreData(raw) : createInitialData();
      restored.preferences.timeZone = deviceTimeZone();
      if (mounted) show(restored);
    })()
      .catch(() => {
        if (mounted) setLoadError(true);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
    // Reload only when the user asks to retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttempt]);
  useEffect(() => {
    if (loading || loadError) return;
    const snapshot = JSON.stringify(data);
    const key = account ? accountKey(account.id) : STORAGE_KEY;
    writes.current = writes.current
      .then(() => AsyncStorage.setItem(key, snapshot))
      .then(() => setSaveError(false))
      .catch(() => setSaveError(true));
  }, [data, account, loading, loadError, saveAttempt]);
  // Coming back to the app sends pending changes and refreshes the schedule.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (
        state === "active" &&
        sessionRef.current &&
        Date.now() - lastPull.current > 30_000
      )
        void pull().then(syncCalendar);
    });
    return () => subscription.remove();
  }, [pull, syncCalendar]);
  // Keep the account in the phone's time zone.
  useEffect(() => {
    if (account && !loading && data.preferences.timeZone !== deviceTimeZone())
      commit((current) => ({
        ...current,
        preferences: { ...current.preferences, timeZone: deviceTimeZone() },
      }));
  }, [account, loading, data.preferences.timeZone, commit]);

  const saveItem = useCallback(
    (item: ScheduleItem) => {
      const error = validateItem(item);
      if (error) return error;
      commit((current) => ({
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
    },
    [commit],
  );
  const store = useMemo<Store>(
    () => ({
      data,
      loading,
      loadError,
      saveError,
      account,
      sync,
      flush,
      refresh: () => pull(),
      syncGoogleCalendar: runCalendarSync,
      dismissSyncMessage: () =>
        setSync((current) => ({ ...current, state: "idle", message: null })),
      saveItem,
      signIn: async (email, password) =>
        adopt(await api.login(email, password)),
      signInWithGoogle: async () => {
        const session = await googleSignIn();
        if (!session) return false;
        await adopt(session);
        return true;
      },
      signUp: async (name, email, password) => {
        const result = await api.signUp(email, password, name);
        if (result.status === "signed_in") await adopt(result.session);
        return result.status;
      },
      applyServerItems: (items) => {
        const byId = new Map(items.map((item) => [item.id, item]));
        const current = dataRef.current;
        show({
          ...current,
          items: [
            ...current.items.map((item) => byId.get(item.id) ?? item),
            ...items.filter(
              (item) => !current.items.some((value) => value.id === item.id),
            ),
          ],
        });
      },
      replaceItems: (items) => commit((current) => ({ ...current, items })),
      moveOccurrence: (id, occurrenceDate, slot) => {
        const newId = newItem().id;
        commit((current) => ({
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
      retrySave: () => {
        setSaveAttempt((value) => value + 1);
        void flush();
      },
      deleteItem: (id) =>
        commit((current) => ({
          ...current,
          items: current.items.filter((value) => value.id !== id),
        })),
      saveContact: (contact) => {
        const clean = {
          ...contact,
          name: contact.name.trim(),
          email: contact.email.trim().toLowerCase(),
        };
        if (!isValidContact(clean))
          return "Add a name and a valid email address.";
        if (
          dataRef.current.contacts.some(
            (value) => value.id !== clean.id && value.email === clean.email,
          )
        )
          return "You already have a contact with this email.";
        commit((current) => ({
          ...current,
          contacts: current.contacts.some((value) => value.id === clean.id)
            ? current.contacts.map((value) =>
                value.id === clean.id ? clean : value,
              )
            : [...current.contacts, clean],
        }));
        return null;
      },
      deleteContact: (id) =>
        commit((current) => ({
          ...current,
          contacts: current.contacts.filter((value) => value.id !== id),
          items: current.items.map((item) =>
            item.contactIds?.includes(id)
              ? {
                  ...item,
                  contactIds: item.contactIds.filter((value) => value !== id),
                }
              : item,
          ),
        })),
      setProfile: (profile) => commit((current) => ({ ...current, profile })),
      finishOnboarding: () =>
        commit((current) => ({ ...current, onboarded: true })),
      setAvailability: (availability) =>
        commit((current) => ({
          ...current,
          availability,
          ignoredConflicts: [],
        })),
      setPreferences: (preferences) =>
        commit((current) => ({
          ...current,
          preferences: { ...current.preferences, ...preferences },
          ignoredConflicts: [],
        })),
      ignoreConflict: (id) =>
        commit((current) => ({
          ...current,
          ignoredConflicts: [...new Set([...current.ignoredConflicts, id])],
        })),
      setConflictStatus: (id, status) =>
        commit((current) => ({
          ...current,
          conflictStatus: { ...current.conflictStatus, [id]: status },
          ignoredConflicts:
            status === "dismissed"
              ? [...new Set([...current.ignoredConflicts, id])]
              : current.ignoredConflicts.filter((value) => value !== id),
        })),
      markNotification: (id) =>
        commit((current) => ({
          ...current,
          readNotifications: [...new Set([...current.readNotifications, id])],
        })),
      deleteNotification: (id) =>
        commit((current) => ({
          ...current,
          deletedNotifications: [
            ...new Set([...current.deletedNotifications, id]),
          ],
        })),
      logout: async () => {
        const session = sessionRef.current;
        if (!session) {
          commit((current) => ({
            ...current,
            profile: null,
            onboarded: false,
          }));
          return;
        }
        void api.logout(session.accessToken);
        await leaveAccount(true, null);
      },
    }),
    [
      data,
      loading,
      loadError,
      saveError,
      account,
      sync,
      flush,
      pull,
      runCalendarSync,
      saveItem,
      adopt,
      commit,
      show,
      leaveAccount,
    ],
  );
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useApp(): Store {
  const value = useContext(Context);
  if (!value) throw new Error("AppProvider is required");
  return value;
}
