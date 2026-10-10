import React, { createContext, useContext } from "react";
import { useColorScheme } from "react-native";
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
  line: "#E3D8C7",
  soft: "#EDE1CF",
  dark: false,
};
const dark = {
  ...palette,
  background: "#141B2C",
  surface: "#202A40",
  text: "#F5EBD8",
  muted: "#C9B59D",
  line: "#3C455A",
  soft: "#30394E",
  dark: true,
};
export type Theme = typeof light;
const ThemeContext = createContext<Theme>(light);
export function ThemeProvider({
  appearance,
  children,
}: {
  appearance: Preferences["appearance"];
  children: React.ReactNode;
}) {
  const system = useColorScheme();
  const isDark =
    appearance === "Dark" || (appearance === "System" && system === "dark");
  return (
    <ThemeContext.Provider value={isDark ? dark : light}>
      {children}
    </ThemeContext.Provider>
  );
}
export const useTheme = () => useContext(ThemeContext);
