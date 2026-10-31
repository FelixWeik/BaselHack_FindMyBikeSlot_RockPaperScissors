"use client";

import Link from "next/link";
import { ViewTransition } from "react";
import { RegionMap } from "@/components/map/RegionMap";
import { StarIcon } from "@/components/ui/Icons";
import { Card, Gauge, Sparkline, TrendLabel } from "@/components/ui/primitives";
import type { ParkingItem } from "@/hooks/useLive";
import { LEVEL_LABEL, bestRegion } from "@/lib/geometry";
import { toggleFavorite, updateSettings } from "@/lib/settings";

export function ParkingCard({ item, favorite }: { item: ParkingItem; favorite: boolean }) {
  const { config, heatmap, stats, overall, level, openState, trend, history } = item;
  const pct = Math.round(overall * 100);
  const open = openState.open;
  const best = stats ? bestRegion(stats) : null;
  const href = `/map?p=${encodeURIComponent(config.id)}`;

  return (
    <Card className="relative flex gap-4 p-4">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-1">
          <h3 className="min-w-0 flex-1 font-display text-xl font-semibold leading-tight tracking-tight">
            {/* The stretched link makes the whole card tappable while the star stays its own control. */}
            <Link href={href} onClick={() => updateSettings({ lastParking: config.id })} className="before:absolute before:inset-0 before:rounded-[1.75rem]">
              {config.name}
            </Link>
          </h3>
          <button
            onClick={() => toggleFavorite(config.id)}
            aria-pressed={favorite}
            aria-label={`Favorite ${config.name}`}
            className={`tap relative -mr-1 -mt-2 grid size-11 shrink-0 place-items-center rounded-full ${favorite ? "text-text" : "text-muted"}`}
          >
            <StarIcon size={20} filled={favorite} />
          </button>
        </div>

        {stats ? (
          open ? (
            <>
              <Gauge chance={overall} label={`${config.name} chance of a spot`} className="mt-2" />
              <p className="mt-2 flex items-baseline justify-between gap-2">
                <span className="font-semibold">{LEVEL_LABEL[level]}</span>
                <span className="font-display text-lg font-bold tabular-nums">{pct}%</span>
              </p>
              <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted">
                {trend ? <TrendLabel trend={trend} /> : <span>{openState.label}</span>}
                {best && stats.length > 1 && <span>Best: {best.name}</span>}
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 font-semibold">Closed</p>
              <p className="text-sm text-muted">{openState.label}</p>
            </>
          )
        ) : (
          <div aria-hidden="true" className="mt-3 h-12 animate-pulse rounded-xl bg-surface-2" />
        )}
      </div>

      <div className="flex w-28 shrink-0 flex-col justify-center gap-1.5 self-center sm:w-32">
        <ViewTransition name={`parking-map-${config.id}`}>
          <div className={`aspect-[4/3] overflow-hidden rounded-2xl ring-1 ring-border ${open ? "" : "opacity-50 saturate-50"}`}>
            {heatmap && stats ? (
              <RegionMap config={config} heatmap={heatmap} stats={stats} highlightKey={open && stats.length > 1 ? best?.key : null} compact className="size-full" />
            ) : (
              <div className="size-full animate-pulse bg-surface-2" />
            )}
          </div>
        </ViewTransition>
        {open && <Sparkline values={history.map((h) => h.overall)} className="h-5 w-full" />}
      </div>
    </Card>
  );
}
