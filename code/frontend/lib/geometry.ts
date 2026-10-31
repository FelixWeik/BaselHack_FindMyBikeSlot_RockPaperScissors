import type { ParkingHeatmap, ParkingLotConfig, ParkingRegion, Point } from "./types";

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
  /** Mean probability (0..1) of finding a spot inside the region. */
  chance: number;
  level: Level;
  /** Mean position of the region's cells, used for label placement. */
  center: Point;
  /** Number of grid cells inside the region, a proxy for its area. */
  cells: number;
}

export const regionKey = (r: ParkingRegion, index: number) => r.id ?? String(index + 1);

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

export function forEachCell(h: ParkingHeatmap, fn: (row: number, col: number, center: Point, p: number) => void) {
  const { origin, cellSizeMeters: cs, probabilities } = h.heatmap;
  probabilities.forEach((line, row) =>
    line.forEach((p, col) => fn(row, col, { x: origin.x + col * cs, y: origin.y + row * cs }, p)),
  );
}

export function analyze(config: ParkingLotConfig, heat: ParkingHeatmap): RegionStat[] {
  const regions = config.geometry.regions;
  const acc = regions.map(() => ({ sum: 0, n: 0, x: 0, y: 0 }));
  const boxes = regions.map((r) => boxOf(r.boundary));

  forEachCell(heat, (_r, _c, c, p) => {
    regions.forEach((region, i) => {
      const b = boxes[i];
      if (c.x < b.minX || c.x > b.maxX || c.y < b.minY || c.y > b.maxY) return;
      if (!pointInPolygon(c, region.boundary)) return;
      const a = acc[i];
      a.sum += p;
      a.n += 1;
      a.x += c.x;
      a.y += c.y;
    });
  });

  return regions.map((region, i) => {
    const a = acc[i];
    const chance = a.n > 0 ? a.sum / a.n : 0;
    const key = regionKey(region, i);
    return {
      key,
      name: region.name ?? `Zone ${key}`,
      region,
      chance,
      level: levelOf(chance),
      center: a.n > 0 ? { x: a.x / a.n, y: a.y / a.n } : { x: boxes[i].minX, y: boxes[i].minY },
      cells: a.n,
    };
  });
}

export const bestRegion = (stats: RegionStat[]): RegionStat | null =>
  stats.reduce<RegionStat | null>((best, s) => (!best || s.chance > best.chance ? s : best), null);

/** Area-weighted, so a small zone can't outweigh a large one. */
export function overallChance(stats: RegionStat[]): number {
  const cells = stats.reduce((n, s) => n + s.cells, 0);
  return cells > 0 ? stats.reduce((sum, s) => sum + s.chance * s.cells, 0) / cells : 0;
}
