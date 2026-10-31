import { type AdminParking, type AdminRegion, GRID, newParking, nextRegionId, planBox, rectangle, snapGrid, withRegions } from "./adminModel";
import { pointInPolygon } from "./geometry";
import type { Point } from "./types";

/** A sub-zone being calibrated: drawn on the camera view, then placed on the plan unless it's already there. */
export interface DraftSubZone {
  id: string;
  name: string;
  /** Belongs to the physical zone, so changing it reaches every camera watching it. */
  capacity: number;
  imagePolygon: Point[];
  boundary: Point[];
  /** A physical zone of the parking that another camera may watch too; false for one this draft creates. */
  existing: boolean;
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

/** Corners in a line enclose nothing, and the backend refuses them. */
const hasNoArea = (polygon: Point[]) => Math.abs(edges(polygon).reduce((sum, [a, b]) => sum + a.x * b.y - b.x * a.y, 0)) / 2 <= 1e-9;

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
  const drawn = subZones.filter((zone) => zone.imagePolygon.length >= 3);
  return [
    ...subZones.flatMap((zone) => {
      const label = zone.name.trim() || "A sub-zone";
      return [
        ...(zone.name.trim() ? [] : ["A sub-zone has no name."]),
        ...(zone.imagePolygon.length < 3 ? [`${label} isn't drawn on the camera view yet.`] : selfCrosses(zone.imagePolygon) ? [`${label} crosses itself on the camera view.`] : hasNoArea(zone.imagePolygon) ? [`${label} has no area on the camera view.`] : []),
        ...(zone.capacity >= 1 ? [] : [`${label} needs a capacity of at least 1.`]),
      ];
    }),
    // A bike standing in both would be ambiguous, so unlike on the plan this isn't just a warning.
    ...drawn.flatMap((a, i) => drawn.slice(i + 1).flatMap((b) => (polygonsOverlap(a.imagePolygon, b.imagePolygon) ? [`${a.name} and ${b.name} overlap on the camera view.`] : []))),
  ];
}

/** Why the draft's destination isn't usable yet; empty when it is. */
export const targetIssues = (target: DraftTarget): string[] => (target.kind === "new" && !target.name.trim() ? ["Give the new zone a name."] : []);

/** Why the draft can't leave the plan step; empty when it can. */
export const planIssues = (draft: CalibrationDraft): string[] =>
  draft.subZones.filter((zone) => zone.boundary.length < 3 || selfCrosses(zone.boundary)).map((zone) => `${zone.name} crosses itself on the plan.`);

/** The sub-zones once the zone they land in changes: coordinates and physical zones mean nothing on another plan. */
export const forNewTarget = (subZones: DraftSubZone[], cameraId: string): DraftSubZone[] =>
  subZones.map((zone, index) => ({ ...zone, id: zone.existing ? `${cameraId}-moved-${index}` : zone.id, existing: false, boundary: [] }));

/** Sub-zones overlapping on the plan: allowed, as the plan only draws them, but probably a mistake. */
export function overlapWarnings(parking: AdminParking): string[] {
  const regions = parking.geometry.regions;
  return regions.flatMap((a, i) => regions.slice(i + 1).flatMap((b) => (polygonsOverlap(a.boundary, b.boundary) ? [`${a.name ?? a.id} overlaps ${b.name ?? b.id} on the plan.`] : [])));
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

/** The parking once the draft is in: this camera's views replaced. A physical zone only ever goes when deleted itself. */
export function applyCalibration(parking: AdminParking, draft: CalibrationDraft, calibratedAt: string): AdminParking {
  const { camera } = draft;
  const taken = new Set(parking.geometry.regions.map((region) => region.id));
  // A draft's ids only tell its sub-zones apart: the ones that stay get a real id from the zone they land in.
  const finalIds = new Map(
    draft.subZones.map((zone) => {
      if (taken.has(zone.id)) return [zone.id, zone.id];
      const id = nextRegionId(taken);
      taken.add(id);
      return [zone.id, id];
    }),
  );
  const toRegion = (zone: DraftSubZone, previous?: AdminRegion): AdminRegion => ({
    ...previous,
    id: finalIds.get(zone.id) ?? zone.id,
    name: zone.name.trim(),
    slotCount: zone.capacity,
    boundary: zone.boundary,
  });

  const known = new Set(parking.geometry.regions.map((region) => region.id));
  const regions = parking.geometry.regions.map((region) => {
    const zone = draft.subZones.find((z) => z.id === region.id);
    return zone ? toRegion(zone, region) : region;
  });
  const added = draft.subZones.filter((zone) => !known.has(zone.id)).map((zone) => toRegion(zone));
  const views = draft.subZones.map((zone) => ({ regionId: finalIds.get(zone.id) ?? zone.id, polygon: zone.imagePolygon }));

  const existing = parking.cameras.find((c) => c.id === camera.id);
  const cameras = existing ? parking.cameras.map((c) => (c.id === camera.id ? { ...c, calibratedAt, views } : c)) : [...parking.cameras, { ...camera, calibratedAt, views }];
  return { ...withRegions(parking, [...regions, ...added]), cameras };
}

/** Starts a calibration, picking up what's already there when the camera is being recalibrated. */
export function startDraft(camera: { id: string; name: string }, parkings: AdminParking[]): CalibrationDraft {
  const home = parkings.find((parking) => parking.cameras.some((c) => c.id === camera.id));
  if (!home) return { camera, subZones: [], target: parkings[0] ? { kind: "existing", parkingId: parkings[0].id } : { kind: "new", name: "" } };
  const views = home.cameras.find((c) => c.id === camera.id)?.views ?? [];
  return {
    camera,
    target: { kind: "existing", parkingId: home.id },
    subZones: views.flatMap((view) => {
      const region = home.geometry.regions.find((r) => r.id === view.regionId);
      return region ? [{ id: region.id, name: region.name ?? region.id, capacity: region.slotCount, imagePolygon: view.polygon, boundary: region.boundary, existing: true }] : [];
    }),
  };
}
