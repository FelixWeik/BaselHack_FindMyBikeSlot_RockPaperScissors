"use client";

import { useId, useState } from "react";
import { useSize } from "@/hooks/useSize";
import { FIRST_HOUR, LAST_HOUR, formatHour } from "@/lib/forecast";
import { LEVEL_LABEL, levelOf } from "@/lib/geometry";

interface Props {
  /** Chance of a spot (0..1) at a given hour. */
  chanceAt: (hour: number) => number;
  isOpenAt?: (hour: number) => boolean;
  nowHour?: number | null;
  label: string;
}

const HEIGHT = 250;
const PAD = { l: 38, r: 14, t: 36, b: 26 };
const STEP = 0.25;
const X_TICKS = [6, 9, 12, 15, 18, 21];

export function DayCurve({ chanceAt, isOpenAt, nowHour, label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [ref, { width }] = useSize();
  const [active, setActive] = useState<number | null>(null);

  const iw = Math.max(1, width - PAD.l - PAD.r);
  const ih = HEIGHT - PAD.t - PAD.b;
  const x = (h: number) => PAD.l + ((h - FIRST_HOUR) / (LAST_HOUR - FIRST_HOUR)) * iw;
  const y = (v: number) => PAD.t + ih * (1 - v);

  const steps = Array.from({ length: (LAST_HOUR - FIRST_HOUR) / STEP + 1 }, (_, i) => FIRST_HOUR + i * STEP);
  const line = steps.map((h, i) => `${i === 0 ? "M" : "L"}${x(h).toFixed(1)} ${y(chanceAt(h)).toFixed(1)}`).join("");
  const area = `${line}L${x(LAST_HOUR)} ${y(0)}L${x(FIRST_HOUR)} ${y(0)}Z`;

  const closed: [number, number][] = [];
  if (isOpenAt) {
    for (const h of steps) {
      if (isOpenAt(h)) continue;
      const last = closed[closed.length - 1];
      if (last && last[1] === h) last[1] = h + STEP;
      else closed.push([h, h + STEP]);
    }
  }

  const shown = active ?? nowHour ?? null;
  const inRange = shown !== null && shown >= FIRST_HOUR && shown <= LAST_HOUR;
  const shownValue = shown !== null ? chanceAt(shown) : 0;

  const fromPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const h = FIRST_HOUR + ((e.clientX - rect.left - PAD.l) / iw) * (LAST_HOUR - FIRST_HOUR);
    setActive(Math.min(LAST_HOUR, Math.max(FIRST_HOUR, Math.round(h / STEP) * STEP)));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const from = shown ?? FIRST_HOUR;
    const next = from + (e.key === "ArrowRight" ? 0.5 : -0.5);
    setActive(Math.min(LAST_HOUR, Math.max(FIRST_HOUR, next)));
  };

  const tooltipLeft = inRange ? Math.max(0, Math.min(width - 176, x(shown) - 88)) : 0;
  const isClosed = inRange && isOpenAt ? !isOpenAt(shown) : false;
  const readout = inRange
    ? `${formatHour(shown)}: ${isClosed ? "closed" : `${Math.round(shownValue * 100)}%, ${LEVEL_LABEL[levelOf(shownValue)].toLowerCase()}`}`
    : "";

  return (
    <div ref={ref} className="relative w-full min-w-0 overflow-hidden">
      <svg
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={FIRST_HOUR}
        aria-valuemax={LAST_HOUR}
        aria-valuenow={inRange ? shown : FIRST_HOUR}
        aria-valuetext={readout}
        width={width}
        height={HEIGHT}
        onPointerDown={fromPointer}
        onPointerMove={fromPointer}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
        className="block touch-pan-y rounded-lg"
      >
        <defs>
          <linearGradient id={`line${uid}`} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={y(1)} y2={y(0)}>
            <stop offset="0%" stopColor="var(--chance-good)" />
            <stop offset="50%" stopColor="var(--chance-ok)" />
            <stop offset="100%" stopColor="var(--chance-bad)" />
          </linearGradient>
        </defs>

        {closed.map(([a, b]) => (
          <rect key={a} x={x(a)} y={PAD.t} width={Math.max(0, x(Math.min(b, LAST_HOUR)) - x(a))} height={ih} fill="var(--surface-2)" opacity={0.55} />
        ))}

        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--border)" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">
              {t * 100}%
            </text>
          </g>
        ))}

        {X_TICKS.map((h) => (
          <text key={h} x={x(h)} y={HEIGHT - 6} textAnchor={h === LAST_HOUR ? "end" : "middle"} fontSize="12" fill="var(--muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
            {h}:00
          </text>
        ))}

        <path d={area} fill={`url(#line${uid})`} opacity={0.1} />
        <path d={line} fill="none" stroke={`url(#line${uid})`} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

        {inRange && (
          <g pointerEvents="none">
            <line x1={x(shown)} x2={x(shown)} y1={PAD.t} y2={y(0)} stroke="var(--text)" strokeWidth={1} />
            <circle cx={x(shown)} cy={y(shownValue)} r={5.5} fill="var(--text)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
      </svg>

      {inRange && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 w-[176px] whitespace-nowrap rounded-full bg-primary px-2 py-1.5 text-center text-xs font-semibold tabular-nums text-primary-fg"
          style={{ left: tooltipLeft }}
        >
          {active === null && nowHour !== null ? "Now · " : ""}
          {readout}
        </div>
      )}
    </div>
  );
}
