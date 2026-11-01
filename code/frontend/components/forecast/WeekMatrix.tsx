"use client";

import { useState } from "react";
import { DAYS, HOURS, chanceAt, formatHour } from "@/lib/forecast";
import { LEVEL_LABEL, levelOf } from "@/lib/geometry";
import { chanceColor } from "@/lib/heat";
import { WEEK_LABEL, isOpenAt } from "@/lib/schedule";
import type { Clock, ParkingLotConfig } from "@/lib/types";

interface Props {
  config: ParkingLotConfig;
  selectedDay: number;
  clock: Clock;
  onSelectDay: (day: number) => void;
}

const DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6];
const describe = (open: boolean, value: number) =>
  open ? `${Math.round(value * 100)}%, ${LEVEL_LABEL[levelOf(value)].toLowerCase()}` : "Closed";

export function WeekMatrix({ config, selectedDay, clock, onSelectDay }: Props) {
  const [hovered, setHovered] = useState<{ day: number; hour: number } | null>(null);
  const { id, schedule } = config;
  const nowHour = Math.floor(clock.hour);

  const readout = hovered
    ? `${DAYS[hovered.day]} ${formatHour(hovered.hour)}: ${describe(isOpenAt(schedule, hovered.day, hovered.hour), chanceAt(id, hovered.day, hovered.hour))}`
    : "Tap a day to see its curve";

  return (
    <div>
      <div aria-hidden="true" className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-1">
        <div />
        <div className="relative mb-1 h-4 text-xs text-muted tabular-nums">
          {[6, 12, 18].map((h) => (
            <span key={h} className="absolute -translate-x-0" style={{ left: `${((h - HOURS[0]) / HOURS.length) * 100}%` }}>
              {h}:00
            </span>
          ))}
        </div>

        {DAY_INDEXES.map((day) => (
          <div key={day} className="contents">
            <button
              tabIndex={-1}
              onClick={() => onSelectDay(day)}
              className={`h-6 text-left text-xs font-semibold ${day === selectedDay ? "text-text" : "text-muted"}`}
            >
              {WEEK_LABEL[day]}
            </button>
            <div
              onClick={() => onSelectDay(day)}
              className={`mb-0.5 grid cursor-pointer gap-0.5 rounded-md ${day === selectedDay ? "outline-2 outline-offset-1 outline-text" : ""}`}
              style={{ gridTemplateColumns: `repeat(${HOURS.length}, minmax(0, 1fr))` }}
            >
              {HOURS.map((hour) => {
                const open = isOpenAt(schedule, day, hour);
                const isNow = day === clock.day && hour === nowHour;
                return (
                  <div
                    key={hour}
                    onPointerEnter={() => setHovered({ day, hour })}
                    onPointerLeave={() => setHovered(null)}
                    className={`h-[1.375rem] rounded-[4px] ${isNow ? "ring-2 ring-text ring-offset-1 ring-offset-surface" : ""}`}
                    style={{ background: open ? chanceColor(chanceAt(id, day, hour)) : "var(--surface-2)" }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted">
        <p className="min-h-4 font-medium tabular-nums" aria-hidden="true">
          {readout}
        </p>
        <div className="flex items-center gap-2" aria-hidden="true">
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded-[3px] bg-surface-2" />
            Closed
          </span>
          <span className="ml-1">Full</span>
          <span className="h-2 w-14 rounded-full" style={{ background: "var(--chance-ramp)" }} />
          <span>Free</span>
        </div>
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-muted">View as a table</summary>
        <div className="scroller mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-xs tabular-nums">
            <caption className="sr-only">Chance of a spot by day and hour</caption>
            <thead>
              <tr>
                <th scope="col" className="p-1 text-left font-semibold">
                  Hour
                </th>
                {DAY_INDEXES.map((d) => (
                  <th key={d} scope="col" className="p-1 text-right font-semibold">
                    {WEEK_LABEL[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HOURS.map((hour) => (
                <tr key={hour} className="border-t border-border">
                  <th scope="row" className="p-1 text-left font-medium">
                    {hour}:00
                  </th>
                  {DAY_INDEXES.map((d) => (
                    <td key={d} className="p-1 text-right">
                      {isOpenAt(schedule, d, hour) ? `${Math.round(chanceAt(id, d, hour) * 100)}%` : "–"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
