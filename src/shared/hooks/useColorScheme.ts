import { useTheme } from "next-themes";
import type { ColorScheme } from "../theme/themeConfig";

export function useColorScheme(): ColorScheme {
  const { forcedTheme, resolvedTheme } = useTheme();
  return (forcedTheme ?? resolvedTheme) === "light" ? "light" : "dark";
}
