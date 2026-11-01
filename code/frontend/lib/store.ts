"use client";

import { MOCK_MODE, fetchDebug, fetchOccupancy, fetchParkings } from "./api";
import { analyze, overallChance, type RegionStat } from "./geometry";
import type { Sample } from "./recommend";
import type { Clock, ParkingLotConfig, ParkingOccupancy } from "./types";

const STORAGE_KEY = "fmbs.live.v3";
const LEGACY_KEYS = ["fmbs.configs", "fmbs.heatmaps", "fmbs.parking", "fmbs.live.v2"];
const POLL_MS = 5000;
const MAX_BACKOFF_MS = 30_000;
const CONFIG_REFRESH_MS = 5 * 60_000;
const PERSIST_MS = 30_000;
const HISTORY_MS = 10 * 60_000;

export interface LiveEntry {
  occupancy: ParkingOccupancy;
  stats: RegionStat[];
  overall: number | null;
  fetchedAt: number;
  history: Sample[];
}

export interface LiveSnapshot {
  parkings: ParkingLotConfig[] | null;
  entries: Record<string, LiveEntry>;
  /** A refresh has finished at least once since the app started. */
  settled: boolean;
  failing: boolean;
  simulatedClock: Clock | null;
}

const EMPTY: LiveSnapshot = { parkings: null, entries: {}, settled: false, failing: false, simulatedClock: null };

let snapshot = EMPTY;
const listeners = new Set<() => void>();
let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<void> | null = null;
let failures = 0;
let configsAt = 0;
let persistedAt = 0;
/** Bumped when the cache is cleared, so a request started before it can't bring the old data back. */
let generation = 0;

function emit(next: Partial<LiveSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
}

function buildEntry(config: ParkingLotConfig, occupancy: ParkingOccupancy, fetchedAt: number, history: Sample[]): LiveEntry {
  const stats = analyze(config, occupancy);
  return { occupancy, stats, overall: overallChance(stats), fetchedAt, history };
}

function hydrate() {
  try {
    LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as {
      parkings: ParkingLotConfig[];
      live: Record<string, { occupancy: ParkingOccupancy; fetchedAt: number; history: Sample[] }>;
      simulatedClock?: Clock | null;
    };
    const entries: Record<string, LiveEntry> = {};
    for (const config of saved.parkings) {
      const l = saved.live[config.id];
      if (l) entries[config.id] = buildEntry(config, l.occupancy, l.fetchedAt, l.history ?? []);
    }
    snapshot = { ...snapshot, parkings: saved.parkings, entries, simulatedClock: saved.simulatedClock ?? null };
  } catch {
    // corrupted or unavailable storage: start empty
  }
}

function persist() {
  try {
    const live = Object.fromEntries(
      Object.entries(snapshot.entries).map(([id, e]) => [
        id,
        { occupancy: e.occupancy, fetchedAt: e.fetchedAt, history: e.history },
      ]),
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ parkings: snapshot.parkings, live, simulatedClock: snapshot.simulatedClock }));
    persistedAt = Date.now();
  } catch {
    // quota exceeded or storage disabled
  }
}

export function clearLiveCache() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage disabled
  }
  snapshot = { ...EMPTY, simulatedClock: snapshot.simulatedClock };
  configsAt = 0;
  generation++;
  inflight = null;
  listeners.forEach((l) => l());
  void refresh();
}

const isGone = (error: unknown) => error instanceof Error && error.message.endsWith("HTTP 404");

async function load() {
  const started = generation;
  let failed = false;

  let parkings = snapshot.parkings;
  if (!parkings || Date.now() - configsAt > CONFIG_REFRESH_MS) {
    try {
      parkings = await fetchParkings();
      configsAt = Date.now();
    } catch {
      failed = true;
    }
  }

  const entries = { ...snapshot.entries };
  if (parkings) {
    await Promise.allSettled(
      parkings.map(async (config) => {
        try {
          const occupancy = await fetchOccupancy(config.id);
          const fetchedAt = Date.now();
          const previous = entries[config.id]?.history ?? [];
          const entry = buildEntry(config, occupancy, fetchedAt, []);
          const sample: Sample = {
            t: fetchedAt,
            overall: entry.overall,
            zones: Object.fromEntries(entry.stats.flatMap((s) => (s.chance === null ? [] : [[s.key, s.chance]]))),
          };
          entry.history = [...previous.filter((s) => fetchedAt - s.t < HISTORY_MS), sample];
          entries[config.id] = entry;
        } catch (error) {
          if (isGone(error)) {
            // Deleted since the configs were fetched: not a connectivity problem, just a list to refresh.
            delete entries[config.id];
            configsAt = 0;
          } else failed = true;
        }
      }),
    );
    for (const id of Object.keys(entries)) {
      if (!parkings.some((config) => config.id === id)) delete entries[id];
    }
  }

  let simulatedClock = snapshot.simulatedClock;
  if (MOCK_MODE) {
    try {
      simulatedClock = (await fetchDebug()).clock;
    } catch {
      // keep the previous value; the occupancy calls already report connectivity
    }
  }

  if (started !== generation) return;
  failures = failed ? failures + 1 : 0;
  emit({ parkings, entries, settled: true, failing: failed, simulatedClock });
  if (Date.now() - persistedAt > PERSIST_MS) persist();
}

function schedule() {
  clearTimeout(timer);
  if (document.visibilityState === "hidden") return;
  const delay = failures > 0 ? Math.min(POLL_MS * 2 ** failures, MAX_BACKOFF_MS) : POLL_MS;
  timer = setTimeout(() => void refresh(), delay);
}

export function refresh(): Promise<void> {
  if (!inflight) {
    const run: Promise<void> = load().finally(() => {
      if (inflight !== run) return;
      inflight = null;
      schedule();
    });
    inflight = run;
  }
  return inflight;
}

/** Parkings changed on the server: refetch them, after any request that started before the change. */
export function reloadConfigs() {
  configsAt = 0;
  if (!started) return;
  void (inflight ?? Promise.resolve()).then(() => {
    configsAt = 0;
    return refresh();
  });
}

function start() {
  if (started) return;
  started = true;
  hydrate();
  void refresh();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
    else {
      clearTimeout(timer);
      persist();
    }
  });
  window.addEventListener("online", () => {
    failures = 0;
    void refresh();
  });
  window.addEventListener("pagehide", persist);
}

export function subscribeLive(listener: () => void) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getLiveSnapshot = () => snapshot;
export const getServerLiveSnapshot = () => EMPTY;
