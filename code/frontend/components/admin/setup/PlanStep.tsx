"use client";

import { useState } from "react";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { type AdminParking, type AdminRegion } from "@/lib/adminModel";
import { type CalibrationDraft, type DraftSubZone, type DraftTarget } from "@/lib/calibration";
import type { Point } from "@/lib/types";
import { ZoneCanvas } from "../ZoneCanvas";
import { StepNav } from "./StepNav";

const NEW = "__new__";

interface Props {
  draft: CalibrationDraft;
  target: AdminParking;
  parkings: AdminParking[];
  /** A recalibrated camera stays in its zone. */
  locked: boolean;
  issues: string[];
  onTarget: (target: DraftTarget) => void;
  onChange: (subZones: DraftSubZone[]) => void;
  onBack: () => void;
  onNext: () => void;
}

export function PlanStep({ draft, target, parkings, locked, issues, onTarget, onChange, onBack, onNext }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(draft.subZones[0]?.id ?? null);

  const ids = new Set(draft.subZones.map((zone) => zone.id));
  const others = target.geometry.regions.filter((region) => !ids.has(region.id));
  const blocks: AdminRegion[] = draft.subZones.map((zone) => ({ id: zone.id, name: zone.name, slotCount: zone.capacity, boundary: zone.boundary }));
  const preview: AdminParking = { ...target, geometry: { regions: [...others, ...blocks] } };

  const move = (id: string, boundary: Point[]) => onChange(draft.subZones.map((zone) => (zone.id === id ? { ...zone, boundary } : zone)));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
      <div className="h-[65dvh] min-w-0">
        <ZoneCanvas
          key={draft.target.kind === "existing" ? draft.target.parkingId : NEW}
          parking={preview}
          selectedRegionId={selectedId}
          onSelectRegion={setSelectedId}
          onMoveRegion={move}
          readOnlyRegionIds={new Set(others.map((region) => region.id))}
        />
      </div>

      <div className="grid min-w-0 gap-4">
        <Card className="grid gap-3 p-4">
          <SectionTitle>Zone</SectionTitle>
          {locked ? (
            <p>{target.name}</p>
          ) : (
            <label className="grid gap-2 text-sm">
              <span className="text-muted">Add these sub-zones to</span>
              <select
                className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3"
                value={draft.target.kind === "existing" ? draft.target.parkingId : NEW}
                onChange={(e) => onTarget(e.target.value === NEW ? { kind: "new", name: "" } : { kind: "existing", parkingId: e.target.value })}
              >
                {parkings.map((parking) => (
                  <option key={parking.id} value={parking.id}>
                    {parking.name}
                  </option>
                ))}
                <option value={NEW}>A new zone</option>
              </select>
            </label>
          )}
          {draft.target.kind === "new" && (
            <label className="grid gap-2 text-sm">
              <span className="text-muted">Name of the new zone</span>
              <input className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" placeholder="Parking 1" value={draft.target.name} onChange={(e) => onTarget({ kind: "new", name: e.target.value })} />
            </label>
          )}
        </Card>

        <Card className="grid gap-2 p-4">
          <SectionTitle>Place the sub-zones</SectionTitle>
          <p className="text-sm text-muted">Each block starts at real size from its capacity. Move it to where it sits, seen from above, and drag its corners to fit. The other sub-zones of the zone are shown for reference.</p>
          <ul className="grid gap-1">
            {draft.subZones.map((zone) => (
              <li key={zone.id}>
                <button type="button" onClick={() => setSelectedId(zone.id)} className={`tap flex min-h-11 w-full items-center justify-between gap-2 rounded-2xl px-3 text-left ${zone.id === selectedId ? "bg-primary/15 ring-2 ring-primary" : "bg-surface-2"}`}>
                  <span className="min-w-0 truncate font-medium">{zone.name}</span>
                  <span className="shrink-0 text-sm tabular-nums text-muted">{zone.capacity} slots</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <StepNav issues={issues} onBack={onBack} onNext={onNext} />
      </div>
    </div>
  );
}
