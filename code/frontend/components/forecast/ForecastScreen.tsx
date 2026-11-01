"use client";

import { useState } from "react";
import { ParkingChips } from "@/components/shell/ParkingChips";
import { PageHeader } from "@/components/shell/PageHeader";
import { NoParkings, UnreachableState } from "@/components/shell/LiveStatus";
import { Card, MapSkeleton, SectionTitle } from "@/components/ui/primitives";
import { useLive, useSelection, type ParkingItem } from "@/hooks/useLive";
import { DAYS, chanceAt, formatHour, freesUpAt, tightFrom } from "@/lib/forecast";
import { WEEK, WEEK_LABEL, isOpenAt } from "@/lib/schedule";
import { DayCurve } from "./DayCurve";
import { WeekMatrix } from "./WeekMatrix";

function advice(id: string, day: number, anyOpen: boolean) {
  if (!anyOpen) return { title: "Closed all day", sub: "Pick another day or parking." };
  const tight = tightFrom(id, day);
  if (tight === null) return { title: "Any time works", sub: "Spots should be available all day." };
  const frees = freesUpAt(id, day);
  return {
    title: `Arrive before ${formatHour(tight)}`,
    sub: frees !== null ? `After that it's tight until about ${formatHour(frees)}.` : "After that it stays tight.",
  };
}

function ForecastBody({ item }: { item: ParkingItem }) {
  const { id, schedule, name } = item.config;
  const today = item.clock.day;
  const [picked, setPicked] = useState<number | null>(null);
  const day = picked ?? today;
  const isToday = day === today;
  const anyOpen = (schedule.weekly[WEEK[day]] ?? []).length > 0;
  const { title, sub } = advice(id, day, anyOpen);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        <Card className="p-5">
          <p className="text-sm font-medium text-muted">{isToday ? "Today" : DAYS[day]}</p>
          <p className="mt-1 font-display text-4xl font-bold leading-[1.05] tracking-tight">{title}</p>
          <p className="mt-2 text-muted">{sub}</p>
        </Card>

        <div role="tablist" aria-label="Day of the week" className="flex gap-1 rounded-full bg-surface-2 p-1">
          {WEEK_LABEL.map((d, i) => (
            <button
              key={d}
              role="tab"
              aria-selected={i === day}
              aria-label={DAYS[i]}
              onClick={() => setPicked(i)}
              className={`min-h-10 flex-1 rounded-full text-sm font-medium transition-colors ${i === day ? "bg-surface shadow-card" : "text-muted"}`}
            >
              {d.slice(0, 2)}
            </button>
          ))}
        </div>

        <Card className="p-4">
          <DayCurve
            key={id}
            label={`Chance of a spot at ${name} on ${DAYS[day]}. Use the arrow keys to move through the day.`}
            chanceAt={(h) => chanceAt(id, day, h)}
            isOpenAt={(h) => isOpenAt(schedule, day, h)}
            nowHour={isToday ? item.clock.hour : null}
          />
        </Card>
      </div>

      <section aria-labelledby="week-title" className="min-w-0">
        <Card className="p-5">
          <SectionTitle id="week-title" className="mb-4">
            The whole week
          </SectionTitle>
          <WeekMatrix config={item.config} selectedDay={day} clock={item.clock} onSelectDay={setPicked} />
        </Card>
      </section>
    </div>
  );
}

export function ForecastScreen() {
  const { items, loading, unreachable } = useLive();
  const { item, selectParking } = useSelection(items);

  return (
    <>
      <PageHeader eyebrow="Forecast" title={item?.config.name ?? "Forecast"} />
      {!item ? (
        unreachable ? <UnreachableState /> : loading ? <MapSkeleton /> : <NoParkings />
      ) : (
        <>
          <ParkingChips items={items} selectedId={item.config.id} onSelect={selectParking} />
          <ForecastBody item={item} />
        </>
      )}
    </>
  );
}
