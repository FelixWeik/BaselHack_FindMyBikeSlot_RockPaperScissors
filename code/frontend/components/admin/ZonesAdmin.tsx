"use client";

import { useState } from "react";
import { DownloadIcon, PlusIcon, TrashIcon } from "@/components/ui/Icons";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { Sheet } from "@/components/ui/Sheet";
import { boxOf, polygonPath, regionKey } from "@/lib/geometry";
import { useStoredJSON, writeStored } from "@/lib/storage";
import type { ParkingLotConfig, Point } from "@/lib/types";
import { PolygonEditor } from "./PolygonEditor";

interface DraftZone {
  id: string;
  parkingId: string;
  name: string;
  sensors: string[];
  boundary: Point[];
}

const KEY = "fmbs.admin.zones";
const fieldClass = "min-h-11 w-full rounded-xl border border-border bg-bg px-3 text-text";

function AddZoneForm({
  parkings,
  initialParking,
  onSave,
}: {
  parkings: ParkingLotConfig[];
  initialParking: string;
  onSave: (draft: DraftZone) => void;
}) {
  const [parkingId, setParkingId] = useState(initialParking);
  const [name, setName] = useState("");
  const [sensors, setSensors] = useState(["Sensor 1"]);
  const [points, setPoints] = useState<Point[]>([]);
  const parking = parkings.find((p) => p.id === parkingId) ?? parkings[0];
  const valid = name.trim() !== "" && points.length >= 3 && sensors.some((s) => s.trim() !== "");

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSave({
          id: crypto.randomUUID(),
          parkingId,
          name: name.trim(),
          sensors: sensors.map((s) => s.trim()).filter(Boolean),
          boundary: points,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">
          Parking
          <select
            value={parkingId}
            onChange={(e) => {
              setParkingId(e.target.value);
              setPoints([]);
            }}
            className={fieldClass}
          >
            {parkings.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Zone name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Zone G" required className={fieldClass} />
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Boundary</legend>
        <PolygonEditor parking={parking} points={points} onChange={setPoints} />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Sensors</legend>
        {sensors.map((sensor, i) => (
          <div key={i} className="flex gap-2">
            <input
              aria-label={`Sensor ${i + 1} name`}
              value={sensor}
              onChange={(e) => setSensors(sensors.map((s, j) => (j === i ? e.target.value : s)))}
              className={fieldClass}
            />
            {sensors.length > 1 && (
              <button
                type="button"
                aria-label={`Remove sensor ${i + 1}`}
                onClick={() => setSensors(sensors.filter((_, j) => j !== i))}
                className="tap grid size-11 shrink-0 place-items-center rounded-full bg-surface-2"
              >
                <TrashIcon size={18} />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setSensors([...sensors, `Sensor ${sensors.length + 1}`])}
          className="tap min-h-11 self-start rounded-full bg-surface-2 px-4 text-sm font-semibold"
        >
          Add sensor
        </button>
      </fieldset>

      <button disabled={!valid} className="tap min-h-12 rounded-full bg-primary font-semibold text-primary-fg disabled:opacity-40">
        Save draft
      </button>
    </form>
  );
}

function exportDrafts(drafts: DraftZone[]) {
  const payload = drafts.map((d) => ({
    parkingId: d.parkingId,
    region: { id: d.name, boundary: d.boundary },
    sensors: d.sensors,
  }));
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "bike-spot-zones.json";
  link.click();
  URL.revokeObjectURL(url);
}

function ZoneShape({ boundary }: { boundary: Point[] }) {
  const b = boxOf(boundary);
  return (
    <svg aria-hidden="true" viewBox={`${b.minX} ${b.minY} ${b.maxX - b.minX} ${b.maxY - b.minY}`} className="size-9 shrink-0 overflow-visible p-0.5">
      <path d={polygonPath(boundary)} fill="var(--surface-2)" stroke="var(--text)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function ZonesAdmin({ parkings }: { parkings: ParkingLotConfig[] }) {
  const drafts = useStoredJSON<DraftZone[]>(KEY) ?? [];
  const [addingTo, setAddingTo] = useState<string | null>(null);

  return (
    <section aria-labelledby="zones-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle id="zones-title">Zones &amp; sensors</SectionTitle>
        <div className="flex gap-2">
          {drafts.length > 0 && (
            <button onClick={() => exportDrafts(drafts)} className="tap flex min-h-11 items-center gap-1.5 rounded-full bg-surface px-4 text-sm font-semibold shadow-card">
              <DownloadIcon size={18} />
              Export
            </button>
          )}
          <button
            onClick={() => setAddingTo(parkings[0]?.id ?? null)}
            className="tap flex min-h-11 items-center gap-1.5 rounded-full bg-primary pl-3 pr-4 text-sm font-semibold text-primary-fg"
          >
            <PlusIcon size={18} />
            Add zone
          </button>
        </div>
      </div>

      {parkings.map((parking) => {
        const own = drafts.filter((d) => d.parkingId === parking.id);
        return (
          <Card key={parking.id} className="p-5">
            <h3 className="font-display text-lg font-semibold">{parking.name}</h3>
            <p className="text-sm text-muted">{parking.totalSlots} spots</p>
            <ul className="mt-2 divide-y divide-border">
              {parking.geometry.regions.map((r, i) => (
                <li key={regionKey(r, i)} className="flex items-center gap-3 py-2.5">
                  <ZoneShape boundary={r.boundary} />
                  <span className="font-medium">Zone {regionKey(r, i)}</span>
                </li>
              ))}
              {own.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2.5">
                  <ZoneShape boundary={d.boundary} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {d.name}
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">Draft, not synced</span>
                    </span>
                    <span className="block text-sm text-muted">{d.sensors.join(", ")}</span>
                  </span>
                  <button
                    aria-label={`Delete ${d.name}`}
                    onClick={() => writeStored(KEY, JSON.stringify(drafts.filter((x) => x.id !== d.id)))}
                    className="tap grid size-11 shrink-0 place-items-center rounded-full text-muted"
                  >
                    <TrashIcon size={18} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}

      <p className="px-2 text-sm text-muted">
        The backend has no endpoint for saving zones yet: drafts stay on this device until you export them.
      </p>

      <Sheet open={addingTo !== null} title="Add zone" onClose={() => setAddingTo(null)}>
        {addingTo && (
          <AddZoneForm
            parkings={parkings}
            initialParking={addingTo}
            onSave={(draft) => {
              writeStored(KEY, JSON.stringify([...drafts, draft]));
              setAddingTo(null);
            }}
          />
        )}
      </Sheet>
    </section>
  );
}
