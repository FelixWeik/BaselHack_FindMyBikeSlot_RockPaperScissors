"use client";

import { CloseIcon, DownloadIcon } from "@/components/ui/Icons";
import { Card } from "@/components/ui/primitives";
import { useIsIos, usePwa } from "@/hooks/usePwa";
import { updateSettings, useSettings } from "@/lib/settings";

export const IOS_INSTALL_HINT = "In Safari, tap Share, then “Add to Home Screen”.";

export function InstallCard() {
  const { canPrompt, install, installed } = usePwa();
  const ios = useIsIos();
  const { installDismissed } = useSettings();

  if (installed || installDismissed || (!canPrompt && !ios)) return null;

  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-2">
        <DownloadIcon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Keep it on your home screen</p>
        <p className="text-sm text-muted">{ios ? IOS_INSTALL_HINT : "One tap away, even with no signal in the garage."}</p>
      </div>
      {canPrompt && (
        <button onClick={() => void install()} className="tap min-h-11 shrink-0 rounded-full bg-primary px-4 text-sm font-semibold text-primary-fg">
          Install
        </button>
      )}
      <button
        aria-label="Dismiss"
        onClick={() => updateSettings({ installDismissed: true })}
        className="tap -mr-1 grid size-11 shrink-0 place-items-center rounded-full text-muted"
      >
        <CloseIcon size={18} />
      </button>
    </Card>
  );
}
