"use client";

import { useState } from "react";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { type AdminParking, type AdminRegion } from "@/lib/adminModel";
import { type CalibrationDraft, type DraftSubZone } from "@/lib/calibration";
import type { Point } from "@/lib/types";
import { ZoneCanvas } from "../ZoneCanvas";
import { StepNav } from "./StepNav";

const NEW = "__new__";

interface Props {
  draft: CalibrationDraft;
  target: AdminParking;
  issues: string[];
  onChange: (subZones: DraftSubZone[]) => void;
  onBack: () => void;
  onNext: () => void;
}

export function PlanStep({ draft, target, issues, onChange, onBack, onNext }: Props) {
  const placeable = draft.subZones.filter((zone) => !zone.existing);
  const [selectedId, setSelectedId] = useState<string | null>(placeable[0]?.id ?? null);

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
          readOnlyRegionIds={new Set([...others.map((region) => region.id), ...draft.subZones.filter((zone) => zone.existing).map((zone) => zone.id)])}
        />
      </div>

      <div className="grid min-w-0 gap-4">
        <Card className="grid gap-2 p-4">
          <SectionTitle>Place the sub-zones of {target.name || "the new zone"}</SectionTitle>
          <p className="text-sm text-muted">
            {placeable.length > 0
              ? "Each new block starts at real size from its capacity. Move it to where it sits, seen from above, and drag its corners to fit. Sub-zones that already exist stay where they are."
              : "These sub-zones are already on the plan, so there's nothing to place."}
          </p>
          <ul className="grid gap-1">
            {placeable.map((zone) => (
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
