"use client";

import { useEffect, useRef, useState } from "react";
import { TrashIcon, UndoIcon } from "@/components/ui/Icons";
import { Card, SectionTitle } from "@/components/ui/primitives";
import type { AdminParking } from "@/lib/adminModel";
import type { DraftSubZone, DraftTarget } from "@/lib/calibration";
import type { Point } from "@/lib/types";
import { NumberField } from "../NumberField";
import { StepNav } from "./StepNav";

const NEW = "__new__";
const CORNERS = 4;
const NUDGE = 0.01;
const COLORS = ["#e5484d", "#3e63dd", "#12a150", "#d97706", "#8e4ec6", "#0e9aa7"];
const ARROWS: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

type Drag = { kind: "corner"; id: string; index: number } | { kind: "shape"; id: string; start: Point; original: Point[] };

interface Props {
  cameraName: string;
  cameraId: string;
  image: string | null;
  capturing: boolean;
  captureError: string | null;
  onRecapture: () => void;
  target: AdminParking;
  draftTarget: DraftTarget;
  parkings: AdminParking[];
  /** A recalibrated camera stays in its zone. */
  locked: boolean;
  onTarget: (target: DraftTarget) => void;
  subZones: DraftSubZone[];
  onChange: (subZones: DraftSubZone[]) => void;
  issues: string[];
  onBack: () => void;
  onNext: () => void;
}

export function DrawStep({ cameraName, cameraId, image, capturing, captureError, onRecapture, target, draftTarget, parkings, locked, onTarget, subZones, onChange, issues, onBack, onNext }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [aspect, setAspect] = useState(4 / 3);
  const [drawing, setDrawing] = useState<Point[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(subZones[0]?.id ?? null);
  const [drag, setDrag] = useState<Drag | null>(null);

  useEffect(() => {
    if (drawing.length === 0) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawing([]);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [drawing.length]);

  const patch = (id: string, change: Partial<DraftSubZone>) => onChange(subZones.map((zone) => (zone.id === id ? { ...zone, ...change } : zone)));

  /** Normalized image coordinates under the pointer. */
  const toImage = (e: React.PointerEvent): Point | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect ? { x: clamp01((e.clientX - rect.left) / rect.width), y: clamp01((e.clientY - rect.top) / rect.height) } : null;
  };

  const finishShape = (imagePolygon: Point[]) => {
    setDrawing([]);
    // A sub-zone waiting for its shape gets it (the selected one first); otherwise this is a new one.
    const waiting = subZones.find((zone) => zone.id === selectedId && zone.imagePolygon.length === 0) ?? subZones.find((zone) => zone.imagePolygon.length === 0);
    if (waiting) {
      patch(waiting.id, { imagePolygon });
      setSelectedId(waiting.id);
      return;
    }
    const fresh = newZoneFields();
    onChange([...subZones, { ...fresh, imagePolygon }]);
    setSelectedId(fresh.id);
  };

  /** A sub-zone of its own, not yet on the plan. */
  const newZoneFields = () => {
    const taken = new Set(subZones.map((zone) => zone.id));
    let n = subZones.length + 1;
    while (taken.has(`${cameraId}-${n}`)) n++;
    return { id: `${cameraId}-${n}`, name: `Aisle ${n}`, capacity: 0, boundary: [], existing: false };
  };

  /** One polygon is either a new physical sub-zone or another view of one the parking already has. */
  const linkZone = (zone: DraftSubZone, value: string) => {
    const region = target.geometry.regions.find((r) => r.id === value);
    const fields = region ? { id: region.id, name: region.name ?? region.id, capacity: region.slotCount, boundary: region.boundary, existing: true } : newZoneFields();
    patch(zone.id, fields);
    setSelectedId(fields.id);
  };

  const addCorner = (e: React.PointerEvent) => {
    const point = toImage(e);
    if (!point) return;
    const next = [...drawing, point];
    if (next.length === CORNERS) finishShape(next);
    else setDrawing(next);
  };

  const startShape = (zone: DraftSubZone, e: React.PointerEvent<SVGPolygonElement>) => {
    const start = toImage(e);
    if (!start) return;
    setSelectedId(zone.id);
    setDrag({ kind: "shape", id: zone.id, start, original: zone.imagePolygon });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const startCorner = (zone: DraftSubZone, index: number, e: React.PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    setSelectedId(zone.id);
    setDrag({ kind: "corner", id: zone.id, index });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveDrag = (e: React.PointerEvent) => {
    const point = drag && toImage(e);
    if (!drag || !point) return;
    if (drag.kind === "corner") {
      const zone = subZones.find((z) => z.id === drag.id);
      if (zone) patch(drag.id, { imagePolygon: zone.imagePolygon.map((p, i) => (i === drag.index ? point : p)) });
      return;
    }
    // The whole shape stops at the image's edge instead of being squashed against it.
    const xs = drag.original.map((p) => p.x);
    const ys = drag.original.map((p) => p.y);
    const dx = Math.min(1 - Math.max(...xs), Math.max(-Math.min(...xs), point.x - drag.start.x));
    const dy = Math.min(1 - Math.max(...ys), Math.max(-Math.min(...ys), point.y - drag.start.y));
    patch(drag.id, { imagePolygon: drag.original.map((p) => ({ x: p.x + dx, y: p.y + dy })) });
  };

  const nudge = (zone: DraftSubZone, index: number, e: React.KeyboardEvent) => {
    const arrow = ARROWS[e.key];
    if (!arrow) return;
    e.preventDefault();
    const step = e.shiftKey ? NUDGE * 5 : NUDGE;
    patch(zone.id, { imagePolygon: zone.imagePolygon.map((p, i) => (i === index ? { x: clamp01(p.x + arrow.x * step), y: clamp01(p.y + arrow.y * step) } : p)) });
  };

  const hint =
    drawing.length > 0
      ? `Corner ${drawing.length + 1} of ${CORNERS}. Esc cancels.`
      : `Tap the ${CORNERS} corners of a parking area, in order, to draw a sub-zone. Drag a shape or its corners to adjust it.`;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
      <div className="grid min-w-0 gap-2">
        {image ? (
          <div className="relative mx-auto w-full overflow-hidden rounded-3xl bg-surface-2" style={{ aspectRatio: aspect, maxWidth: `calc(65dvh * ${aspect})` }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local photo or a device snapshot, nothing for the image optimizer to do */}
            <img
              src={image}
              alt={`View of ${cameraName}`}
              draggable={false}
              className="absolute inset-0 size-full select-none object-fill"
              onLoad={(e) => {
                const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
                if (w > 0 && h > 0) setAspect(w / h);
              }}
            />
            <svg
              ref={svgRef}
              viewBox={`0 0 ${aspect} 1`}
              aria-label={`Sub-zones on the view of ${cameraName}`}
              className="absolute inset-0 size-full cursor-crosshair touch-none"
              onPointerMove={moveDrag}
              onPointerUp={() => setDrag(null)}
              onPointerCancel={() => setDrag(null)}
            >
              <rect width={aspect} height={1} fill="transparent" onPointerDown={addCorner} />
              {subZones.map((zone, index) => {
                if (zone.imagePolygon.length === 0) return null;
                const color = COLORS[index % COLORS.length];
                const selected = zone.id === selectedId;
                const first = zone.imagePolygon[0];
                return (
                  // While a shape is being drawn, taps on other shapes place corners too.
                  <g key={zone.id} style={{ pointerEvents: drawing.length > 0 ? "none" : undefined }}>
                    <polygon
                      points={zone.imagePolygon.map((p) => `${p.x * aspect},${p.y}`).join(" ")}
                      fill={color}
                      fillOpacity={selected ? 0.35 : 0.2}
                      stroke={color}
                      strokeWidth={selected ? 3 : 2}
                      vectorEffect="non-scaling-stroke"
                      className="cursor-move"
                      onPointerDown={(e) => startShape(zone, e)}
                    />
                    <text x={first.x * aspect} y={first.y - 0.015} fontSize={0.04} fontWeight={700} fill={color} stroke="white" strokeWidth={0.008} paintOrder="stroke" style={{ pointerEvents: "none" }}>
                      {zone.name}
                    </text>
                    {selected &&
                      zone.imagePolygon.map((p, i) => (
                        <circle
                          key={i}
                          cx={p.x * aspect}
                          cy={p.y}
                          r={0.018}
                          fill="white"
                          stroke={color}
                          strokeWidth={2.5}
                          vectorEffect="non-scaling-stroke"
                          tabIndex={0}
                          role="slider"
                          aria-label={`Corner ${i + 1} of ${zone.name}`}
                          aria-valuetext={`${Math.round(p.x * 100)}% across, ${Math.round(p.y * 100)}% down`}
                          aria-valuenow={Math.round(p.x * 100)}
                          className="cursor-grab"
                          onPointerDown={(e) => startCorner(zone, i, e)}
                          onKeyDown={(e) => nudge(zone, i, e)}
                        />
                      ))}
                  </g>
                );
              })}
              {drawing.length > 0 && (
                <g style={{ pointerEvents: "none" }}>
                  <polyline points={drawing.map((p) => `${p.x * aspect},${p.y}`).join(" ")} fill="none" stroke="white" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
                  {drawing.map((p, i) => (
                    <circle key={i} cx={p.x * aspect} cy={p.y} r={0.014} fill="white" stroke="black" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  ))}
                </g>
              )}
            </svg>
          </div>
        ) : (
          <Card className="grid min-h-64 place-content-center gap-2 p-6 text-center">
            {capturing ? (
              <>
                <p className="font-medium">Asking {cameraName} for a view…</p>
                <p className="text-sm text-muted">Faces are masked before the view reaches this page.</p>
              </>
            ) : (
              <>
                <p className="font-medium">{cameraName} couldn&apos;t give a view.</p>
                <p role="alert" className="text-sm text-muted">
                  {captureError ?? "The capture failed."}
                </p>
              </>
            )}
          </Card>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="w-full min-w-0 text-sm text-muted sm:w-auto sm:flex-1">
            {image ? `${hint} This view stays in this tab, only the shapes are saved.` : ""}
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={drawing.length === 0} onClick={() => setDrawing(drawing.slice(0, -1))} className="tap inline-flex min-h-11 items-center gap-1.5 rounded-full bg-surface-2 px-4 font-semibold disabled:opacity-40">
              <UndoIcon size={18} />
              Undo
            </button>
            <button type="button" disabled={capturing} onClick={onRecapture} className="tap inline-flex min-h-11 items-center rounded-full bg-surface-2 px-4 font-semibold disabled:opacity-40">
              New capture
            </button>
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-4">
        <Card className="grid gap-3 p-4">
          <SectionTitle>Zone</SectionTitle>
          {locked ? (
            <p>{target.name}</p>
          ) : (
            <label className="grid gap-2 text-sm">
              <span className="text-muted">This camera watches</span>
              <select
                className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3"
                value={draftTarget.kind === "existing" ? draftTarget.parkingId : NEW}
                onChange={(e) => onTarget(e.target.value === NEW ? { kind: "new", name: "" } : { kind: "existing", parkingId: e.target.value })}
              >
                {parkings.map((parking) => (
                  <option key={parking.id} value={parking.id}>
                    {parking.name}
                  </option>
                ))}
                <option value={NEW}>A new zone</option>
              </select>
            </label>
          )}
          {draftTarget.kind === "new" && (
            <label className="grid gap-2 text-sm">
              <span className="text-muted">Name of the new zone</span>
              <input className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" placeholder="Parking 1" value={draftTarget.name} onChange={(e) => onTarget({ kind: "new", name: e.target.value })} />
            </label>
          )}
        </Card>

        <Card className="grid gap-3 p-4">
          <SectionTitle>Sub-zones</SectionTitle>
          {subZones.length === 0 && <p className="text-sm text-muted">Nothing drawn yet.</p>}
          {subZones.map((zone, index) => (
            <div key={zone.id} className={`grid gap-2 rounded-2xl p-3 ${zone.id === selectedId ? "bg-primary/15 ring-2 ring-primary" : "bg-surface-2"}`} onPointerDown={() => setSelectedId(zone.id)}>
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ background: COLORS[index % COLORS.length] }} />
                <input aria-label="Sub-zone name" className="min-h-11 w-full min-w-0 rounded-2xl bg-surface px-3" value={zone.name} onChange={(e) => patch(zone.id, { name: e.target.value })} />
                <button
                  type="button"
                  aria-label={`Delete ${zone.name}`}
                  onClick={() => onChange(subZones.filter((z) => z.id !== zone.id))}
                  className="tap grid size-10 shrink-0 place-items-center rounded-full bg-surface text-muted"
                >
                  <TrashIcon size={18} />
                </button>
              </div>
              {target.geometry.regions.length > 0 && (
                <label className="grid gap-2 text-sm">
                  <span className="text-muted">Sub-zone on the plan</span>
                  <select className="min-h-11 w-full min-w-0 rounded-2xl bg-surface px-3" value={zone.existing ? zone.id : NEW} onChange={(e) => linkZone(zone, e.target.value)}>
                    <option value={NEW}>A new sub-zone</option>
                    {target.geometry.regions
                      .filter((region) => region.id === zone.id || !subZones.some((other) => other.id === region.id))
                      .map((region) => (
                        <option key={region.id} value={region.id}>
                          {region.name ?? region.id} · {region.slotCount} slots
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <NumberField key={zone.id} label={zone.existing ? "Capacity, shared with every camera watching it" : "Capacity (bikes)"} min={1} integer value={zone.capacity} onCommit={(capacity) => patch(zone.id, { capacity })} />
              {zone.imagePolygon.length === 0 && <p className="text-sm text-muted">Tap its {CORNERS} corners on the view.</p>}
            </div>
          ))}
        </Card>
        <StepNav issues={issues} onBack={onBack} onNext={onNext} />
      </div>
    </div>
  );
}
