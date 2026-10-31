"use client";

import { useRef } from "react";
import { UndoIcon } from "@/components/ui/Icons";
import { boxOf, polygonPath } from "@/lib/geometry";
import type { ParkingLotConfig, Point } from "@/lib/types";

const SNAP = 0.5;
const GRID = 5;

interface Props {
  parking: ParkingLotConfig;
  points: Point[];
  onChange: (points: Point[]) => void;
}

/** Tap to place corners on the parking plan, in metres, snapped to the heatmap's 0.5 m grid. */
export function PolygonEditor({ parking, points, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const existing = parking.geometry.regions.map((r) => r.boundary);
  const box = boxOf(existing.flat());
  // Leaves room around the plan so a new zone can extend beyond it.
  const margin = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.2;
  const vb = {
    x: box.minX - margin,
    y: box.minY - margin,
    w: box.maxX - box.minX + 2 * margin,
    h: box.maxY - box.minY + 2 * margin,
  };
  const scale = Math.max(vb.w, vb.h);

  const addPoint = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM()?.inverse();
    if (!svg || !matrix) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix);
    onChange([...points, { x: Math.round(p.x / SNAP) * SNAP, y: Math.round(p.y / SNAP) * SNAP }]);
  };

  return (
    <div className="flex flex-col gap-2">
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        role="img"
        aria-label={`Plan of ${parking.name}. Tap to place the corners of the new zone. ${points.length} placed.`}
        onPointerDown={addPoint}
        className="block max-h-[38dvh] w-full cursor-crosshair touch-none rounded-2xl bg-[var(--map-ground)]"
      >
        <defs>
          <pattern id="editor-grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
            <path d={`M${GRID} 0H0V${GRID}`} fill="none" stroke="var(--map-grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </pattern>
        </defs>
        <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#editor-grid)" />
        {existing.map((b, i) => (
          <path key={i} d={polygonPath(b)} fill="var(--surface)" fillOpacity={0.7} stroke="var(--muted)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ))}
        {points.length >= 3 && <path d={polygonPath(points)} fill="var(--chance-good)" fillOpacity={0.35} />}
        {points.length >= 2 && (
          <polyline
            points={points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="var(--text)"
            strokeWidth={2.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={scale / 90} fill="var(--text)" stroke="var(--surface)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="flex items-center justify-between gap-2 text-sm text-muted">
        <span aria-live="polite">{points.length < 3 ? `Tap ${3 - points.length} more corner${points.length === 2 ? "" : "s"} on the plan` : `${points.length} corners`}</span>
        <button
          type="button"
          disabled={points.length === 0}
          onClick={() => onChange(points.slice(0, -1))}
          className="tap flex min-h-11 items-center gap-1.5 rounded-full bg-surface-2 px-4 font-semibold text-text disabled:opacity-40"
        >
          <UndoIcon size={18} />
          Undo
        </button>
      </div>
    </div>
  );
}
