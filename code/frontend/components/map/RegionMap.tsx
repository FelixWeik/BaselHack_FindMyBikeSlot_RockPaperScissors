"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useSize } from "@/hooks/useSize";
import { boxOf, polygonPath, type RegionStat } from "@/lib/geometry";
import { chanceColor } from "@/lib/heat";
import type { ParkingLotConfig } from "@/lib/types";

interface Props {
  config: ParkingLotConfig;
  stats: RegionStat[];
  /** Zoom on one region; omit for the whole parking. */
  focusKey?: string | null;
  /** Region marked as the recommended one. */
  highlightKey?: string | null;
  /** Thumbnail: no labels, no interaction, hidden from assistive tech. */
  compact?: boolean;
  /** Closed parking: label zones without a percentage, which would mean nothing. */
  hideChance?: boolean;
  onSelect?: (key: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

type View = { x: number; y: number; w: number; h: number };

const GRID_METERS = 5;
const SCALE_METERS = 10;

function viewOf(stats: RegionStat[], compact?: boolean): View {
  const box = boxOf(stats.flatMap((s) => s.region.boundary));
  const span = Math.max(box.maxX - box.minX, box.maxY - box.minY);
  const pad = span * (compact ? 0.04 : 0.05);
  // Extra room at the bottom keeps the scale bar clear of the zones.
  const bottom = compact ? pad : pad * 2.6;
  return { x: box.minX - pad, y: box.minY - pad, w: box.maxX - box.minX + 2 * pad, h: box.maxY - box.minY + pad + bottom };
}

/** Eases the map between the whole parking and a zone. viewBox can't be animated with CSS. */
function useAnimatedView(target: View, animate: boolean): View {
  const [view, setView] = useState(target);
  const viewRef = useRef(target);
  const key = `${target.x}:${target.y}:${target.w}:${target.h}`;

  useEffect(() => {
    const [x, y, w, h] = key.split(":").map(Number);
    const end = { x, y, w, h };
    const start = viewRef.current;
    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      viewRef.current = end;
      const frame = requestAnimationFrame(() => setView(end));
      return () => cancelAnimationFrame(frame);
    }
    const startedAt = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - startedAt) / 420);
      const e = 1 - (1 - t) ** 3;
      const next = {
        x: start.x + (end.x - start.x) * e,
        y: start.y + (end.y - start.y) * e,
        w: start.w + (end.w - start.w) * e,
        h: start.h + (end.h - start.h) * e,
      };
      viewRef.current = next;
      setView(next);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [key, animate]);

  return view;
}

export function RegionMap({ config, stats, focusKey, highlightKey, compact, hideChance, onSelect, className = "", style }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const focused = focusKey ? stats.filter((s) => s.key === focusKey) : stats;
  const visible = focused.length > 0 ? focused : stats;
  const target = useMemo(() => viewOf(visible, compact), [visible, compact]);
  const vb = useAnimatedView(target, !compact);

  // Labels keep the same on-screen size at every zoom level and on every display.
  const [sizeRef, size] = useSize();
  const metersPerPixel = Math.max(vb.w / Math.max(1, size.width), vb.h / Math.max(1, size.height));
  const fontSize = 13.5 * metersPerPixel;
  const gridId = `grid${uid}`;
  const interactive = !!onSelect && !focusKey;

  return (
    <div
      role={compact ? undefined : "group"}
      aria-label={compact ? undefined : `Map of ${config.name}`}
      aria-hidden={compact || undefined}
      className={`overflow-hidden ${className}`}
      style={style}
    >
      <svg ref={compact ? undefined : sizeRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="block size-full">
        <defs>
          <pattern id={gridId} width={GRID_METERS} height={GRID_METERS} patternUnits="userSpaceOnUse">
            <path d={`M${GRID_METERS} 0H0V${GRID_METERS}`} fill="none" stroke="var(--map-grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </pattern>
        </defs>

        {/* Drawn far past the viewBox so letterboxed space still looks like the same ground. */}
        <rect x={-1000} y={-1000} width={2200} height={2200} fill="var(--map-ground)" />
        {!compact && <rect x={-1000} y={-1000} width={2200} height={2200} fill={`url(#${gridId})`} />}

        {stats.map((s) => {
          const isVisible = visible.includes(s);
          const isHighlight = s.key === highlightKey;
          const select = onSelect && (() => onSelect(s.key));
          return (
            <path
              key={s.key}
              d={polygonPath(s.region.boundary)}
              stroke="var(--map-line)"
              strokeWidth={isHighlight ? 3 : 1.5}
              strokeLinejoin="round"
              strokeOpacity={isVisible ? (compact && !isHighlight ? 0.5 : 0.95) : 0.2}
              vectorEffect="non-scaling-stroke"
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={interactive ? `${s.name}${hideChance ? "" : s.chance === null ? ", no live data" : `, ${Math.round(s.chance * 100)}% estimated free`}. Zoom in` : undefined}
              // A style, not an attribute: the colour eases from one measurement to the next.
              style={{ cursor: interactive ? "pointer" : undefined, fill: hideChance ? "var(--surface)" : chanceColor(s.chance), fillOpacity: isVisible ? 1 : 0.25, transition: "fill 700ms ease" }}
              onClick={interactive ? select : undefined}
              onKeyDown={
                interactive
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        select?.();
                      }
                    }
                  : undefined
              }
            />
          );
        })}

        {!compact &&
          visible.map((s) => {
            const text = hideChance ? s.key : `${s.key === highlightKey ? "★ " : ""}${s.key} · ${s.chance === null ? "?" : `${Math.round(s.chance * 100)}%`}`;
            const w = text.length * fontSize * 0.6 + fontSize * 1.3;
            const h = fontSize * 1.8;
            return (
              <g key={s.key} pointerEvents="none" aria-hidden="true">
                <rect x={s.center.x - w / 2} y={s.center.y - h / 2} width={w} height={h} rx={h / 2} fill="var(--primary)" />
                <text
                  x={s.center.x}
                  y={s.center.y + fontSize * 0.36}
                  textAnchor="middle"
                  fontSize={fontSize}
                  fontWeight={650}
                  fill="var(--primary-fg)"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {text}
                </text>
              </g>
            );
          })}

        {!compact && !focusKey && vb.w > SCALE_METERS * 1.3 && (
          <g aria-hidden="true" pointerEvents="none">
            <path
              d={`M${vb.x + fontSize} ${vb.y + vb.h - fontSize * 1.4}v${fontSize * 0.45}h${SCALE_METERS}v${-fontSize * 0.45}`}
              fill="none"
              stroke="var(--muted)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
            <text x={vb.x + fontSize * 1.5 + SCALE_METERS} y={vb.y + vb.h - fontSize * 0.95} fontSize={fontSize * 0.85} fill="var(--muted)">
              {SCALE_METERS} m
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
