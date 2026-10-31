"use client";

import { usePwa } from "@/hooks/usePwa";

/** Mounted once in the layout: starts the service worker and offers updates. */
export function PwaPrompts() {
  const { waitingWorker, applyUpdate } = usePwa();
  if (!waitingWorker) return null;

  return (
    <div
      role="status"
      className="rise fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+6.25rem)] z-30 mx-auto flex max-w-md items-center justify-between gap-3 rounded-full bg-primary py-2 pl-5 pr-2 text-sm font-medium text-primary-fg shadow-nav lg:bottom-6"
    >
      A new version is ready
      <button onClick={applyUpdate} className="tap min-h-10 rounded-full bg-primary-fg px-4 font-semibold text-primary">
        Reload
      </button>
    </div>
  );
}
