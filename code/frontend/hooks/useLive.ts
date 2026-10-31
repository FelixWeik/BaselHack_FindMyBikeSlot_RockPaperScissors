"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { levelOf, type Level, type RegionStat } from "@/lib/geometry";
import { clockInZone, openState, type OpenState } from "@/lib/schedule";
import { getLiveSnapshot, getServerLiveSnapshot, refresh, subscribeLive } from "@/lib/store";
import { recommend, trendOf, type HeldPick, type Sample, type Trend } from "@/lib/recommend";
import { updateSettings, useSettings } from "@/lib/settings";
import type { Clock, ParkingHeatmap, ParkingLotConfig } from "@/lib/types";
import { useNow } from "./useNow";

export type Connection = "live" | "offline" | "failing";

export interface ParkingItem {
  config: ParkingLotConfig;
  heatmap: ParkingHeatmap | null;
  stats: RegionStat[] | null;
  overall: number;
  level: Level;
  fetchedAt: number | null;
  history: Sample[];
  trend: Trend | null;
  openState: OpenState;
  clock: Clock;
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

export function useBrowserOffline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => !navigator.onLine,
    () => false,
  );
}

export function useLive() {
  const snap = useSyncExternalStore(subscribeLive, getLiveSnapshot, getServerLiveSnapshot);
  const now = useNow(30_000);
  const offline = useBrowserOffline();

  const items = useMemo<ParkingItem[]>(
    () =>
      (snap.parkings ?? []).map((config) => {
        const entry = snap.entries[config.id];
        const clock = snap.simulatedClock ?? clockInZone(config.schedule.timezone, new Date(now));
        return {
          config,
          heatmap: entry?.heatmap ?? null,
          stats: entry?.stats ?? null,
          overall: entry?.overall ?? 0,
          level: levelOf(entry?.overall ?? 0),
          fetchedAt: entry?.fetchedAt ?? null,
          history: entry?.history ?? [],
          trend: entry ? trendOf(entry.history) : null,
          openState: openState(config.schedule, clock),
          clock,
        };
      }),
    [snap, now],
  );

  const connection: Connection = offline ? "offline" : snap.failing ? "failing" : "live";
  const fetchedAt = items.reduce<number | null>(
    (latest, i) => (i.fetchedAt !== null && (latest === null || i.fetchedAt > latest) ? i.fetchedAt : latest),
    null,
  );

  return {
    items,
    connection,
    fetchedAt,
    /** Nothing cached and the first request is still running. */
    loading: !snap.settled && items.every((i) => !i.stats),
    /** Nothing cached and the first request failed. */
    unreachable: snap.settled && snap.failing && items.every((i) => !i.stats),
    simulatedClock: snap.simulatedClock,
    refresh,
  };
}

/** The recommendation, remembering the previous pick so near-ties don't flip it on every poll. */
export function useRecommendation(items: ParkingItem[], favorites: string[] = []) {
  const [held, setHeld] = useState<HeldPick | null>(null);
  const result = recommend(items, favorites, held);
  if (result?.kind === "go" && (held?.parkingId !== result.item.config.id || held.key !== result.stat.key)) {
    setHeld({ parkingId: result.item.config.id, key: result.stat.key });
  }
  return result;
}

/** Selection lives in the URL (`?p=&z=`) so views can be shared, bookmarked and used as app shortcuts. */
export function useSelection(items: ParkingItem[]) {
  const params = useSearchParams();
  const { lastParking, favorites } = useSettings();
  const wanted = params.get("p") ?? lastParking ?? favorites[0];
  const item = items.find((i) => i.config.id === wanted) ?? items[0] ?? null;
  const zoneKey = params.get("z");

  const selectParking = useCallback((id: string) => {
    updateSettings({ lastParking: id });
    const url = new URL(window.location.href);
    url.searchParams.set("p", id);
    url.searchParams.delete("z");
    window.history.replaceState(null, "", url);
  }, []);

  // A pushed entry lets the phone's back gesture zoom back out.
  const selectZone = useCallback(
    (key: string | null) => {
      const url = new URL(window.location.href);
      if (item) url.searchParams.set("p", item.config.id);
      if (key) url.searchParams.set("z", key);
      else url.searchParams.delete("z");
      window.history.pushState(null, "", url);
    },
    [item],
  );

  return { item, zoneKey, selectParking, selectZone };
}
