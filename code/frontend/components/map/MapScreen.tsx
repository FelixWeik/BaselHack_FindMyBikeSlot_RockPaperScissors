"use client";

import { useState, ViewTransition } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { ParkingChips } from "@/components/shell/ParkingChips";
import { StaleNotice, UnreachableState } from "@/components/shell/LiveStatus";
import { CloseIcon, ShareIcon } from "@/components/ui/Icons";
import { Card, Gauge, MapSkeleton, Sparkline, TrendLabel } from "@/components/ui/primitives";
import { useLive, useRecommendation, useSelection, type ParkingItem } from "@/hooks/useLive";
import { LEVEL_LABEL, boxOf, type RegionStat } from "@/lib/geometry";
import { chanceColor } from "@/lib/heat";
import { trendOf } from "@/lib/recommend";
import { RegionMap } from "./RegionMap";

function Legend() {
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-muted" role="img" aria-label="Color scale: red is a low chance of a spot, green is a high chance">
      <span>Full</span>
      <span
        aria-hidden="true"
        className="h-2 w-20 rounded-full"
        style={{ background: "var(--chance-ramp)" }}
      />
      <span>Free</span>
    </div>
  );
}

function ShareButton({ item, stat }: { item: ParkingItem; stat: RegionStat | null }) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = window.location.href;
    const title = stat ? `${stat.name} · ${item.config.name}` : item.config.name;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // the user closed the share sheet
    }
  };

  return (
    <button onClick={() => void share()} className="tap flex min-h-11 items-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-semibold">
      <ShareIcon size={18} />
      <span aria-live="polite">{copied ? "Link copied" : "Share"}</span>
    </button>
  );
}

function ZoneRow({
  item,
  stat,
  recommended,
  selected,
  onSelect,
}: {
  item: ParkingItem;
  stat: RegionStat;
  recommended: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const pct = Math.round(stat.chance * 100);
  const read = (s: { zones: Record<string, number> }) => s.zones[stat.key];
  const trend = trendOf(item.history, read);
  const open = item.openState.open;

  return (
    <li>
      <button
        onClick={onSelect}
        aria-pressed={selected}
        className={`tap w-full rounded-3xl p-3.5 text-left transition-colors ${selected ? "bg-primary text-primary-fg" : "bg-surface shadow-card"}`}
      >
        <span className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-2xl font-display text-lg font-bold text-[#15150f]"
            style={{ background: open ? chanceColor(stat.chance) : "var(--surface-2)" }}
          >
            {stat.key}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 font-semibold">
              {stat.name}
              {recommended && open && (
                <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${selected ? "bg-primary-fg text-primary" : "bg-primary text-primary-fg"}`}>
                  ★ Best
                </span>
              )}
            </span>
            <span className={`flex flex-wrap items-center gap-x-2 text-sm ${selected ? "opacity-80" : "text-muted"}`}>
              {open ? LEVEL_LABEL[stat.level] : "Closed"}
              {open && <TrendLabel trend={trend} />}
            </span>
          </span>
          {open && (
            <span className="font-display text-2xl font-bold tabular-nums">
              {pct}
              <span className="text-base">%</span>
            </span>
          )}
        </span>
        {open && <Gauge chance={stat.chance} className="mt-3 !h-1.5" />}
      </button>
    </li>
  );
}

function MapBody({ item, zoneKey, selectZone }: { item: ParkingItem; zoneKey: string | null; selectZone: (key: string | null) => void }) {
  const recommendation = useRecommendation([item]);
  const stats = item.stats;
  const heatmap = item.heatmap;
  if (!stats || !heatmap) return <MapSkeleton />;

  const best = recommendation?.kind === "go" ? recommendation.stat : null;
  const selected = stats.find((s) => s.key === zoneKey) ?? null;
  const open = item.openState.open;
  const chance = selected ? selected.chance : item.overall;
  const zoneHistory = item.history.map((h) => (selected ? (h.zones[selected.key] ?? 0) : h.overall));
  // The map takes the shape of the lot on phones, instead of letterboxing a wide lot in a tall frame.
  const lot = boxOf(stats.flatMap((s) => s.region.boundary));
  const ratio = Math.max(1, Math.min(2, (lot.maxX - lot.minX) / Math.max(1, lot.maxY - lot.minY)));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <Card className="relative overflow-hidden lg:sticky lg:top-8">
        <ViewTransition name={`parking-map-${item.config.id}`}>
          <RegionMap
            config={item.config}
            heatmap={heatmap}
            stats={stats}
            focusKey={selected?.key}
            highlightKey={best?.key}
            hideChance={!open}
            onSelect={selectZone}
            style={{ "--map-ratio": ratio } as React.CSSProperties}
            className={`w-full [aspect-ratio:var(--map-ratio)] lg:h-[calc(100dvh-17rem)] lg:[aspect-ratio:auto] ${open ? "" : "opacity-50 saturate-50"}`}
          />
        </ViewTransition>
        {!open && (
          <p className="absolute left-3 top-3 rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-primary-fg">
            Closed · {item.openState.label}
          </p>
        )}
        <div className="flex min-h-14 items-center justify-between gap-3 px-3 py-1.5">
          {selected ? (
            <button
              onClick={() => selectZone(null)}
              className="tap flex min-h-11 items-center gap-1.5 rounded-full bg-primary pl-3 pr-4 text-sm font-semibold text-primary-fg"
            >
              <CloseIcon size={18} />
              Whole parking
            </button>
          ) : (
            <p className="pl-1 text-sm text-muted">Tap a zone to zoom in</p>
          )}
          <Legend />
        </div>
      </Card>

      <div className="flex flex-col gap-3">
        <Card className="p-5">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-muted">{selected ? selected.name : "Whole parking"}</p>
              {open ? (
                <>
                  <p className="font-display text-5xl font-bold leading-none tracking-tight tabular-nums">
                    {Math.round(chance * 100)}
                    <span className="text-2xl">%</span>
                  </p>
                  <p className="mt-1 text-sm text-muted">chance of a spot</p>
                </>
              ) : (
                <p className="font-display text-4xl font-bold leading-none tracking-tight">Closed</p>
              )}
            </div>
            {open && <Sparkline values={zoneHistory} label="Chance over the last minutes" className="h-12 w-28 shrink-0" />}
          </div>
          <p className="mt-4 border-t border-border pt-3 text-sm text-muted">
            {item.openState.label} · {item.config.totalSlots} spots
          </p>
          <div className="mt-3">
            <ShareButton item={item} stat={selected} />
          </div>
        </Card>

        <ul aria-label="Zones" className="flex flex-col gap-2.5">
          {stats.map((s) => (
            <ZoneRow
              key={s.key}
              item={item}
              stat={s}
              recommended={s.key === best?.key && stats.length > 1}
              selected={s.key === selected?.key}
              onSelect={() => selectZone(s.key === selected?.key ? null : s.key)}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

export function MapScreen() {
  const { items, loading, unreachable } = useLive();
  const { item, zoneKey, selectParking, selectZone } = useSelection(items);

  return (
    <>
      <PageHeader eyebrow="Live map" title={item?.config.name ?? "Map"} live />
      <StaleNotice />
      {!item ? (
        unreachable ? <UnreachableState /> : <MapSkeleton />
      ) : (
        <>
          <ParkingChips items={items} selectedId={item.config.id} onSelect={selectParking} />
          {!item.stats && !loading ? <UnreachableState /> : <MapBody item={item} zoneKey={zoneKey} selectZone={selectZone} />}
        </>
      )}
    </>
  );
}
