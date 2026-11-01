"use client";

import { useMemo } from "react";
import type { Palette } from "./heat";
import { readStored, useStoredJSON, writeStored } from "./storage";
import { SETTINGS_KEY } from "./themeScript";

export type ThemeChoice = "system" | "light" | "dark";

export interface Settings {
  theme: ThemeChoice;
  palette: Palette;
  favorites: string[];
  lastParking: string | null;
  installDismissed: boolean;
}

const DEFAULTS: Settings = {
  theme: "system",
  palette: "standard",
  favorites: [],
  lastParking: null,
  installDismissed: false,
};

const THEME_COLORS = { light: "#f3f1ea", dark: "#0f100c" };

function applyAppearance(s: Settings) {
  const root = document.documentElement;
  if (s.theme === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = s.theme;
  root.dataset.palette = s.palette;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const scheme = meta.media.includes("dark") ? "dark" : "light";
    meta.content = THEME_COLORS[s.theme === "system" ? scheme : s.theme];
  });
}

/** What was stored may be from an older version or hand-edited: keep only the fields that have the right shape. */
function sanitize(stored: Partial<Settings> | null | undefined): Settings {
  const s: Partial<Settings> = typeof stored === "object" && stored !== null ? stored : {};
  return {
    theme: s.theme === "light" || s.theme === "dark" || s.theme === "system" ? s.theme : DEFAULTS.theme,
    palette: s.palette === "safe" || s.palette === "standard" ? s.palette : DEFAULTS.palette,
    favorites: Array.isArray(s.favorites) ? s.favorites.filter((f): f is string => typeof f === "string") : DEFAULTS.favorites,
    lastParking: typeof s.lastParking === "string" ? s.lastParking : DEFAULTS.lastParking,
    installDismissed: s.installDismissed === true,
  };
}

function read(): Settings {
  try {
    return sanitize(JSON.parse(readStored(SETTINGS_KEY) ?? "{}") as Partial<Settings>);
  } catch {
    return DEFAULTS;
  }
}

export function updateSettings(patch: Partial<Settings>) {
  const next = { ...read(), ...patch };
  writeStored(SETTINGS_KEY, JSON.stringify(next));
  applyAppearance(next);
}

export function toggleFavorite(id: string) {
  const { favorites } = read();
  updateSettings({ favorites: favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id] });
}

export function useSettings(): Settings {
  const stored = useStoredJSON<Partial<Settings>>(SETTINGS_KEY);
  return useMemo(() => sanitize(stored), [stored]);
}
