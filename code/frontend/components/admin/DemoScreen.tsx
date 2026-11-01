"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { clearDemoCounts, fetchOccupancy, fetchParkings, setDemoCount } from "@/lib/api";
import { refresh } from "@/lib/store";
import type { ParkingLotConfig, ZoneOccupancy } from "@/lib/types";

const DEFAULT_PARKING = "facility-basement";
const POLL_MS = 2000;
const STEPS = [-5, -1, 1, 5] as const;

const buttonClass = "tap min-h-12 rounded-full bg-surface-2 px-4 font-semibold tabular-nums disabled:opacity-40";

/** Hidden page, reached by typing /admin/demo: moves the bikes of a parking's zones by hand during a demo. */
export function DemoScreen() {
  const [parkings, setParkings] = useState<ParkingLotConfig[] | null>(null);
  const [parkingId, setParkingId] = useState<string | null>(null);
  const [zones, setZones] = useState<Record<string, ZoneOccupancy>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchParkings()
      .then((list) => {
        setParkings(list);
        setParkingId((list.find((p) => p.id === DEFAULT_PARKING) ?? list[0])?.id ?? null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Cannot reach the server"));
  }, []);

  const load = useCallback(async () => {
    if (!parkingId) return;
    try {
      const occupancy = await fetchOccupancy(parkingId);
      setZones(Object.fromEntries(occupancy.zones.map((z) => [z.zoneId, z])));
    } catch {
      // the next poll retries
    }
  }, [parkingId]);

  useEffect(() => {
    if (!parkingId) return;
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [parkingId, load]);

  const act = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      await load();
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The change was refused");
    }
  };

  const parking = parkings?.find((p) => p.id === parkingId) ?? null;

  return (
    <div className="pt-[calc(env(safe-area-inset-top)+0.75rem)] lg:pl-24">
      <div className="mx-auto max-w-2xl px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)]">
        <PageHeader eyebrow="Hidden page, for demos" title="Demo" />
        {parkings && parkings.length > 1 && (
          <label className="mb-4 grid gap-2 text-sm">
            <span className="text-muted">Parking</span>
            <select className="min-h-11 rounded-2xl bg-surface px-3" value={parkingId ?? ""} onChange={(e) => setParkingId(e.target.value)}>
              {parkings.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && (
          <p role="alert" className="mb-4 rounded-2xl bg-surface p-3 text-sm">
            {error}
          </p>
        )}
        {!parking ? (
          <p className="text-muted">{parkings ? "No parking is set up." : "Loading…"}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              The home screen shows a trend (&ldquo;Filling up&rdquo; or &ldquo;Freeing up&rdquo;) about a minute after the counts start moving.
            </p>
            {parking.geometry.regions.map((region) => {
              const zone = zones[region.id];
              const count = zone?.detected == null ? null : Math.round(zone.detected);
              const set = (n: number) => act(() => setDemoCount(parking.id, region.id, Math.min(region.slotCount, Math.max(0, n))));
              return (
                <Card key={region.id} className="flex flex-col gap-3 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <SectionTitle>{region.name ?? `Zone ${region.id}`}</SectionTitle>
                    <p className="font-display text-2xl font-bold tabular-nums" aria-live="polite">
                      {count ?? "–"} <span className="text-base font-medium text-muted">/ {region.slotCount}</span>
                    </p>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {STEPS.map((step) => (
                      <button key={step} onClick={() => void set((count ?? 0) + step)} className={buttonClass} aria-label={`${step > 0 ? "Add" : "Remove"} ${Math.abs(step)} bike${Math.abs(step) > 1 ? "s" : ""} in ${region.name ?? region.id}`}>
                        {step > 0 ? `+${step}` : `−${-step}`}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => void set(0)} className={buttonClass}>
                      Empty
                    </button>
                    <button onClick={() => void set(region.slotCount)} className={buttonClass}>
                      Full
                    </button>
                  </div>
                </Card>
              );
            })}
            <button onClick={() => void act(clearDemoCounts)} className="tap min-h-12 rounded-full bg-surface font-semibold shadow-card">
              Back to the real cameras
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
