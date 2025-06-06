"use client";

import { useTheme as useNextTheme } from "next-themes";

export function useTheme() {
  const { theme, setTheme, resolvedTheme } = useNextTheme();
  return {
    theme: theme, // "light", "dark", or "system"
    setTheme,
    resolvedTheme, // "light" or "dark" (system theme resolved)
  };
}