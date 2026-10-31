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

function read(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(readStored(SETTINGS_KEY) ?? "{}") as Partial<Settings>) };
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
  return useMemo(() => ({ ...DEFAULTS, ...stored }), [stored]);
}
