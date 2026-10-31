"use client";

import { Card, SectionTitle } from "@/components/ui/primitives";
import type { AdminParking } from "@/lib/adminModel";
import type { CalibrationDraft } from "@/lib/calibration";

interface Props {
  draft: CalibrationDraft;
  target: AdminParking;
  warnings: string[];
  /** Once sent, only retrying is possible: the draft is already in the admin's unsaved changes. */
  submitted: boolean;
  saving: boolean;
  failed: boolean;
  onBack: () => void;
  onSave: () => void;
}

export function ReviewStep({ draft, target, warnings, submitted, saving, failed, onBack, onSave }: Props) {
  const capacity = draft.subZones.reduce((sum, zone) => sum + zone.capacity, 0);
  const isNew = draft.target.kind === "new";

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <Card className="grid gap-3 p-4">
        <SectionTitle>{isNew ? `New zone: ${target.name}` : target.name}</SectionTitle>
        <p className="text-muted">
          Watched by <strong className="text-text">{draft.camera.name}</strong>
        </p>
        <table className="w-full text-left">
          <thead className="text-sm text-muted">
            <tr>
              <th scope="col" className="py-1 font-medium">Sub-zone</th>
              <th scope="col" className="py-1 text-right font-medium">Capacity</th>
            </tr>
          </thead>
          <tbody>
            {draft.subZones.map((zone) => (
              <tr key={zone.id} className="border-t border-border">
                <td className="py-2">{zone.name}</td>
                <td className="py-2 text-right tabular-nums">{zone.capacity}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <th scope="row" className="py-2 font-semibold">Total</th>
              <td className="py-2 text-right tabular-nums">{capacity}</td>
            </tr>
          </tfoot>
        </table>
        {isNew && <p className="text-sm text-muted">The new zone opens every day from 6:00 to 20:00. You can change this in the admin.</p>}
      </Card>

      {warnings.length > 0 && (
        <Card className="grid gap-1 p-4">
          <SectionTitle>Check before saving</SectionTitle>
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          <p className="text-sm text-muted">The plan only draws them; each sub-zone keeps its own occupancy.</p>
        </Card>
      )}

      {failed && (
        <p role="alert" className="font-semibold text-[var(--chance-bad)]">
          The zone couldn&apos;t be saved. Check the connection and try again.
        </p>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={onBack} disabled={submitted} className="tap min-h-12 flex-1 rounded-full bg-surface-2 font-semibold disabled:opacity-40">
          Back
        </button>
        <button type="button" onClick={onSave} disabled={saving} className="tap min-h-12 flex-1 rounded-full bg-primary font-semibold text-primary-fg disabled:opacity-40">
          {saving ? "Saving…" : failed ? "Try again" : "Save"}
        </button>
      </div>
    </div>
  );
}
