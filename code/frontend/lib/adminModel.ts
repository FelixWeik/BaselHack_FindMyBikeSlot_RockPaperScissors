import { boxOf } from "./geometry";
import type { ParkingLotConfig, ParkingRegion, ParkingSchedule, Point } from "./types";

/** Admin vocabulary: a parking is a "zone", its regions are the "sub-zones". */
export const GRID = 0.5;

/** A region whose id is always set, so it can be used as a stable key and selection handle. */
export type AdminRegion = ParkingRegion & { id: string };
export type AdminParking = Omit<ParkingLotConfig, "geometry"> & { geometry: { regions: AdminRegion[] } };

export const snapGrid = (value: number) => Math.round(value / GRID) * GRID;

/** Fills in missing region ids; returns the same object when nothing needs fixing. */
export function withIds(parking: ParkingLotConfig): AdminParking {
  if (parking.geometry.regions.every((region) => region.id)) return parking as AdminParking;
  return {
    ...parking,
    geometry: { regions: parking.geometry.regions.map((region, index) => ({ ...region, id: region.id ?? String(index + 1) })) },
  };
}

export const uniqueId = (taken: Set<string>, prefix: string) => {
  let n = taken.size + 1;
  while (taken.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
};

const letters = (n: number): string => (n < 26 ? String.fromCharCode(65 + n) : letters(Math.floor(n / 26) - 1) + letters(n % 26));

/** The map labels a sub-zone by its id, so ids stay as short as a letter. */
export function nextRegionId(taken: Set<string>) {
  let n = 0;
  while (taken.has(letters(n))) n++;
  return letters(n);
}

export const planBox = (parking: AdminParking) => boxOf(parking.geometry.regions.flatMap((region) => region.boundary));

/** A parking's capacity is what its sub-zones add up to. */
export const withRegions = (parking: AdminParking, regions: AdminRegion[]): AdminParking => ({
  ...parking,
  totalSlots: regions.reduce((sum, region) => sum + (region.slotCount ?? 0), 0),
  geometry: { regions },
});

export const rectangle = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

export function newRegion(parking: AdminParking): AdminRegion {
  const box = planBox(parking);
  const empty = parking.geometry.regions.length === 0;
  const w = empty ? 8 : Math.max(4, Math.min(10, box.maxX - box.minX));
  const h = empty ? 5 : Math.max(3, Math.min(7, box.maxY - box.minY));
  const cx = empty ? 10 : (box.minX + box.maxX) / 2;
  const cy = empty ? 8 : (box.minY + box.maxY) / 2;
  return {
    id: nextRegionId(new Set(parking.geometry.regions.map((region) => region.id))),
    name: `Sub-zone ${parking.geometry.regions.length + 1}`,
    slotCount: 0,
    cameraIds: [],
    boundary: rectangle(snapGrid(cx - w / 2), snapGrid(cy - h / 2), snapGrid(w), snapGrid(h)),
  };
}

export const addRegion = (parking: AdminParking, region: AdminRegion) => withRegions(parking, [...parking.geometry.regions, region]);

export const replaceRegion = (parking: AdminParking, next: AdminRegion) =>
  withRegions(parking, parking.geometry.regions.map((region) => (region.id === next.id ? next : region)));

export const moveRegion = (parking: AdminParking, id: string, boundary: Point[]) =>
  withRegions(parking, parking.geometry.regions.map((region) => (region.id === id ? { ...region, boundary } : region)));

export const removeRegion = (parking: AdminParking, id: string) => withRegions(parking, parking.geometry.regions.filter((region) => region.id !== id));

/** Unlinks a camera: it goes back to the cameras to calibrate, its sub-zones stay on the plan. */
export const removeCamera = (parking: AdminParking, id: string): AdminParking => ({
  ...parking,
  cameras: parking.cameras.filter((camera) => camera.id !== id),
  geometry: { regions: parking.geometry.regions.map((region) => ({ ...region, cameraIds: region.cameraIds?.filter((c) => c !== id) })) },
});

const DAYTIME = [{ start: "06:00", end: "20:00" }];

const defaultSchedule = (): ParkingSchedule => ({
  timezone: "Europe/Zurich",
  weekly: {
    mon: DAYTIME,
    tue: DAYTIME,
    wed: DAYTIME,
    thu: DAYTIME,
    fri: DAYTIME,
    sat: DAYTIME,
    sun: DAYTIME,
  },
});

export function newParking(name: string, takenIds: Set<string>): AdminParking {
  const slug = name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "zone";
  return {
    version: 1,
    id: takenIds.has(slug) ? uniqueId(takenIds, slug) : slug,
    name,
    totalSlots: 0,
    geometry: { regions: [] },
    slotSize: { widthMeters: 0.7, lengthMeters: 2 },
    schedule: defaultSchedule(),
    cameras: [],
  };
}
