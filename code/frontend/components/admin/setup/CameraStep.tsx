"use client";

import { ChevronRightIcon } from "@/components/ui/Icons";
import { Card, SectionTitle } from "@/components/ui/primitives";
import type { AdminParking } from "@/lib/adminModel";
import type { Device } from "@/lib/types";

export function CameraStep({ parkings, devices, onPick }: { parkings: AdminParking[]; devices: Device[]; onPick: (camera: { id: string; name: string }) => void }) {
  const assigned = new Set(parkings.flatMap((parking) => parking.cameras.map((camera) => camera.id)));
  const free = devices.filter((device) => !assigned.has(device.id));

  return (
    <Card className="grid gap-3 p-4">
      <SectionTitle>Which camera watches this zone?</SectionTitle>
      {free.length === 0 && <p className="text-muted">Every camera is already calibrated. A new camera shows up here after it sends its first frame.</p>}
      <div className="grid gap-2">
        {free.map((device) => (
          <button key={device.id} type="button" onClick={() => onPick({ id: device.id, name: device.name })} className="tap flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 text-left">
            <span className="min-w-0">
              <span className="block truncate font-medium">{device.name}</span>
              <span className="block truncate text-xs text-muted">{device.id} · {device.online ? "Online" : "Offline"}</span>
            </span>
            <ChevronRightIcon size={20} />
          </button>
        ))}
      </div>
    </Card>
  );
}
