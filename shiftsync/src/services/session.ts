// The signed-in session lives in the device keystore (expo-secure-store),
// split across keys so each value stays under SecureStore's size limit.
import * as SecureStore from "expo-secure-store";
import type { Session } from "../domain/contract";

const KEYS = {
  access: "shiftsync.access",
  refresh: "shiftsync.refresh",
  meta: "shiftsync.session",
} as const;
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export async function loadSession(): Promise<Session | null> {
  try {
    const [accessToken, refreshToken, meta] = await Promise.all([
      SecureStore.getItemAsync(KEYS.access, options),
      SecureStore.getItemAsync(KEYS.refresh, options),
      SecureStore.getItemAsync(KEYS.meta, options),
    ]);
    if (!accessToken || !refreshToken || !meta) return null;
    const { expiresAt, user } = JSON.parse(meta) as Pick<
      Session,
      "expiresAt" | "user"
    >;
    if (!user?.id || typeof expiresAt !== "number") return null;
    return { accessToken, refreshToken, expiresAt, user };
  } catch {
    return null;
  }
}
export async function saveSession(session: Session): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.access, session.accessToken, options),
    SecureStore.setItemAsync(KEYS.refresh, session.refreshToken, options),
    SecureStore.setItemAsync(
      KEYS.meta,
      JSON.stringify({ expiresAt: session.expiresAt, user: session.user }),
      options,
    ),
  ]);
}
export async function clearSession(): Promise<void> {
  await Promise.all(
    Object.values(KEYS).map((key) =>
      SecureStore.deleteItemAsync(key, options).catch(() => undefined),
    ),
  );
}
