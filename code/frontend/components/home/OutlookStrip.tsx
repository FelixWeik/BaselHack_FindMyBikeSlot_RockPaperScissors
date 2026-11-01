"use client";

import Link from "next/link";
import { ChevronRightIcon } from "@/components/ui/Icons";
import { Card } from "@/components/ui/primitives";
import type { ParkingItem } from "@/hooks/useLive";
import { HOURS, chanceAt, formatHour, freesUpAt, tightFrom } from "@/lib/forecast";
import { chanceColor } from "@/lib/heat";
import { isOpenAt } from "@/lib/schedule";

function headline(id: string, day: number, hour: number): string {
  const tight = tightFrom(id, day);
  const frees = freesUpAt(id, day);
  if (tight === null) return "Should stay easy all day";
  if (hour < tight) return `Gets tight around ${formatHour(tight)}`;
  if (frees !== null && hour < frees) return `Frees up around ${formatHour(frees)}`;
  return "Should stay easy from now on";
}

export function OutlookStrip({ item }: { item: ParkingItem }) {
  const { id, schedule } = item.config;
  const { day, hour } = item.clock;

  return (
    <Link href={`/forecast?p=${encodeURIComponent(id)}`} className="tap block">
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted">Later today at {item.config.name}</p>
            <p className="font-display text-lg font-semibold leading-snug">{headline(id, day, hour)}</p>
          </div>
          <ChevronRightIcon />
        </div>
        <div aria-hidden="true" className="mt-4 flex gap-0.5">
          {HOURS.map((h) => {
            const open = isOpenAt(schedule, day, h);
            const isNow = Math.floor(hour) === h;
            return (
              <div key={h} className="relative h-6 flex-1">
                <div
                  className="h-full rounded-[4px]"
                  style={{ background: open ? chanceColor(chanceAt(id, day, h)) : "var(--surface-2)" }}
                />
                {isNow && <div className="absolute -inset-x-px -inset-y-1 rounded-[5px] border-2 border-text" />}
              </div>
            );
          })}
        </div>
        <div aria-hidden="true" className="mt-1.5 flex justify-between text-xs text-muted tabular-nums">
          <span>{HOURS[0]}:00</span>
          <span>{HOURS[HOURS.length - 1]}:00</span>
        </div>
      </Card>
    </Link>
  );
}
