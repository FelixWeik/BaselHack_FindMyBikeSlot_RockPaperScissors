"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { AdminParking } from "./adminModel";
import { deleteParking, fetchDevices, fetchParkings, saveParking } from "./api";
import { reloadConfigs } from "./store";
import type { Device } from "./types";

const SAVE_DELAY_MS = 400;

export interface AdminState {
  status: "loading" | "ready" | "error";
  parkings: AdminParking[];
  devices: Device[];
  save: "saved" | "saving" | "failed";
  /** Why the last save failed, in the backend's words. */
  saveError: string | null;
}

const INITIAL: AdminState = { status: "loading", parkings: [], devices: [], save: "saved", saveError: null };

let state = INITIAL;
const listeners = new Set<() => void>();
/** Latest unsaved version of each parking; null means delete it. */
const pending = new Map<string, AdminParking | null>();
let timer: ReturnType<typeof setTimeout> | undefined;
let flushing: Promise<boolean> | null = null;

function emit(next: Partial<AdminState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadAdmin() {
  try {
    const [parkings, devices] = await Promise.all([fetchParkings(), fetchDevices()]);
    // Unsaved edits win over what the server had before them.
    if (pending.size > 0 || flushing) emit({ status: "ready", devices });
    else emit({ status: "ready", parkings, devices });
  } catch {
    if (state.status !== "ready") emit({ status: "error" });
  }
}

/** Saves one change at a time, in order, so an older save can't land after a newer one. */
async function drain(): Promise<boolean> {
  emit({ save: "saving", saveError: null });
  try {
    while (pending.size > 0) {
      const [id, parking] = pending.entries().next().value as [string, AdminParking | null];
      await (parking ? saveParking(parking) : deleteParking(id));
      // An edit made during the request replaced the entry: keep it for the next round.
      if (pending.get(id) === parking) pending.delete(id);
    }
    emit({ save: "saved" });
    reloadConfigs();
    return true;
  } catch (error) {
    emit({ save: "failed", saveError: error instanceof Error ? error.message : null });
    return false;
  }
}

/** Sends the unsaved changes now; resolves to whether everything reached the server. */
export function flushAdmin(): Promise<boolean> {
  clearTimeout(timer);
  flushing ??= drain().finally(() => {
    flushing = null;
  });
  return flushing;
}

function queue(id: string, parking: AdminParking | null) {
  pending.set(id, parking);
  emit({ save: "saving" });
  clearTimeout(timer);
  timer = setTimeout(() => void flushAdmin(), SAVE_DELAY_MS);
}

export function updateParking(id: string, mutate: (parking: AdminParking) => AdminParking) {
  const current = state.parkings.find((parking) => parking.id === id);
  if (!current) return;
  const next = mutate(current);
  emit({ parkings: state.parkings.map((parking) => (parking.id === id ? next : parking)) });
  queue(id, next);
}

/** Adds the parking or replaces the one with the same id. */
export function putParking(parking: AdminParking) {
  const known = state.parkings.some((p) => p.id === parking.id);
  emit({ parkings: known ? state.parkings.map((p) => (p.id === parking.id ? parking : p)) : [...state.parkings, parking] });
  queue(parking.id, parking);
}

export function removeParking(id: string) {
  emit({ parkings: state.parkings.filter((parking) => parking.id !== id) });
  queue(id, null);
}

const DEVICES_POLL_MS = 10_000;

async function refreshDevices() {
  try {
    emit({ devices: await fetchDevices() });
  } catch {
    // keep the last list; the next round retries
  }
}

export function useAdmin(): AdminState {
  useEffect(() => {
    void loadAdmin();
    const timer = setInterval(() => void refreshDevices(), DEVICES_POLL_MS);
    return () => clearInterval(timer);
  }, []);
  return useSyncExternalStore(subscribe, () => state, () => INITIAL);
}

export function downloadDocument(parkings: AdminParking[]) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, parkings }, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "parkings.json";
  link.click();
  URL.revokeObjectURL(url);
}
