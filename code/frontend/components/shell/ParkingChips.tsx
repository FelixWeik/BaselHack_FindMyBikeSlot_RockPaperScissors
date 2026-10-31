"use client";

import type { ParkingItem } from "@/hooks/useLive";
import { chanceColor } from "@/lib/heat";

interface Props {
  items: ParkingItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ParkingChips({ items, selectedId, onSelect }: Props) {
  if (items.length < 2) return null;
  return (
    <div role="radiogroup" aria-label="Parking" className="scroller -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 py-1 sm:-mx-6 sm:px-6">
      {items.map((i) => {
        const selected = i.config.id === selectedId;
        return (
          <button
            key={i.config.id}
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(i.config.id)}
            className={`tap flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors ${
              selected ? "bg-primary text-primary-fg" : "bg-surface shadow-card"
            }`}
          >
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ background: i.stats && i.openState.open ? chanceColor(i.overall) : "var(--muted)" }}
            />
            {i.config.name}
          </button>
        );
      })}
    </div>
  );
}
