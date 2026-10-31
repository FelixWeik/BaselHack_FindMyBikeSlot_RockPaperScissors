"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DownloadIcon, PencilIcon, PlusIcon, TrashIcon } from "@/components/ui/Icons";
import { Card, SectionTitle } from "@/components/ui/primitives";
import { boxOf, polygonPath, regionKey } from "@/lib/geometry";
import { Sheet } from "@/components/ui/Sheet";
import { useStoredJSON, writeStored } from "@/lib/storage";
import type { ParkingAdminDocument, ParkingCamera, ParkingLotConfig, ParkingRegion, Point, Weekday } from "@/lib/types";

const KEY = "fmbs.admin.setup";
const DAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const GRID = 0.5;
const SNAP_DISTANCE = 0.45;
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 6;
const TIMEZONES = ["Europe/Zurich", "UTC", "Europe/Berlin", "Europe/Paris", "Europe/London", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Singapore", "Asia/Tokyo"] as const;

type Props = { parkings: ParkingLotConfig[] };

type ViewBox = { x: number; y: number; w: number; h: number };
type DragState =
  | { kind: "point"; regionId: string; pointIndex: number; pointerId: number; original: Point[]; start: Point }
  | { kind: "region"; regionId: string; pointerId: number; original: Point[]; start: Point }
  | { kind: "camera"; cameraId: string; cameraIndex: number; pointerId: number; original: Point; start: Point }
  | { kind: "viewport"; pointerId: number; original: ViewBox; start: Point };

function regionId(region: ParkingRegion, index: number) {
  return region.id ?? regionKey(region, index);
}

function cloneParking(parking: ParkingLotConfig): ParkingLotConfig {
  return {
    ...parking,
    geometry: {
      regions: parking.geometry.regions.map((region) => ({
        ...region,
        boundary: region.boundary.map((p) => ({ ...p })),
        cameraIds: [...(region.cameraIds ?? [])],
      })),
    },
    cameras: parking.cameras.map((camera) => ({ ...camera, position: { ...camera.position } })),
    schedule: {
      timezone: parking.schedule.timezone,
      weekly: Object.fromEntries(DAYS.map((day) => [day, parking.schedule.weekly[day].map((window) => ({ ...window }))])) as ParkingLotConfig["schedule"]["weekly"],
    },
  };
}

function seedDocument(parkings: ParkingLotConfig[]): ParkingAdminDocument {
  return { version: 1, parkings: parkings.map(cloneParking) };
}

function saveDoc(doc: ParkingAdminDocument) {
  writeStored(KEY, JSON.stringify(doc));
}

function updateParking(doc: ParkingAdminDocument, parkingId: string, mutate: (parking: ParkingLotConfig) => ParkingLotConfig): ParkingAdminDocument {
  return {
    ...doc,
    parkings: doc.parkings.map((parking) => (parking.id === parkingId ? mutate(cloneParking(parking)) : parking)),
  };
}

function snapGrid(value: number) {
  return Math.round(value / GRID) * GRID;
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function snapPoint(point: Point, parking: ParkingLotConfig, ignore?: { regionId: string; pointIndex: number }) {
  let best: Point | null = null;
  let bestDistance = SNAP_DISTANCE;

  for (const [regionIndex, region] of parking.geometry.regions.entries()) {
    const id = regionId(region, regionIndex);
    if (ignore && id === ignore.regionId) continue;
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

function defaultRegion(parking: ParkingLotConfig): ParkingRegion {
  const box = boxOf(parking.geometry.regions.flatMap((region) => region.boundary).concat(parking.cameras.map((camera) => camera.position)));
  const w = Math.max(4, Math.min(10, box.maxX - box.minX || 8));
  const h = Math.max(3, Math.min(7, box.maxY - box.minY || 5));
  const cx = (box.minX + box.maxX) / 2 || 10;
  const cy = (box.minY + box.maxY) / 2 || 10;
  return {
    id: `zone-${parking.geometry.regions.length + 1}`,
    name: `Zone ${parking.geometry.regions.length + 1}`,
    slotCount: 0,
    cameraIds: [],
    boundary: [
      { x: snapGrid(cx - w / 2), y: snapGrid(cy - h / 2) },
      { x: snapGrid(cx + w / 2), y: snapGrid(cy - h / 2) },
      { x: snapGrid(cx + w / 2), y: snapGrid(cy + h / 2) },
      { x: snapGrid(cx - w / 2), y: snapGrid(cy + h / 2) },
    ],
  };
}

function emptyCamera(parking: ParkingLotConfig): ParkingCamera {
  const box = boxOf(parking.geometry.regions.flatMap((region) => region.boundary).concat(parking.cameras.map((camera) => camera.position)));
  return {
    id: `cam-${parking.id}-${parking.cameras.length + 1}`,
    name: `Camera ${parking.cameras.length + 1}`,
    position: { x: snapGrid((box.minX + box.maxX) / 2 || 10), y: snapGrid((box.minY + box.maxY) / 2 || 10) },
    headingDeg: 315,
    rangeMeters: 18,
  };
}

function parseCSV(value: string) {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function fitViewBox(parking: ParkingLotConfig): ViewBox {
  const points = [
    ...parking.geometry.regions.flatMap((region) => region.boundary),
    ...parking.cameras.map((camera) => camera.position),
  ];
  const box = boxOf(points);
  const margin = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.18 || 4;
  return { x: box.minX - margin, y: box.minY - margin, w: box.maxX - box.minX + margin * 2, h: box.maxY - box.minY + margin * 2 };
}

function screenToWorld(svg: SVGSVGElement, viewBox: ViewBox, clientX: number, clientY: number): Point {
  const rect = svg.getBoundingClientRect();
  return {
    x: viewBox.x + ((clientX - rect.left) / rect.width) * viewBox.w,
    y: viewBox.y + ((clientY - rect.top) / rect.height) * viewBox.h,
  };
}

function ZoneCanvas({
  parking,
  selectedRegionId,
  onSelectRegion,
  onUpdateRegion,
  onUpdateCamera,
  onOpenCameraInfo,
}: {
  parking: ParkingLotConfig;
  selectedRegionId: string | null;
  onSelectRegion: (id: string) => void;
  onUpdateRegion: (regionId: string, boundary: Point[]) => void;
  onUpdateCamera: (cameraId: string, position: Point) => void;
  onOpenCameraInfo: (cameraId: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewBox, setViewBox] = useState<ViewBox>(() => fitViewBox(parking));
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<string | null>(null);

  useEffect(() => {
    setViewBox(fitViewBox(parking));
    setDrag(null);
    setHoveredPoint(null);
  }, [parking.id]);

  const selectedRegion = parking.geometry.regions.find((region, index) => regionId(region, index) === selectedRegionId) ?? null;
  const zoom = fitViewBox(parking).w / viewBox.w;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const cursor = screenToWorld(svg, viewBox, event.clientX, event.clientY);
      const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
      const nextW = fitViewBox(parking).w / nextZoom;
      const nextH = fitViewBox(parking).h / nextZoom;
      const ux = (event.clientX - rect.left) / rect.width;
      const uy = (event.clientY - rect.top) / rect.height;
      setViewBox({ x: cursor.x - ux * nextW, y: cursor.y - uy * nextH, w: nextW, h: nextH });
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [parking, viewBox, zoom]);

  const startViewportDrag = (e: React.PointerEvent<SVGElement>, original = viewBox) => {
    if (!svgRef.current) return;
    const world = screenToWorld(svgRef.current, viewBox, e.clientX, e.clientY);
    setDrag({ kind: "viewport", pointerId: e.pointerId, original, start: world });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const startRegionDrag = (region: ParkingRegion, index: number, e: React.PointerEvent<SVGGElement>) => {
    if (!svgRef.current) return;
    const id = regionId(region, index);
    onSelectRegion(id);
    if (e.ctrlKey || e.detail >= 2) {
      startViewportDrag(e);
      return;
    }
    const world = screenToWorld(svgRef.current, viewBox, e.clientX, e.clientY);
    setDrag({ kind: "region", regionId: id, pointerId: e.pointerId, original: region.boundary.map((p) => ({ ...p })), start: world });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const startPointDrag = (region: ParkingRegion, regionIndex: number, pointIndex: number, e: React.PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    if (!svgRef.current) return;
    const id = regionId(region, regionIndex);
    const world = screenToWorld(svgRef.current, viewBox, e.clientX, e.clientY);
    onSelectRegion(id);
    setDrag({ kind: "point", regionId: id, pointIndex, pointerId: e.pointerId, original: region.boundary.map((p) => ({ ...p })), start: world });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const startCameraDrag = (cameraId: string, cameraIndex: number, e: React.PointerEvent<SVGGElement>) => {
    if (!svgRef.current) return;
    if (e.ctrlKey || e.detail >= 2) {
      startViewportDrag(e);
      return;
    }
    const world = screenToWorld(svgRef.current, viewBox, e.clientX, e.clientY);
    setDrag({ kind: "camera", cameraId, cameraIndex, pointerId: e.pointerId, original: { ...parking.cameras[cameraIndex].position }, start: world });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const moveDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag || !svgRef.current) return;
    const world = screenToWorld(svgRef.current, viewBox, e.clientX, e.clientY);
    if (drag.kind === "point") {
      const next = drag.original.map((point, index) => (index === drag.pointIndex ? snapPoint(world, parking, { regionId: drag.regionId, pointIndex: drag.pointIndex }) : point));
      onUpdateRegion(drag.regionId, next);
      return;
    }
    if (drag.kind === "camera") {
      onUpdateCamera(drag.cameraId, snapPoint(world, parking));
      return;
    }
    if (drag.kind === "viewport") {
      const dx = world.x - drag.start.x;
      const dy = world.y - drag.start.y;
      setViewBox({ x: snapGrid(drag.original.x - dx), y: snapGrid(drag.original.y - dy), w: drag.original.w, h: drag.original.h });
      return;
    }
    const dx = snapGrid(world.x - drag.start.x);
    const dy = snapGrid(world.y - drag.start.y);
    onUpdateRegion(
      drag.regionId,
      drag.original.map((point) => ({ x: snapGrid(point.x + dx), y: snapGrid(point.y + dy) })),
    );
  };

  const endDrag = () => setDrag(null);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between text-sm text-muted">
        <span>Ctrl + wheel zooms. Drag a zone or its points.</span>
        <span>{Math.round(zoom * 100)}%</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className="h-full min-h-0 w-full flex-1 overflow-hidden rounded-[2rem] bg-[var(--map-ground)]"
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <defs>
          <pattern id={`zone-grid-${parking.id}`} width={5} height={5} patternUnits="userSpaceOnUse">
            <path d="M5 0H0V5" fill="none" stroke="var(--map-grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </pattern>
        </defs>
        <rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} fill={`url(#zone-grid-${parking.id})`} onPointerDown={(e) => { if (e.ctrlKey || e.detail >= 2) startViewportDrag(e as unknown as React.PointerEvent<SVGElement>); }} />

        {parking.geometry.regions.map((region, index) => {
          const id = regionId(region, index);
          const selected = id === selectedRegionId;
          return (
            <g
              key={id}
              onPointerDown={(e) => startRegionDrag(region, index, e)}
              onDoubleClick={() => onSelectRegion(id)}
              style={{ cursor: "move" }}
            >
              <path
                d={polygonPath(region.boundary)}
                fill={selected ? "var(--chance-good)" : "var(--surface)"}
                fillOpacity={selected ? 0.35 : 0.72}
                stroke={selected ? "var(--text)" : "var(--muted)"}
                strokeWidth={selected ? 2.5 : 1.5}
                vectorEffect="non-scaling-stroke"
              />
              <text x={region.boundary[0]?.x ?? 0} y={(region.boundary[0]?.y ?? 0) - 0.6} fontSize={1.1} fill="var(--text)">
                {region.name ?? `Zone ${id}`}
              </text>
              {selected &&
                region.boundary.map((point, pointIndex) => {
                  const key = `${id}:${pointIndex}`;
                  const hovered = hoveredPoint === key;
                  return (
                    <circle
                      key={key}
                      cx={point.x}
                      cy={point.y}
                      r={hovered ? 0.45 : 0.3}
                      fill={hovered ? "var(--chance-good)" : "var(--text)"}
                      stroke="var(--surface)"
                      strokeWidth={0.18}
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: "grab" }}
                      onPointerDown={(e) => startPointDrag(region, index, pointIndex, e)}
                      onPointerEnter={() => setHoveredPoint(key)}
                      onPointerLeave={() => setHoveredPoint((current) => (current === key ? null : current))}
                    />
                  );
                })}
            </g>
          );
        })}

        {parking.cameras.map((camera, index) => (
          <g key={camera.id} onPointerDown={(e) => startCameraDrag(camera.id, index, e)} onContextMenu={(e) => { e.preventDefault(); onOpenCameraInfo(camera.id); }} style={{ cursor: "move" }}>
            <circle cx={camera.position.x} cy={camera.position.y} r={0.38} fill="var(--chance-good)" stroke="var(--surface)" strokeWidth={0.15} vectorEffect="non-scaling-stroke" />
            <text
              x={camera.position.x + 0.55}
              y={camera.position.y - 0.55}
              fontSize={0.95}
              fill="var(--text)"
              style={{ paintOrder: "stroke", stroke: "var(--surface)", strokeWidth: 0.2, pointerEvents: "none" }}
            >
              {camera.name}
            </text>
          </g>
        ))}

        {!selectedRegion && <text x={viewBox.x + 1} y={viewBox.y + 1.4} fontSize={1.1} fill="var(--muted)">Select a zone to edit it.</text>}
      </svg>
    </div>
  );
}

function ZoneInspector({
  parking,
  selectedRegionId,
  onSelectRegion,
  onUpdateParking,
  onAddZone,
  onDeleteRegion,
  onAddCamera,
  onDeleteCamera,
  onOpenZoneInfo,
  onOpenCameraInfo,
}: {
  parking: ParkingLotConfig;
  selectedRegionId: string | null;
  onSelectRegion: (id: string) => void;
  onUpdateParking: (mutate: (parking: ParkingLotConfig) => ParkingLotConfig) => void;
  onAddZone: () => void;
  onDeleteRegion: (id: string) => void;
  onAddCamera: () => void;
  onDeleteCamera: (id: string) => void;
  onOpenZoneInfo: (id: string) => void;
  onOpenCameraInfo: (id: string) => void;
}) {
  const selectedRegion = parking.geometry.regions.find((region, index) => regionId(region, index) === selectedRegionId) ?? null;
  const selectedIndex = selectedRegion ? parking.geometry.regions.findIndex((region, index) => regionId(region, index) === selectedRegionId) : -1;

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto overflow-x-hidden pr-1">
      <Card className="grid gap-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle>{parking.name}</SectionTitle>
          <button type="button" onClick={onAddZone} className="tap inline-flex min-h-11 items-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-semibold">
            <PlusIcon size={18} />
            New zone
          </button>
        </div>
        <label className="grid gap-2 text-sm">
          <span className="text-muted">Parking name</span>
          <input className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" value={parking.name} onChange={(e) => onUpdateParking((next) => ({ ...next, name: e.target.value }))} />
        </label>
        <label className="grid gap-2 text-sm">
          <span className="text-muted">Total slots</span>
          <input type="number" min={0} className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" value={parking.totalSlots} onChange={(e) => onUpdateParking((next) => ({ ...next, totalSlots: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-2 text-sm">
            <span className="text-muted">Slot width</span>
            <input type="number" min={0} step={0.1} className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" value={parking.slotSize.widthMeters} onChange={(e) => onUpdateParking((next) => ({ ...next, slotSize: { ...next.slotSize, widthMeters: Number(e.target.value) || 0 } }))} />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="text-muted">Slot length</span>
            <input type="number" min={0} step={0.1} className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" value={parking.slotSize.lengthMeters} onChange={(e) => onUpdateParking((next) => ({ ...next, slotSize: { ...next.slotSize, lengthMeters: Number(e.target.value) || 0 } }))} />
          </label>
        </div>
      </Card>

      <Card className="grid gap-3 p-4">
        <SectionTitle>Zones</SectionTitle>
        <div className="grid gap-2">
          {parking.geometry.regions.map((region, index) => {
            const id = regionId(region, index);
            const active = id === selectedRegionId;
            return (
              <div key={id} className={`flex items-center gap-2 rounded-2xl p-2 ${active ? "bg-primary/15 ring-2 ring-primary" : "bg-surface-2"}`} onDoubleClick={() => onSelectRegion(id)}>
                <button type="button" className="flex-1 text-left" onClick={() => onSelectRegion(id)}>
                  <div className="font-medium">{region.name ?? `Zone ${index + 1}`}</div>
                  <div className="text-xs text-muted">{id} · {region.slotCount ?? 0} slots</div>
                </button>
                <button type="button" onClick={() => { onSelectRegion(id); onOpenZoneInfo(id); }} className="tap grid size-10 place-items-center rounded-full bg-surface">
                  <PencilIcon size={18} />
                </button>
                <button type="button" onClick={() => onDeleteRegion(id)} className="tap grid size-10 place-items-center rounded-full bg-surface text-muted">
                  <TrashIcon size={18} />
                </button>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="grid gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <SectionTitle>Cameras</SectionTitle>
          <button type="button" onClick={onAddCamera} className="tap inline-flex min-h-11 items-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-semibold">
            <PlusIcon size={18} />
            Camera
          </button>
        </div>
        <div className="grid gap-2">
          {parking.cameras.map((camera, index) => (
            <div key={camera.id} className="grid min-w-0 gap-2 rounded-2xl bg-surface-2 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <button type="button" onClick={() => onOpenCameraInfo(camera.id)} className="tap grid size-10 shrink-0 place-items-center rounded-full bg-surface">
                  <PencilIcon size={18} />
                </button>
                <input className="min-h-11 min-w-0 flex-1 rounded-2xl bg-surface px-3" value={camera.name} onChange={(e) => onUpdateParking((next) => ({ ...next, cameras: next.cameras.map((item, i) => (i === index ? { ...item, name: e.target.value } : item)) }))} />
                <button type="button" onClick={() => onDeleteCamera(camera.id)} className="tap grid size-10 shrink-0 place-items-center rounded-full bg-surface text-muted">
                  <TrashIcon size={18} />
                </button>
              </div>
              <div className="grid min-w-0 grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <input className="min-h-11 w-full min-w-0 rounded-2xl bg-surface px-3" value={camera.position.x} onChange={(e) => onUpdateParking((next) => ({ ...next, cameras: next.cameras.map((item, i) => (i === index ? { ...item, position: { ...item.position, x: Number(e.target.value) || 0 } } : item)) }))} />
                <input className="min-h-11 w-full min-w-0 rounded-2xl bg-surface px-3" value={camera.position.y} onChange={(e) => onUpdateParking((next) => ({ ...next, cameras: next.cameras.map((item, i) => (i === index ? { ...item, position: { ...item.position, y: Number(e.target.value) || 0 } } : item)) }))} />
                <input className="min-h-11 w-full min-w-0 rounded-2xl bg-surface px-3" value={camera.headingDeg} onChange={(e) => onUpdateParking((next) => ({ ...next, cameras: next.cameras.map((item, i) => (i === index ? { ...item, headingDeg: Number(e.target.value) || 0 } : item)) }))} />
                <input className="min-h-11 w-full min-w-0 rounded-2xl bg-surface px-3" value={camera.rangeMeters} onChange={(e) => onUpdateParking((next) => ({ ...next, cameras: next.cameras.map((item, i) => (i === index ? { ...item, rangeMeters: Number(e.target.value) || 0 } : item)) }))} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="grid gap-3 p-4">
        <SectionTitle>Schedule</SectionTitle>
        <label className="grid gap-2 text-sm">
          <span className="text-muted">Timezone</span>
          <select className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" value={parking.schedule.timezone} onChange={(e) => onUpdateParking((next) => ({ ...next, schedule: { ...next.schedule, timezone: e.target.value } }))}>
            {Array.from(new Set([parking.schedule.timezone, ...TIMEZONES])).map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </label>
        <div className="grid gap-2">
          {DAYS.map((day) => {
            const slot = parking.schedule.weekly[day][0];
            const open = Boolean(slot);
            return (
              <div key={day} className="grid min-w-0 gap-2 rounded-2xl bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <strong className="capitalize">{day}</strong>
                  <label className="flex items-center gap-2 text-sm text-muted">
                    <input
                      type="checkbox"
                      checked={open}
                      onChange={(e) => onUpdateParking((next) => ({
                        ...next,
                        schedule: {
                          ...next.schedule,
                          weekly: {
                            ...next.schedule.weekly,
                            [day]: e.target.checked ? [{ start: slot?.start ?? "06:00", end: slot?.end ?? "20:00" }] : [],
                          },
                        },
                      }))}
                    />
                    Open
                  </label>
                </div>
                {open ? (
                  <div className="grid grid-cols-2 gap-2">
                    <input type="time" className="min-h-11 w-full min-w-0 rounded-2xl bg-surface px-3" value={slot?.start ?? "06:00"} onChange={(e) => onUpdateParking((next) => ({
                      ...next,
                      schedule: {
                        ...next.schedule,
                        weekly: {
                          ...next.schedule.weekly,
                          [day]: [{ start: e.target.value, end: slot?.end ?? "20:00" }],
                        },
                      },
                    }))} />
                    <input type="time" className="min-h-11 w-full min-w-0 rounded-2xl bg-surface px-3" value={slot?.end ?? "20:00"} onChange={(e) => onUpdateParking((next) => ({
                      ...next,
                      schedule: {
                        ...next.schedule,
                        weekly: {
                          ...next.schedule.weekly,
                          [day]: [{ start: slot?.start ?? "06:00", end: e.target.value }],
                        },
                      },
                    }))} />
                  </div>
                ) : (
                  <span className="text-sm text-muted">Closed</span>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

export function ZonesAdmin({ parkings }: Props) {
  const stored = useStoredJSON<ParkingAdminDocument>(KEY);
  const [doc, setDoc] = useState<ParkingAdminDocument>(() => seedDocument(parkings));
  const [selectedParkingId, setSelectedParkingId] = useState(parkings[0]?.id ?? "");
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [zonePopupId, setZonePopupId] = useState<string | null>(null);
  const [cameraPopupId, setCameraPopupId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded) return;
    setDoc(stored && stored.version === 1 ? stored : seedDocument(parkings));
    setLoaded(true);
  }, [stored, parkings, loaded]);

  useEffect(() => {
    if (!selectedParkingId && doc.parkings[0]) setSelectedParkingId(doc.parkings[0].id);
    if (selectedParkingId && !doc.parkings.some((parking) => parking.id === selectedParkingId) && doc.parkings[0]) setSelectedParkingId(doc.parkings[0].id);
  }, [doc.parkings, selectedParkingId]);

  useEffect(() => {
    if (doc.parkings.length === 0) return;
    const parking = doc.parkings.find((item) => item.id === selectedParkingId) ?? doc.parkings[0];
    const firstRegion = parking.geometry.regions[0];
    if (!selectedRegionId && firstRegion) setSelectedRegionId(regionId(firstRegion, 0));
    if (selectedRegionId && !parking.geometry.regions.some((region, index) => regionId(region, index) === selectedRegionId)) {
      setSelectedRegionId(firstRegion ? regionId(firstRegion, 0) : null);
    }
  }, [doc.parkings, selectedParkingId, selectedRegionId]);

  useEffect(() => {
    if (!loaded) return;
    saveDoc(doc);
  }, [doc, loaded]);

  const parking = doc.parkings.find((item) => item.id === selectedParkingId) ?? doc.parkings[0];
  if (!parking) return null;

  const selectedRegion = parking.geometry.regions.find((region, index) => regionId(region, index) === selectedRegionId) ?? null;
  const popupRegion = zonePopupId ? parking.geometry.regions.find((region, index) => regionId(region, index) === zonePopupId) ?? null : null;
  const popupCamera = cameraPopupId ? parking.cameras.find((camera) => camera.id === cameraPopupId) ?? null : null;

  const updateParkingLocal = (mutate: (parking: ParkingLotConfig) => ParkingLotConfig) => {
    setDoc((current) => updateParking(current, parking.id, mutate));
  };

  const addZone = () => {
    const next = defaultRegion(parking);
    setDoc((current) =>
      updateParking(current, parking.id, (nextParking) => ({
        ...nextParking,
        geometry: { regions: [...nextParking.geometry.regions, next] },
      })),
    );
    setSelectedRegionId(next.id ?? null);
  };

  const addCamera = () => {
    const next = emptyCamera(parking);
    setDoc((current) =>
      updateParking(current, parking.id, (nextParking) => ({
        ...nextParking,
        cameras: [...nextParking.cameras, next],
      })),
    );
  };

  const deleteRegion = (id: string) => {
    setDoc((current) =>
      updateParking(current, parking.id, (nextParking) => ({
        ...nextParking,
        geometry: { regions: nextParking.geometry.regions.filter((region, index) => regionId(region, index) !== id) },
      })),
    );
    if (selectedRegionId === id) setSelectedRegionId(null);
  };

  const deleteCamera = (cameraId: string) => {
    setDoc((current) =>
      updateParking(current, parking.id, (nextParking) => ({
        ...nextParking,
        cameras: nextParking.cameras.filter((camera) => camera.id !== cameraId),
        geometry: { regions: nextParking.geometry.regions.map((region) => ({ ...region, cameraIds: region.cameraIds?.filter((id) => id !== cameraId) })) },
      })),
    );
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Admin</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Zone setup</h1>
        </div>
        <button type="button" onClick={() => saveDoc(doc)} className="tap inline-flex min-h-11 items-center gap-2 rounded-full bg-surface-2 px-4 font-semibold">
          <DownloadIcon size={18} />
          Export JSON
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)_21rem]">
        <Card className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden p-4">
          <SectionTitle>Parkings</SectionTitle>
          <div className="grid gap-2">
            {doc.parkings.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedParkingId(item.id)}
                className={`rounded-2xl px-3 py-3 text-left ${item.id === selectedParkingId ? "bg-primary text-primary-fg" : "bg-surface-2"}`}
              >
                <div className="font-medium">{item.name}</div>
                <div className="text-xs opacity-70">{item.geometry.regions.length} zones · {item.cameras.length} cameras</div>
              </button>
            ))}
          </div>
          <div className="text-sm text-muted">Click a zone name or its pencil to edit it. Double click a shape to focus it.</div>
        </Card>

        <ZoneCanvas
          parking={parking}
          selectedRegionId={selectedRegionId}
          onSelectRegion={setSelectedRegionId}
          onUpdateRegion={(regionIdValue, boundary) => {
            setDoc((current) =>
              updateParking(current, parking.id, (nextParking) => ({
                ...nextParking,
                geometry: {
                  regions: nextParking.geometry.regions.map((region, index) => (regionId(region, index) === regionIdValue ? { ...region, boundary } : region)),
                },
              })),
            );
          }}
          onUpdateCamera={(cameraId, position) => {
            setDoc((current) =>
              updateParking(current, parking.id, (nextParking) => ({
                ...nextParking,
                cameras: nextParking.cameras.map((camera) => (camera.id === cameraId ? { ...camera, position } : camera)),
              })),
            );
          }}
          onOpenCameraInfo={(id) => setCameraPopupId(id)}
        />

        <ZoneInspector
          parking={parking}
          selectedRegionId={selectedRegionId}
          onSelectRegion={setSelectedRegionId}
          onUpdateParking={(mutate) => setDoc((current) => updateParking(current, parking.id, mutate))}
          onAddZone={addZone}
          onDeleteRegion={deleteRegion}
          onAddCamera={addCamera}
          onDeleteCamera={deleteCamera}
          onOpenZoneInfo={(id) => setZonePopupId(id)}
          onOpenCameraInfo={(id) => setCameraPopupId(id)}
        />
      </div>

      <Sheet open={Boolean(popupRegion)} title="Edit zone" onClose={() => setZonePopupId(null)}>
        {popupRegion && (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setDoc((current) =>
                updateParking(current, parking.id, (nextParking) => ({
                  ...nextParking,
                  geometry: {
                    regions: nextParking.geometry.regions.map((region, index) =>
                      regionId(region, index) === zonePopupId
                        ? {
                            ...region,
                            id: popupRegion.id?.trim() || undefined,
                            name: popupRegion.name?.trim() || undefined,
                            slotCount: popupRegion.slotCount ?? 0,
                            cameraIds: popupRegion.cameraIds ?? [],
                          }
                        : region,
                    ),
                  },
                })),
              );
              setZonePopupId(null);
            }}
          >
            <label className="grid gap-2 text-sm">
              <span className="text-muted">Zone id</span>
              <input className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" value={popupRegion.id ?? ""} onChange={(e) => { const value = e.target.value; setZonePopupId(value); setDoc((current) => updateParking(current, parking.id, (nextParking) => ({ ...nextParking, geometry: { regions: nextParking.geometry.regions.map((region, index) => regionId(region, index) === zonePopupId ? { ...region, id: value } : region) } }))); }} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-muted">Zone name</span>
              <input className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" value={popupRegion.name ?? ""} onChange={(e) => setDoc((current) => updateParking(current, parking.id, (nextParking) => ({ ...nextParking, geometry: { regions: nextParking.geometry.regions.map((region, index) => regionId(region, index) === zonePopupId ? { ...region, name: e.target.value } : region) } })))} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-muted">Slot count</span>
              <input type="number" min={0} className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" value={popupRegion.slotCount ?? 0} onChange={(e) => setDoc((current) => updateParking(current, parking.id, (nextParking) => ({ ...nextParking, geometry: { regions: nextParking.geometry.regions.map((region, index) => regionId(region, index) === zonePopupId ? { ...region, slotCount: Math.max(0, Math.round(Number(e.target.value) || 0)) } : region) } })))} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-muted">Camera ids</span>
              <input className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" value={(popupRegion.cameraIds ?? []).join(", ")} onChange={(e) => setDoc((current) => updateParking(current, parking.id, (nextParking) => ({ ...nextParking, geometry: { regions: nextParking.geometry.regions.map((region, index) => regionId(region, index) === zonePopupId ? { ...region, cameraIds: parseCSV(e.target.value) } : region) } })))} />
            </label>
            <div className="flex gap-2">
              <button type="button" className="tap min-h-12 flex-1 rounded-full bg-surface-2 font-semibold" onClick={() => setZonePopupId(null)}>Cancel</button>
              <button type="submit" className="tap min-h-12 flex-1 rounded-full bg-primary font-semibold text-primary-fg">Save</button>
            </div>
          </form>
        )}
      </Sheet>

      <Sheet open={Boolean(popupCamera)} title="Edit camera" onClose={() => setCameraPopupId(null)}>
        {popupCamera && (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setDoc((current) =>
                updateParking(current, parking.id, (nextParking) => ({
                  ...nextParking,
                  cameras: nextParking.cameras.map((camera) =>
                    camera.id === cameraPopupId
                      ? {
                          ...camera,
                          id: popupCamera.id.trim(),
                          name: popupCamera.name.trim(),
                          position: { ...popupCamera.position },
                          headingDeg: popupCamera.headingDeg,
                          rangeMeters: popupCamera.rangeMeters,
                        }
                      : camera,
                  ),
                })),
              );
              setCameraPopupId(null);
            }}
          >
            <label className="grid gap-2 text-sm">
              <span className="text-muted">Camera id</span>
              <input className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" value={popupCamera.id} onChange={(e) => { const value = e.target.value; setCameraPopupId(value); setDoc((current) => updateParking(current, parking.id, (nextParking) => ({ ...nextParking, cameras: nextParking.cameras.map((camera) => camera.id === cameraPopupId ? { ...camera, id: value } : camera) }))); }} />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-muted">Camera name</span>
              <input className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" value={popupCamera.name} onChange={(e) => setDoc((current) => updateParking(current, parking.id, (nextParking) => ({ ...nextParking, cameras: nextParking.cameras.map((camera) => camera.id === cameraPopupId ? { ...camera, name: e.target.value } : camera) })))} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-2 text-sm">
                <span className="text-muted">X</span>
                <input type="number" className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" value={popupCamera.position.x} onChange={(e) => setDoc((current) => updateParking(current, parking.id, (nextParking) => ({ ...nextParking, cameras: nextParking.cameras.map((camera) => camera.id === cameraPopupId ? { ...camera, position: { ...camera.position, x: Number(e.target.value) || 0 } } : camera) })))} />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="text-muted">Y</span>
                <input type="number" className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" value={popupCamera.position.y} onChange={(e) => setDoc((current) => updateParking(current, parking.id, (nextParking) => ({ ...nextParking, cameras: nextParking.cameras.map((camera) => camera.id === cameraPopupId ? { ...camera, position: { ...camera.position, y: Number(e.target.value) || 0 } } : camera) })))} />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="text-muted">Heading</span>
                <input type="number" className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" value={popupCamera.headingDeg} onChange={(e) => setDoc((current) => updateParking(current, parking.id, (nextParking) => ({ ...nextParking, cameras: nextParking.cameras.map((camera) => camera.id === cameraPopupId ? { ...camera, headingDeg: Number(e.target.value) || 0 } : camera) })))} />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="text-muted">Range</span>
                <input type="number" className="min-h-11 w-full min-w-0 rounded-2xl bg-surface-2 px-3" value={popupCamera.rangeMeters} onChange={(e) => setDoc((current) => updateParking(current, parking.id, (nextParking) => ({ ...nextParking, cameras: nextParking.cameras.map((camera) => camera.id === cameraPopupId ? { ...camera, rangeMeters: Number(e.target.value) || 0 } : camera) })))} />
              </label>
            </div>
            <div className="flex gap-2">
              <button type="button" className="tap min-h-12 flex-1 rounded-full bg-surface-2 font-semibold" onClick={() => setCameraPopupId(null)}>Cancel</button>
              <button type="submit" className="tap min-h-12 flex-1 rounded-full bg-primary font-semibold text-primary-fg">Save</button>
            </div>
          </form>
        )}
      </Sheet>
    </section>
  );
}
