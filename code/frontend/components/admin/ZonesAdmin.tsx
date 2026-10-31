"use client";

import Link from "next/link";
import { useState } from "react";
import { DownloadIcon, PlusIcon } from "@/components/ui/Icons";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { addRegion, moveRegion, newRegion, removeCamera, removeRegion, replaceRegion } from "@/lib/adminModel";
import { type AdminState, downloadDocument, flushAdmin, removeParking, updateParking } from "@/lib/adminStore";
import { ZoneCanvas } from "./ZoneCanvas";
import { ZoneInspector } from "./ZoneInspector";
import { ZoneSheet } from "./ZoneSheet";

function SaveStatus({ save }: { save: AdminState["save"] }) {
  if (save === "failed") {
    return (
      <span role="alert" className="flex items-center gap-2 text-sm font-semibold text-[var(--chance-bad)]">
        Changes not saved
        <button type="button" onClick={() => void flushAdmin()} className="tap min-h-11 rounded-full bg-surface-2 px-4 text-text">
          Try again
        </button>
      </span>
    );
  }
  return (
    <span aria-live="polite" className="text-sm text-muted">
      {save === "saving" ? "Saving…" : "All changes saved"}
    </span>
  );
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const createButton = "tap inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-4 font-semibold text-primary-fg";

export function ZonesAdmin({ admin }: { admin: AdminState }) {
  const { parkings, devices, save } = admin;
  const [parkingId, setParkingId] = useState<string | null>(null);
  const [regionId, setRegionId] = useState<string | null>(null);
  const [zonePopupId, setZonePopupId] = useState<string | null>(null);

  const assigned = new Set(parkings.flatMap((item) => item.cameras.map((camera) => camera.id)));
  const toCalibrate = devices.filter((device) => !assigned.has(device.id));

  // Selections fall back to the first item, so a deleted zone or sub-zone never leaves a dangling id.
  const parking = parkings.find((item) => item.id === parkingId) ?? parkings[0];
  const region = parking?.geometry.regions.find((item) => item.id === regionId) ?? parking?.geometry.regions[0] ?? null;

  const cameraList = (
    <Card className="flex min-w-0 flex-col gap-3 p-4">
      <SectionTitle>Cameras to calibrate</SectionTitle>
      {toCalibrate.length === 0 && <p className="text-sm text-muted">Every camera is calibrated.</p>}
      <div className="grid gap-2">
        {toCalibrate.map((device) => (
          <Link key={device.id} href={`/admin/setup?camera=${encodeURIComponent(device.id)}&step=2`} className="tap flex min-h-11 items-start justify-between gap-2 rounded-2xl bg-surface-2 px-3 py-2">
            <span className="min-w-0 flex-1 break-words whitespace-normal font-medium">{device.name}</span>
            <span className="shrink-0 text-sm font-semibold text-primary">Calibrate</span>
          </Link>
        ))}
      </div>
    </Card>
  );

  if (!parking) {
    return (
      <section className="mx-auto flex w-full max-w-md flex-col gap-4 overflow-y-auto">
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <h2 className="font-display text-xl font-semibold">No zone yet</h2>
          <p className="text-muted">Pick a camera, draw its sub-zones on its view, then place them on a plan.</p>
          <Link href="/admin/setup" className={createButton}>
            <PlusIcon size={18} />
            Create a zone
          </Link>
        </Card>
        {cameraList}
      </section>
    );
  }

  const update = (mutate: Parameters<typeof updateParking>[1]) => updateParking(parking.id, mutate);

  const addZone = () => {
    const next = newRegion(parking);
    update((current) => addRegion(current, next));
    setRegionId(next.id);
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto lg:overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SaveStatus save={save} />
        <button type="button" onClick={() => downloadDocument(parkings)} className="tap inline-flex min-h-11 items-center gap-2 rounded-full bg-surface-2 px-4 font-semibold">
          <DownloadIcon size={18} />
          Export JSON
        </button>
      </div>

      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[18rem_minmax(0,1fr)_21rem]">
        <div className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto">
          <Card className="flex min-w-0 flex-col gap-3 p-4">
            <SectionTitle>Zones</SectionTitle>
            <div className="grid gap-2">
              {parkings.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={item.id === parking.id}
                  onClick={() => setParkingId(item.id)}
                  className={`rounded-2xl px-3 py-3 text-left ${item.id === parking.id ? "bg-primary text-primary-fg" : "bg-surface-2"}`}
                >
                  <div className="break-words whitespace-normal font-medium">{item.name || "Unnamed zone"}</div>
                  <div className="text-xs opacity-70">
                    {count(item.geometry.regions.length, "sub-zone")} · {count(item.cameras.length, "camera")}
                  </div>
                </button>
              ))}
            </div>
            <Link href="/admin/setup" className={createButton}>
              <PlusIcon size={18} />
              Create a zone
            </Link>
          </Card>
          {cameraList}
        </div>

        <div className="h-[60dvh] min-w-0 lg:h-auto lg:min-h-0">
          <ZoneCanvas key={parking.id} parking={parking} selectedRegionId={region?.id ?? null} onSelectRegion={setRegionId} onMoveRegion={(id, boundary) => update((current) => moveRegion(current, id, boundary))} />
        </div>

        <ZoneInspector
          key={`inspector-${parking.id}`}
          parking={parking}
          devices={devices}
          selectedRegionId={region?.id ?? null}
          onSelectRegion={setRegionId}
          onUpdateParking={update}
          onAddZone={addZone}
          onDeleteRegion={(id) => {
            if (window.confirm("Delete this sub-zone? It goes for every camera watching it.")) update((current) => removeRegion(current, id));
          }}
          onUnlinkCamera={(id) => {
            if (window.confirm("Unlink this camera? The sub-zones stay on the plan, and it goes back to the cameras to calibrate.")) update((current) => removeCamera(current, id));
          }}
          onDeleteParking={() => {
            if (window.confirm(`Delete ${parking.name || "this zone"} and its sub-zones? Its cameras go back to the cameras to calibrate.`)) removeParking(parking.id);
          }}
          onOpenZoneInfo={setZonePopupId}
        />
      </div>

      <ZoneSheet
        parking={parking}
        regionId={zonePopupId}
        onSave={(next) => {
          update((current) => replaceRegion(current, next));
          setZonePopupId(null);
        }}
        onClose={() => setZonePopupId(null)}
      />
    </section>
  );
}
