"use client";

import { useMemo, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // quota exceeded or storage disabled
  }
  listeners.forEach((l) => l());
}

/** Reactive localStorage JSON value; null on the server and before hydration. */
export function useStoredJSON<T>(key: string): T | null {
  const raw = useSyncExternalStore(
    subscribe,
    () => readStored(key),
    () => null,
  );
  return useMemo(() => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }, [raw]);
}
