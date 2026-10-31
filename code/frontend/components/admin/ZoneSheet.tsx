"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import type { AdminParking, AdminRegion } from "@/lib/adminModel";
import { NumberField } from "./NumberField";

// The form edits its own draft: nothing reaches the document until Save, so Cancel really cancels.
function ZoneForm({ region, onSave, onClose }: { region: AdminRegion; onSave: (region: AdminRegion) => void; onClose: () => void }) {
  const [name, setName] = useState(region.name ?? "");
  const [slotCount, setSlotCount] = useState(region.slotCount);

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...region, name: name.trim() || undefined, slotCount });
      }}
    >
      <label className="grid gap-2 text-sm">
        <span className="text-muted">Name</span>
        <input className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <NumberField label="Capacity, shared by every camera watching it" min={1} integer value={slotCount} onCommit={setSlotCount} />
      <div className="flex gap-2">
        <button type="button" className="tap min-h-12 flex-1 rounded-full bg-surface-2 font-semibold" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="tap min-h-12 flex-1 rounded-full bg-primary font-semibold text-primary-fg">
          Save
        </button>
      </div>
    </form>
  );
}

export function ZoneSheet({ parking, regionId, onSave, onClose }: { parking: AdminParking; regionId: string | null; onSave: (region: AdminRegion) => void; onClose: () => void }) {
  const region = parking.geometry.regions.find((r) => r.id === regionId) ?? null;
  return (
    <Sheet open={Boolean(region)} title="Edit sub-zone" onClose={onClose}>
      {region && <ZoneForm key={region.id} region={region} onSave={onSave} onClose={onClose} />}
    </Sheet>
  );
}
