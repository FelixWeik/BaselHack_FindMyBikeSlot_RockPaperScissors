"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Segmented, SectionTitle } from "@/components/ui/primitives";
import { useLive } from "@/hooks/useLive";
import { MOCK_MODE } from "@/lib/api";
import { DAYS, formatHour } from "@/lib/forecast";
import { refresh } from "@/lib/store";
import type { Clock, DebugState, ForcedState } from "@/lib/types";

const FORCED: { value: ForcedState; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "full", label: "Full" },
  { value: "empty", label: "Empty" },
  { value: "unknown", label: "No data" },
];

const DEMO_START: Clock = { day: 1, hour: 8 };

function ClockControls({ clock, onChange }: { clock: Clock | null; onChange: (clock: Clock | null) => void }) {
  const value = clock ?? DEMO_START;
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle>Replay a day</SectionTitle>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={clock !== null} onChange={(e) => onChange(e.target.checked ? DEMO_START : null)} />
          Simulate
        </label>
      </div>
      <fieldset disabled={clock === null} className="flex flex-col gap-3 disabled:opacity-50">
        <label className="grid gap-1 text-sm font-medium">
          Day
          <select
            value={value.day}
            onChange={(e) => onChange({ ...value, day: Number(e.target.value) })}
            className="min-h-11 rounded-xl border border-border bg-bg px-3"
          >
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          <span>
            Time: <span className="tabular-nums">{formatHour(value.hour)}</span>
          </span>
          <input
            type="range"
            min={5}
            max={22}
            step={0.25}
            value={value.hour}
            onChange={(e) => onChange({ ...value, hour: Number(e.target.value) })}
            className="h-11 accent-[var(--primary)]"
          />
        </label>
      </fieldset>
    </Card>
  );
}

export function DebugPanel() {
  const { items } = useLive();
  const [state, setState] = useState<DebugState | null>(null);

  useEffect(() => {
    if (!MOCK_MODE) return;
    fetch("/api/debug")
      .then((r) => r.json())
      .then(setState)
      .catch(() => {});
  }, []);

  const patch = useCallback(async (p: Partial<DebugState>) => {
    const res = await fetch("/api/debug", { method: "POST", body: JSON.stringify(p) });
    setState(await res.json());
    void refresh();
  }, []);

  if (!MOCK_MODE) {
    return <p className="text-muted">MOCK_MODE=false: the demo controls have no effect on the real backend.</p>;
  }
  if (!state) return <p className="text-muted">Loading…</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <div className="flex flex-col gap-4">
        <ClockControls clock={state.clock} onChange={(clock) => void patch({ clock })} />

        <Card className="flex flex-col gap-4 p-5">
          <SectionTitle>Network</SectionTitle>
          <label className="grid gap-1 text-sm font-medium">
            <span>
              Latency: <span className="tabular-nums">{state.latencyMs} ms</span>
            </span>
            <input
              type="range"
              min={0}
              max={5000}
              step={250}
              value={state.latencyMs}
              onChange={(e) => void patch({ latencyMs: Number(e.target.value) })}
              className="h-11 accent-[var(--primary)]"
            />
          </label>
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium">
            Cut the network (HTTP 503)
            <input
              type="checkbox"
              className="size-6 accent-[var(--primary)]"
              checked={state.networkCut}
              onChange={(e) => void patch({ networkCut: e.target.checked })}
            />
          </label>
        </Card>

        <button
          onClick={() => void patch({ zones: {}, latencyMs: 0, networkCut: false, clock: null })}
          className="tap min-h-12 rounded-full bg-surface font-semibold shadow-card"
        >
          Reset everything
        </button>
      </div>

      <section aria-label="Force a zone" className="flex flex-col gap-3">
        {items.flatMap(({ config }) =>
          config.geometry.regions.map((region) => {
            const zone = region.id;
            const key = `${config.id}:${zone}`;
            return (
              <Card key={key} className="flex flex-col gap-2 p-4">
                <p className="font-semibold">
                  {config.name} · Zone {zone}
                </p>
                <Segmented<ForcedState>
                  label={`Force ${config.name} zone ${zone}`}
                  value={state.zones[key] ?? "normal"}
                  options={FORCED}
                  onChange={(value) => void patch({ zones: { ...state.zones, [key]: value } })}
                />
              </Card>
            );
          }),
        )}
      </section>
    </div>
  );
}
