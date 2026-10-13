// Public configuration only. Expo inlines EXPO_PUBLIC_* values into the app
// bundle, so nothing secret may ever be read here.
const raw = process.env.EXPO_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, "");

/** The ShiftSync API, or null when the app runs as an on-device demo. */
export const API_BASE_URL: string | null =
  raw && /^https?:\/\//.test(raw) ? raw : null;
export const accountsEnabled = API_BASE_URL !== null;
/** localhost only works in an emulator with `adb reverse`, never on a phone. */
export const usesLocalhost =
  !!API_BASE_URL && /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(API_BASE_URL);
