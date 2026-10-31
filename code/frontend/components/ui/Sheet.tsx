"use client";

import { useEffect, useRef } from "react";
import { CloseIcon } from "./Icons";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

/** Native dialog: focus trap, Esc and inert background come for free. */
export function Sheet({ open, title, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-semibold tracking-tight">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="tap grid size-11 place-items-center rounded-full bg-surface-2">
            <CloseIcon size={20} />
          </button>
        </div>
        {open && children}
      </div>
    </dialog>
  );
}
