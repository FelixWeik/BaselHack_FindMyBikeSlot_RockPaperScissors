"use client";

import Link from "next/link";
import { PencilIcon, PlusIcon, TrashIcon } from "@/components/ui/Icons";
import { Card, SectionTitle } from "@/components/ui/primitives";
import type { AdminParking } from "@/lib/adminModel";
import type { Device } from "@/lib/types";
import { NumberField } from "./NumberField";
import { ScheduleEditor } from "./ScheduleEditor";

const iconButton = "tap grid size-10 shrink-0 place-items-center rounded-full bg-surface";

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

interface Props {
  parking: AdminParking;
  devices: Device[];
  selectedRegionId: string | null;
  onSelectRegion: (id: string) => void;
  onUpdateParking: (mutate: (parking: AdminParking) => AdminParking) => void;
  onAddZone: () => void;
  onDeleteRegion: (id: string) => void;
  onUnlinkCamera: (id: string) => void;
  onDeleteParking: () => void;
  onOpenZoneInfo: (id: string) => void;
}

export function ZoneInspector({ parking, devices, selectedRegionId, onSelectRegion, onUpdateParking, onAddZone, onDeleteRegion, onUnlinkCamera, onDeleteParking, onOpenZoneInfo }: Props) {
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-4 lg:overflow-y-auto lg:overflow-x-hidden lg:pr-1">
      <Card className="grid gap-4 p-4">
        <SectionTitle>Zone</SectionTitle>
        <label className="grid gap-2 text-sm">
          <span className="text-muted">Name</span>
          <input className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" value={parking.name} onChange={(e) => onUpdateParking((next) => ({ ...next, name: e.target.value }))} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Slot width (m)" min={0} step={0.1} value={parking.slotSize.widthMeters} onCommit={(widthMeters) => onUpdateParking((next) => ({ ...next, slotSize: { ...next.slotSize, widthMeters } }))} />
          <NumberField label="Slot length (m)" min={0} step={0.1} value={parking.slotSize.lengthMeters} onCommit={(lengthMeters) => onUpdateParking((next) => ({ ...next, slotSize: { ...next.slotSize, lengthMeters } }))} />
        </div>
        <p className="text-sm text-muted">
          Total capacity: <strong className="tabular-nums text-text">{parking.totalSlots}</strong> slots
        </p>
      </Card>

      <Card className="grid gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle>Sub-zones</SectionTitle>
          <button type="button" onClick={onAddZone} className="tap inline-flex min-h-11 items-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-semibold">
            <PlusIcon size={18} />
            Add
          </button>
        </div>
        <div className="grid gap-2">
          {parking.geometry.regions.map((region) => {
            const active = region.id === selectedRegionId;
            const label = region.name ?? region.id;
            return (
              <div key={region.id} className={`flex items-center gap-2 rounded-2xl p-2 ${active ? "bg-primary/15 ring-2 ring-primary" : "bg-surface-2"}`}>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelectRegion(region.id)}>
                  <div className="truncate font-medium">{label}</div>
                  <div className="text-xs text-muted">{region.slotCount} slots</div>
                </button>
                <button type="button" aria-label={`Edit ${label}`} onClick={() => onOpenZoneInfo(region.id)} className={iconButton}>
                  <PencilIcon size={18} />
                </button>
                <button type="button" aria-label={`Delete ${label}`} onClick={() => onDeleteRegion(region.id)} className={`${iconButton} text-muted`}>
                  <TrashIcon size={18} />
                </button>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="grid gap-3 p-4">
        <SectionTitle>Cameras</SectionTitle>
        {parking.cameras.length === 0 && <p className="text-sm text-muted">No camera watches this zone yet.</p>}
        <div className="grid gap-2">
          {parking.cameras.map((camera) => {
            const online = devices.find((device) => device.id === camera.id)?.online ?? false;
            return (
            <div key={camera.id} className="flex min-w-0 items-center gap-2 rounded-2xl bg-surface-2 p-2">
              <div className="min-w-0 flex-1 pl-1">
                <div className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: online ? "var(--chance-good)" : "var(--chance-unknown)" }} />
                  <span className="truncate font-medium">{camera.name}</span>
                </div>
                <div className="text-xs text-muted">
                  {online ? "Online" : "Offline"} · {camera.calibratedAt ? `Calibrated ${formatDate(camera.calibratedAt)}` : "Not calibrated"}
                </div>
              </div>
              <Link href={`/admin/setup?camera=${encodeURIComponent(camera.id)}&step=2`} className="tap inline-flex min-h-10 shrink-0 items-center rounded-full bg-surface px-3 text-sm font-semibold">
                {camera.calibratedAt ? "Recalibrate" : "Calibrate"}
              </Link>
              <button type="button" aria-label={`Unlink ${camera.name}`} onClick={() => onUnlinkCamera(camera.id)} className={`${iconButton} text-muted`}>
                <TrashIcon size={18} />
              </button>
            </div>
            );
          })}
        </div>
      </Card>

      <ScheduleEditor schedule={parking.schedule} onChange={(schedule) => onUpdateParking((next) => ({ ...next, schedule }))} />

      <button type="button" onClick={onDeleteParking} className="tap inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-semibold text-[var(--chance-bad)]">
        <TrashIcon size={18} />
        Delete this zone
      </button>
    </div>
  );
}
