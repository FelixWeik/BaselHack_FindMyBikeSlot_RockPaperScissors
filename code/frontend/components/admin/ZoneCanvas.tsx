"use client";

import { useEffect, useRef, useState } from "react";
import { type AdminParking, type AdminRegion, GRID, planBox, snapGrid } from "@/lib/adminModel";
import { polygonPath } from "@/lib/geometry";
import type { Point } from "@/lib/types";

const SNAP_DISTANCE = 0.45;
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 6;
const ARROWS: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };

type ViewBox = { x: number; y: number; w: number; h: number };
type DragState =
  | { kind: "point"; regionId: string; pointIndex: number; original: Point[] }
  | { kind: "region"; regionId: string; start: Point; original: Point[] }
  | { kind: "viewport"; start: Point; original: ViewBox; toWorld: DOMMatrix };
/** What the dragged shape looks like right now. It is committed on release, not on every move. */
type Preview = { regionId: string; boundary: Point[] } | null;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function snapPoint(point: Point, parking: AdminParking, ignoreRegionId: string) {
  let best: Point | null = null;
  let bestDistance = SNAP_DISTANCE;

  for (const region of parking.geometry.regions) {
    if (region.id === ignoreRegionId) continue;
    for (const candidate of region.boundary) {
      const d = distance(point, candidate);
      if (d < bestDistance) {
        bestDistance = d;
        best = candidate;
      }
    }
  }

  return best ?? { x: snapGrid(point.x), y: snapGrid(point.y) };
}

function fitViewBox(parking: AdminParking): ViewBox {
  if (parking.geometry.regions.length === 0) return { x: 0, y: 0, w: 30, h: 20 };
  const box = planBox(parking);
  const margin = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.18 || 4;
  return { x: box.minX - margin, y: box.minY - margin, w: box.maxX - box.minX + margin * 2, h: box.maxY - box.minY + margin * 2 };
}

/** Goes through the rendered transform, so it stays right when the plan is letterboxed in its frame. */
const toWorld = (svg: SVGSVGElement) => svg.getScreenCTM()?.inverse() ?? new DOMMatrix();

function project(matrix: DOMMatrix, clientX: number, clientY: number): Point {
  const p = new DOMPoint(clientX, clientY).matrixTransform(matrix);
  return { x: p.x, y: p.y };
}

interface Props {
  parking: AdminParking;
  selectedRegionId: string | null;
  onSelectRegion: (id: string) => void;
  onMoveRegion: (regionId: string, boundary: Point[]) => void;
  /** Shown for context, but can't be selected or moved. */
  readOnlyRegionIds?: Set<string>;
}

/** Render with a `key` per parking: the initial framing is computed once. */
export function ZoneCanvas({ parking, selectedRegionId, onSelectRegion, onMoveRegion, readOnlyRegionIds }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [fit] = useState(() => fitViewBox(parking));
  const [viewBox, setViewBox] = useState<ViewBox>(fit);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [preview, setPreview] = useState<Preview>(null);
  const [hoveredPoint, setHoveredPoint] = useState<string | null>(null);

  const zoom = fit.w / viewBox.w;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const cursor = project(toWorld(svg), event.clientX, event.clientY);
      setViewBox((view) => {
        const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (fit.w / view.w) * (event.deltaY > 0 ? 0.9 : 1.1)));
        const w = fit.w / nextZoom;
        const h = fit.h / nextZoom;
        return { x: cursor.x - ((cursor.x - view.x) / view.w) * w, y: cursor.y - ((cursor.y - view.y) / view.h) * h, w, h };
      });
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [fit]);

  const world = (e: React.PointerEvent) => (svgRef.current ? project(toWorld(svgRef.current), e.clientX, e.clientY) : null);

  const startViewportDrag = (e: React.PointerEvent<SVGElement>) => {
    if (!svgRef.current) return;
    // Panning moves the transform itself, so the whole gesture is measured with the one it started with.
    const matrix = toWorld(svgRef.current);
    setDrag({ kind: "viewport", start: project(matrix, e.clientX, e.clientY), original: viewBox, toWorld: matrix });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const startRegionDrag = (region: AdminRegion, e: React.PointerEvent<SVGGElement>) => {
    if (e.ctrlKey || e.detail >= 2) {
      startViewportDrag(e);
      return;
    }
    if (readOnlyRegionIds?.has(region.id)) return;
    onSelectRegion(region.id);
    const start = world(e);
    if (!start) return;
    setDrag({ kind: "region", regionId: region.id, start, original: region.boundary });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const startPointDrag = (region: AdminRegion, pointIndex: number, e: React.PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    onSelectRegion(region.id);
    setDrag({ kind: "point", regionId: region.id, pointIndex, original: region.boundary });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const nudgeRegion = (region: AdminRegion, e: React.KeyboardEvent) => {
    const arrow = ARROWS[e.key];
    if (!arrow) return;
    e.preventDefault();
    onMoveRegion(region.id, region.boundary.map((p) => ({ x: p.x + arrow.x * GRID, y: p.y + arrow.y * GRID })));
  };

  const moveDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    if (drag.kind === "viewport") {
      const point = project(drag.toWorld, e.clientX, e.clientY);
      setViewBox({ ...drag.original, x: drag.original.x - (point.x - drag.start.x), y: drag.original.y - (point.y - drag.start.y) });
      return;
    }
    const point = world(e);
    if (!point) return;
    if (drag.kind === "point") {
      const snapped = snapPoint(point, parking, drag.regionId);
      setPreview({ regionId: drag.regionId, boundary: drag.original.map((p, index) => (index === drag.pointIndex ? snapped : p)) });
    } else {
      const dx = snapGrid(point.x - drag.start.x);
      const dy = snapGrid(point.y - drag.start.y);
      setPreview({ regionId: drag.regionId, boundary: drag.original.map((p) => ({ x: snapGrid(p.x + dx), y: snapGrid(p.y + dy) })) });
    }
  };

  const endDrag = () => {
    if (preview) onMoveRegion(preview.regionId, preview.boundary);
    setPreview(null);
    setDrag(null);
  };

  const cancelDrag = () => {
    setPreview(null);
    setDrag(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-sm text-muted">
        <span>Drag a sub-zone or its corners. Ctrl + wheel zooms, Ctrl + drag pans.</span>
        <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        role="group"
        aria-label={`Plan of ${parking.name || "the new zone"}. Tab to a sub-zone and use the arrow keys to move it.`}
        className="h-full min-h-0 w-full flex-1 touch-none overflow-hidden rounded-[2rem] bg-[var(--map-ground)]"
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
      >
        <defs>
          <pattern id={`zone-grid-${parking.id}`} width={5} height={5} patternUnits="userSpaceOnUse">
            <path d="M5 0H0V5" fill="none" stroke="var(--map-grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </pattern>
        </defs>
        <rect
          x={viewBox.x - viewBox.w}
          y={viewBox.y - viewBox.h}
          width={viewBox.w * 3}
          height={viewBox.h * 3}
          fill={`url(#zone-grid-${parking.id})`}
          onPointerDown={(e) => {
            if (e.ctrlKey || e.detail >= 2) startViewportDrag(e);
          }}
        />

        {parking.geometry.regions.map((region) => {
          const selected = region.id === selectedRegionId;
          const locked = readOnlyRegionIds?.has(region.id) ?? false;
          const boundary = preview?.regionId === region.id ? preview.boundary : region.boundary;
          return (
            <g
              key={region.id}
              tabIndex={locked ? undefined : 0}
              aria-label={locked ? undefined : region.name ?? region.id}
              onFocus={() => {
                if (!locked) onSelectRegion(region.id);
              }}
              onKeyDown={(e) => {
                if (!locked) nudgeRegion(region, e);
              }}
              onPointerDown={(e) => startRegionDrag(region, e)}
              style={{ cursor: locked ? "default" : "move" }}
              opacity={locked ? 0.55 : 1}
            >
              <path
                d={polygonPath(boundary)}
                fill={selected ? "var(--chance-good)" : "var(--surface)"}
                fillOpacity={selected ? 0.35 : 0.72}
                stroke={selected ? "var(--text)" : "var(--muted)"}
                strokeWidth={selected ? 2.5 : 1.5}
                vectorEffect="non-scaling-stroke"
              />
              <text x={boundary[0]?.x ?? 0} y={(boundary[0]?.y ?? 0) - 0.3} fontSize={viewBox.w / 40} fill="var(--text)" style={{ pointerEvents: "none" }}>
                {region.name ?? region.id}
              </text>
              {selected &&
                !locked &&
                boundary.map((point, pointIndex) => {
                  const key = `${region.id}:${pointIndex}`;
                  const hovered = hoveredPoint === key;
                  const radius = viewBox.w / (hovered ? 70 : 100);
                  return (
                    <circle
                      key={key}
                      cx={point.x}
                      cy={point.y}
                      r={radius}
                      fill={hovered ? "var(--chance-good)" : "var(--text)"}
                      stroke="var(--surface)"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: "grab" }}
                      onPointerDown={(e) => startPointDrag(region, pointIndex, e)}
                      onPointerEnter={() => setHoveredPoint(key)}
                      onPointerLeave={() => setHoveredPoint((current) => (current === key ? null : current))}
                    />
                  );
                })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
