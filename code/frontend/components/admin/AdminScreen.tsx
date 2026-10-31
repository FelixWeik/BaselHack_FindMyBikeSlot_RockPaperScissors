"use client";

import { DayCurve } from "@/components/forecast/DayCurve";
import { PageHeader } from "@/components/shell/PageHeader";
import { UnreachableState } from "@/components/shell/LiveStatus";
import { Card, ListSkeleton, SectionTitle } from "@/components/ui/primitives";
import { useLive } from "@/hooks/useLive";
import { DAYS, HARD_TO_PARK, HOURS, formatHour, tightFrom, weekAverage, weeklyLow } from "@/lib/forecast";
import { ZonesAdmin } from "./ZonesAdmin";

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-muted">{hint}</p>
    </Card>
  );
}

export function AdminScreen() {
  const { items, loading, unreachable } = useLive();
  const parkings = items.map((i) => i.config);
  const ids = parkings.map((p) => p.id);

  if (unreachable) {
    return (
      <>
        <PageHeader title="Admin" />
        <UnreachableState />
      </>
    );
  }
  if (loading || ids.length === 0) {
    return (
      <>
        <PageHeader title="Admin" />
        <ListSkeleton />
      </>
    );
  }

  const low = weeklyLow(ids);
  const office = HOURS.filter((h) => h >= 8 && h <= 18);
  const officeAverage = office.reduce((s, h) => s + weekAverage(ids, h), 0) / office.length;
  const tightHours = ids.map((id) => tightFrom(id, 1)).filter((h): h is number => h !== null);
  const tightAverage = tightHours.length > 0 ? tightHours.reduce((s, h) => s + h, 0) / tightHours.length : null;

  return (
    <>
      <PageHeader eyebrow="One organization" title="Admin" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-label="Key figures" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <Kpi label="Tightest moment" value={`${Math.round(low.value * 100)}%`} hint={`${DAYS[low.day]} at ${formatHour(low.hour)}`} />
            <Kpi label="Average chance" value={`${Math.round(officeAverage * 100)}%`} hint="Weekdays, 8:00–18:00" />
            <Kpi
              label="Gets tight at"
              value={tightAverage === null ? "Never" : formatHour(Math.round(tightAverage * 4) / 4)}
              hint={`Chance drops under ${Math.round(HARD_TO_PARK * 100)}%`}
            />
          </section>

          <section aria-labelledby="avg-title">
            <Card className="p-5">
              <SectionTitle id="avg-title" className="mb-4">
                Average weekday
              </SectionTitle>
              <DayCurve label="Average chance of a spot across all parkings on a weekday" chanceAt={(h) => weekAverage(ids, h)} />
            </Card>
            <p className="mt-3 px-2 text-sm text-muted">Simulated figures, until the backend provides history.</p>
          </section>
        </div>

        <ZonesAdmin parkings={parkings} />
      </div>
    </>
  );
}
