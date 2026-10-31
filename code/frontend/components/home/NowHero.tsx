"use client";

import Link from "next/link";
import { ArrowRightIcon } from "@/components/ui/Icons";
import type { ParkingItem } from "@/hooks/useLive";
import { boxOf, polygonPath, type Level } from "@/lib/geometry";
import type { Recommendation } from "@/lib/recommend";

const HERO_STYLE: Record<Level, React.CSSProperties> = {
  high: { background: "var(--hero-good)", color: "var(--hero-good-fg)" },
  medium: { background: "var(--hero-ok)", color: "var(--hero-ok-fg)" },
  low: { background: "var(--hero-bad)", color: "var(--hero-bad-fg)" },
};

const EYEBROW: Record<Level, string> = {
  high: "Go here now",
  medium: "Your best bet",
  low: "Everything is nearly full",
};

function ZoneShape({ boundary }: { boundary: { x: number; y: number }[] }) {
  const b = boxOf(boundary);
  return (
    <svg
      aria-hidden="true"
      viewBox={`${b.minX} ${b.minY} ${b.maxX - b.minX} ${b.maxY - b.minY}`}
      className="pointer-events-none absolute -bottom-10 -right-8 h-52 w-64 overflow-visible opacity-20"
    >
      <path d={polygonPath(boundary)} fill="currentColor" stroke="currentColor" strokeWidth={8} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function NowHero({ recommendation }: { recommendation: Recommendation<ParkingItem> }) {
  if (recommendation.kind === "closed") {
    return (
      <section aria-label="Recommendation" className="rise rounded-[2rem] bg-primary p-6 text-primary-fg">
        <p className="text-sm font-semibold opacity-80">Right now</p>
        <p className="mt-2 font-display text-5xl font-bold leading-[1.02] tracking-tight">All parkings are closed</p>
        <p className="mt-3 font-medium opacity-80">
          {recommendation.item.config.name}: {recommendation.item.openState.label.toLowerCase()}
        </p>
      </section>
    );
  }

  const { item, stat, level } = recommendation;
  const pct = Math.round(stat.chance * 100);
  const href = `/map?p=${encodeURIComponent(item.config.id)}&z=${encodeURIComponent(stat.key)}`;

  return (
    <section aria-label="Recommendation" className="rise">
      <Link
        href={href}
        style={HERO_STYLE[level]}
        className="tap relative block overflow-hidden rounded-[2rem] p-6 transition-colors duration-700"
      >
        <ZoneShape boundary={stat.region.boundary} />
        <p className="relative text-sm font-semibold">{EYEBROW[level]}</p>
        <p className="relative mt-2 font-display text-[4.25rem] font-bold leading-none tracking-tight">{stat.name}</p>
        <p className="relative mt-2 text-lg font-medium">{item.config.name}</p>

        <div className="relative mt-7 flex items-end justify-between gap-4">
          <div>
            <p className="font-display text-4xl font-bold leading-none tabular-nums">{pct}%</p>
            <p className="mt-1 text-sm font-medium">chance of a spot</p>
            <p className="text-sm font-medium">{item.openState.label}</p>
          </div>
          <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-current">
            <span style={{ color: HERO_STYLE[level].background as string }}>
              <ArrowRightIcon />
            </span>
          </span>
        </div>
      </Link>
      <p className="sr-only" aria-live="polite">
        Recommended: {stat.name}, {item.config.name}
      </p>
    </section>
  );
}
