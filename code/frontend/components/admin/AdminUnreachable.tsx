"use client";

import { OfflineIcon } from "@/components/ui/Icons";
import { loadAdmin } from "@/lib/adminStore";

/** The admin only needs the zones and devices, so it doesn't share the live screens' heatmap-driven state. */
export function AdminUnreachable() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[1.75rem] bg-surface p-8 text-center shadow-card">
      <OfflineIcon size={32} />
      <h2 className="font-display text-xl font-semibold">Can&apos;t reach the server</h2>
      <p className="max-w-xs text-muted">The zones couldn&apos;t be loaded, so nothing can be edited for now.</p>
      <button type="button" onClick={() => void loadAdmin()} className="tap mt-1 min-h-11 rounded-full bg-primary px-5 font-semibold text-primary-fg">
        Try again
      </button>
    </div>
  );
}
