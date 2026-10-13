import React, { createContext, useContext, useEffect } from "react";
import { Appearance, Platform, useColorScheme } from "react-native";
import type { Preferences } from "./domain/types";

export const palette = {
  beige: "#C9B59D",
  navy: "#252E4B",
  ivory: "#F5EBD8",
  teal: "#58A6AE",
  aqua: "#89E3E5",
  gold: "#F2C88E",
  ink: "#080F20",
};
export const fonts = {
  regular: "Poppins_400Regular",
  medium: "Poppins_500Medium",
  semibold: "Poppins_600SemiBold",
  bold: "Poppins_700Bold",
};
const light = {
  ...palette,
  background: palette.ivory,
  surface: "#FFFDF8",
  text: palette.navy,
  muted: "#666153",
  // Out-of-range or disabled content: still readable, clearly secondary.
  faint: "#8C8574",
  line: "#E3D8C7",
  soft: "#EDE1CF",
  // Teal that is dark enough to read as text on light surfaces.
  accentText: "#27666C",
  // Genuine schedule conflicts and destructive actions only.
  danger: "#A8322A",
  dangerSoft: "#FBE9E6",
  dangerLine: "#E7B4AC",
  dangerSolid: "#A8322A",
  onDangerSolid: "#FFFFFF",
  // Notification badge: a saturated red that stays visible on any surface.
  badge: "#E0362C",
  // Softer issues (short gaps, outside availability) that aren't conflicts.
  warning: "#8A5A12",
  warningSoft: "#F8E8CC",
  successSoft: "#DEF1ED",
  dark: false,
};
const dark: Theme = {
  ...palette,
  background: "#141B2C",
  surface: "#202A40",
  text: "#F5EBD8",
  muted: "#C9B59D",
  faint: "#7F8699",
  line: "#3C455A",
  soft: "#30394E",
  accentText: palette.aqua,
  // Muted coral instead of saturated red: distinct on navy without glare.
  danger: "#F2A39A",
  dangerSoft: "#3A2A31",
  dangerLine: "#7A3F44",
  dangerSolid: "#E5837A",
  onDangerSolid: palette.ink,
  badge: "#FF5449",
  warning: "#F2C88E",
  warningSoft: "#3A3428",
  successSoft: "#27454D",
  dark: true,
};
export type Theme = typeof light;
const ThemeContext = createContext<Theme>(light);

// Picks navy or ivory text for any background, so chips stay readable when
// they're tinted with a theme color in either mode.
export function readableOn(background: string) {
  const hex = background.replace("#", "").slice(0, 6);
  if (hex.length !== 6) return palette.navy;
  const [r, g, b] = [0, 2, 4].map((n) => {
    const channel = parseInt(hex.slice(n, n + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.18 ? palette.navy : palette.ivory;
}

export function ThemeProvider({
  appearance,
  children,
}: {
  appearance: Preferences["appearance"];
  children: React.ReactNode;
}) {
  const system = useColorScheme();
  // Native pieces we don't draw ourselves (the Android date and time picker
  // dialogs, keyboards) follow the app's choice instead of the phone's.
  useEffect(() => {
    if (Platform.OS !== "ios" && Platform.OS !== "android") return;
    try {
      Appearance.setColorScheme(
        appearance === "Dark"
          ? "dark"
          : appearance === "Light"
            ? "light"
            : "unspecified",
      );
    } catch {
      // Older OS versions keep following the system setting.
    }
  }, [appearance]);
  const isDark =
    appearance === "Dark" || (appearance === "System" && system === "dark");
  return (
    <ThemeContext.Provider value={isDark ? dark : light}>
      {children}
    </ThemeContext.Provider>
  );
}
export const useTheme = () => useContext(ThemeContext);
