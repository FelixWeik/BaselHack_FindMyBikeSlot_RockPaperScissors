import type { ParkingLotConfig, ParkingOccupancy, ParkingRegion, Point } from "./types";

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type Level = "high" | "medium" | "low";

export const LEVEL_LABEL: Record<Level, string> = {
  high: "Quiet",
  medium: "Busy",
  low: "Nearly full",
};

export interface RegionStat {
  key: string;
  name: string;
  region: ParkingRegion;
  /** Estimated share of free capacity (0..1); null when no camera has a recent measurement, which isn't "empty". */
  chance: number | null;
  level: Level | null;
  /** Used for label placement. */
  center: Point;
  capacity: number;
  /** Bikes seen, averaged across cameras. */
  detected: number | null;
}

export const levelOf = (p: number): Level => (p >= 0.6 ? "high" : p >= 0.3 ? "medium" : "low");

export function boxOf(points: Point[]): Box {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const polygonPath = (poly: Point[]) => `M${poly.map((p) => `${p.x} ${p.y}`).join("L")}Z`;

const LABEL_SAMPLES = 24;

/** The mean of points inside the polygon: unlike its bounding box's centre, it stays on an L-shaped zone's body. */
function labelPoint(boundary: Point[]): Point {
  const box = boxOf(boundary);
  let x = 0;
  let y = 0;
  let n = 0;
  for (let i = 0; i < LABEL_SAMPLES; i++) {
    for (let j = 0; j < LABEL_SAMPLES; j++) {
      const p = { x: box.minX + ((i + 0.5) / LABEL_SAMPLES) * (box.maxX - box.minX), y: box.minY + ((j + 0.5) / LABEL_SAMPLES) * (box.maxY - box.minY) };
      if (!pointInPolygon(p, boundary)) continue;
      x += p.x;
      y += p.y;
      n++;
    }
  }
  return n > 0 ? { x: x / n, y: y / n } : { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

export function analyze(config: ParkingLotConfig, live: ParkingOccupancy): RegionStat[] {
  return config.geometry.regions.map((region) => {
    const zone = live.zones.find((z) => z.zoneId === region.id);
    const chance = zone?.status === "valid" && zone.occupancy !== null ? 1 - zone.occupancy : null;
    return {
      key: region.id,
      name: region.name ?? `Zone ${region.id}`,
      region,
      chance,
      level: chance === null ? null : levelOf(chance),
      center: labelPoint(region.boundary),
      capacity: region.slotCount,
      detected: chance === null ? null : (zone?.detected ?? null),
    };
  });
}

/** A zone nobody can see never wins. */
export const bestRegion = (stats: RegionStat[]): RegionStat | null =>
  stats.reduce<RegionStat | null>((best, s) => (s.chance !== null && (!best || s.chance > (best.chance ?? 0)) ? s : best), null);

/** Weighted by capacity over the zones with a measurement; null when there is none. */
export function overallChance(stats: RegionStat[]): number | null {
  const known = stats.filter((s) => s.chance !== null);
  const capacity = known.reduce((n, s) => n + s.capacity, 0);
  return capacity > 0 ? known.reduce((sum, s) => sum + (s.chance ?? 0) * s.capacity, 0) / capacity : null;
}
