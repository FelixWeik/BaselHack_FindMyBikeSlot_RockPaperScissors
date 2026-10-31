"use client";

import { useState } from "react";

interface Props {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  step?: number;
  integer?: boolean;
}

/** Keeps what is typed as text, so the field can be emptied and retyped; valid numbers are committed as they come. */
export function NumberField({ label, value, onCommit, min, step, integer }: Props) {
  const [text, setText] = useState<string | null>(null);

  const change = (next: string) => {
    setText(next);
    const parsed = Number(next);
    if (next.trim() === "" || !Number.isFinite(parsed)) return;
    const rounded = integer ? Math.round(parsed) : parsed;
    onCommit(min === undefined ? rounded : Math.max(min, rounded));
  };

  return (
    <label className="grid min-w-0 gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <input
        type="number"
        inputMode={integer ? "numeric" : "decimal"}
        min={min}
        step={step}
        className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3"
        value={text ?? String(value)}
        onChange={(e) => change(e.target.value)}
        onBlur={() => setText(null)}
      />
    </label>
  );
}
