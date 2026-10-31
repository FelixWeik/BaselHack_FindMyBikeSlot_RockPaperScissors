import { type AdminParking, type AdminRegion, GRID, newParking, nextRegionId, planBox, rectangle, snapGrid, withRegions } from "./adminModel";
import { pointInPolygon } from "./geometry";
import type { Point } from "./types";

/** A sub-zone being calibrated: drawn on the camera view, then placed on the plan. */
export interface DraftSubZone {
  id: string;
  name: string;
  capacity: number;
  imagePolygon: Point[];
  boundary: Point[];
}

export type DraftTarget = { kind: "existing"; parkingId: string } | { kind: "new"; name: string };

export interface CalibrationDraft {
  camera: { id: string; name: string };
  subZones: DraftSubZone[];
  target: DraftTarget;
}

const orientation = (a: Point, b: Point, c: Point) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));

/** True only when the segments cross; sharing an end or touching does not count. */
const segmentsCross = (a: Point, b: Point, c: Point, d: Point) =>
  orientation(a, b, c) * orientation(a, b, d) < 0 && orientation(c, d, a) * orientation(c, d, b) < 0;

const edges = (polygon: Point[]) => polygon.map((p, i) => [p, polygon[(i + 1) % polygon.length]] as const);

export const selfCrosses = (polygon: Point[]) =>
  edges(polygon).some(([a, b], i, all) => all.some(([c, d], j) => j > i && segmentsCross(a, b, c, d)));

const centroid = (polygon: Point[]) => ({
  x: polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length,
  y: polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length,
});

/** Neighbours sharing an edge do not overlap; crossing edges or one inside the other do. */
export function polygonsOverlap(a: Point[], b: Point[]) {
  if (a.length < 3 || b.length < 3) return false;
  return (
    edges(a).some(([p, q]) => edges(b).some(([r, s]) => segmentsCross(p, q, r, s))) ||
    pointInPolygon(centroid(a), b) ||
    pointInPolygon(centroid(b), a)
  );
}

/** Why the draft can't leave the drawing step; empty when it can. */
export function drawingIssues(subZones: DraftSubZone[]): string[] {
  if (subZones.length === 0) return ["Draw at least one sub-zone on the camera view."];
  return subZones.flatMap((zone) => {
    const label = zone.name.trim() || "A sub-zone";
    return [
      ...(zone.name.trim() ? [] : ["A sub-zone has no name."]),
      ...(zone.imagePolygon.length < 3 ? [`${label} isn't drawn on the camera view yet.`] : selfCrosses(zone.imagePolygon) ? [`${label} crosses itself on the camera view.`] : []),
      ...(zone.capacity >= 1 ? [] : [`${label} needs a capacity of at least 1.`]),
    ];
  });
}

/** Why the draft can't leave the plan step; empty when it can. */
export function planIssues(draft: CalibrationDraft): string[] {
  return [
    ...(draft.target.kind === "new" && !draft.target.name.trim() ? ["Give the new zone a name."] : []),
    ...draft.subZones.filter((zone) => zone.boundary.length < 3 || selfCrosses(zone.boundary)).map((zone) => `${zone.name} crosses itself on the plan.`),
  ];
}

/** Sub-zones overlapping on the plan: allowed, but each square then only counts for the first one. */
export function overlapWarnings(parking: AdminParking, draft: CalibrationDraft): string[] {
  const ids = new Set(draft.subZones.map((zone) => zone.id));
  const regions = parking.geometry.regions;
  return regions.flatMap((a, i) =>
    regions.slice(i + 1).flatMap((b) => ((ids.has(a.id) || ids.has(b.id)) && polygonsOverlap(a.boundary, b.boundary) ? [`${a.name ?? a.id} overlaps ${b.name ?? b.id} on the plan.`] : [])),
  );
}

/** The parking the draft will land in, before the draft is applied. */
export function targetParking(target: DraftTarget, parkings: AdminParking[]): AdminParking {
  const existing = target.kind === "existing" ? parkings.find((p) => p.id === target.parkingId) : undefined;
  return existing ?? newParking(target.kind === "new" ? target.name.trim() : "", new Set(parkings.map((p) => p.id)));
}

const GAP = 1;
const ROW_WIDTH = 24;

/** Gives every sub-zone without a place a real-size block (capacity x slot size), below what's already on the plan. */
export function placeSubZones(subZones: DraftSubZone[], parking: AdminParking): DraftSubZone[] {
  const others = parking.geometry.regions.filter((region) => !subZones.some((zone) => zone.id === region.id));
  const placed = subZones.filter((zone) => zone.boundary.length >= 3);
  const taken = [...others.map((region) => region.boundary), ...placed.map((zone) => zone.boundary)];
  const hasPlan = taken.length > 0;
  const startX = hasPlan ? snapGrid(planBox({ ...parking, geometry: { regions: others } }).minX) : 2;
  const bottom = hasPlan ? Math.max(...taken.flat().map((p) => p.y)) : 0;

  let x = startX;
  let y = snapGrid(bottom + (hasPlan ? GAP * 2 : 2));
  let rowHeight = 0;
  return subZones.map((zone) => {
    if (zone.boundary.length >= 3) return zone;
    const w = Math.max(2, Math.ceil((zone.capacity * parking.slotSize.widthMeters) / GRID) * GRID);
    const h = Math.max(GRID, Math.ceil(parking.slotSize.lengthMeters / GRID) * GRID);
    if (x > startX && x + w > startX + ROW_WIDTH) {
      x = startX;
      y += rowHeight + GAP;
      rowHeight = 0;
    }
    const boundary = rectangle(x, y, w, h);
    x += w + GAP;
    rowHeight = Math.max(rowHeight, h);
    return { ...zone, boundary };
  });
}

/** The parking once the draft is in: this camera's sub-zones replaced, everything else untouched. */
export function applyCalibration(parking: AdminParking, draft: CalibrationDraft, calibratedAt: string): AdminParking {
  const { camera } = draft;
  const toRegion = (zone: DraftSubZone, previous?: AdminRegion): AdminRegion => ({
    ...previous,
    id: zone.id,
    name: zone.name.trim(),
    slotCount: zone.capacity,
    boundary: zone.boundary,
    imagePolygon: zone.imagePolygon,
    cameraIds: [...new Set([...(previous?.cameraIds ?? []), camera.id])],
  });

  const regions = parking.geometry.regions.flatMap((region) => {
    const zone = draft.subZones.find((z) => z.id === region.id);
    if (zone) return [toRegion(zone, region)];
    return region.cameraIds?.includes(camera.id) ? [] : [region];
  });
  // A draft's ids only tell its sub-zones apart: the ones that stay get a real id from the zone they land in.
  const taken = new Set(parking.geometry.regions.map((region) => region.id));
  const added = draft.subZones
    .filter((zone) => !taken.has(zone.id))
    .map((zone) => {
      const id = nextRegionId(taken);
      taken.add(id);
      return toRegion({ ...zone, id });
    });

  const known = parking.cameras.find((c) => c.id === camera.id);
  const cameras = known ? parking.cameras.map((c) => (c.id === camera.id ? { ...c, calibratedAt } : c)) : [...parking.cameras, { ...camera, calibratedAt }];
  return { ...withRegions(parking, [...regions, ...added]), cameras };
}

/** Starts a calibration, picking up what's already there when the camera is being recalibrated. */
export function startDraft(camera: { id: string; name: string }, parkings: AdminParking[]): CalibrationDraft {
  const home = parkings.find((parking) => parking.cameras.some((c) => c.id === camera.id));
  if (!home) return { camera, subZones: [], target: parkings[0] ? { kind: "existing", parkingId: parkings[0].id } : { kind: "new", name: "" } };
  return {
    camera,
    target: { kind: "existing", parkingId: home.id },
    subZones: home.geometry.regions
      .filter((region) => region.cameraIds?.includes(camera.id))
      .map((region) => ({ id: region.id, name: region.name ?? region.id, capacity: region.slotCount ?? 0, imagePolygon: region.imagePolygon ?? [], boundary: region.boundary })),
  };
}
