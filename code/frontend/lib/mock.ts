import { occupancy } from "./forecast";
import { clockInZone } from "./schedule";
import type { CameraView, Clock, DebugState, Device, ForcedState, OpeningWindow, ParkingCamera, ParkingLotConfig, ParkingOccupancy, ParkingRegion, Weekday, ZoneOccupancy } from "./types";

const TIMEZONE = "Europe/Zurich";

export const MOCK_ENABLED = process.env.MOCK_MODE !== "false";

export const mockDisabled = () => Response.json({ error: "mock routes are disabled" }, { status: 404 });

const poly = (...pts: [number, number][]): ParkingRegion["boundary"] => pts.map(([x, y]) => ({ x, y }));

/** A shape on a mock camera photo, from pixels of its 2000x1500 preview to normalized image coordinates. */
const onPhoto = (...pts: [number, number][]): CameraView["polygon"] => pts.map(([x, y]) => ({ x: Math.round((x / 2000) * 1000) / 1000, y: Math.round((y / 1500) * 1000) / 1000 }));

const CALIBRATED_AT = "2026-10-29T08:45:00Z";

/** Mock cameras, each with a photo of a real bike parking standing in for its view. */
const SNAPSHOTS: Record<string, string> = {
  "cam-p1-1": "/mock/IMG_20261029_083657.jpg",
  "cam-p1-2": "/mock/IMG_20261029_083851.jpg",
  "cam-p2-1": "/mock/IMG_20261029_084403.jpg",
  "cam-p3-1": "/mock/IMG_20261029_083750.jpg",
  "cam-shelter-bus": "/mock/IMG_20261029_084016.jpg",
  "cam-shelter-entrance": "/mock/IMG_20261029_084104.jpg",
};

const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri"];
const ALL_DAYS: Weekday[] = [...WEEKDAYS, "sat", "sun"];

function schedule(days: Weekday[], window: OpeningWindow): ParkingLotConfig["schedule"] {
  const weekly = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } as ParkingLotConfig["schedule"]["weekly"];
  days.forEach((d) => (weekly[d] = [window]));
  return { timezone: TIMEZONE, weekly };
}

function config(
  id: string,
  name: string,
  totalSlots: number,
  sched: ParkingLotConfig["schedule"],
  regions: ParkingRegion[],
  cameras: ParkingCamera[] = [],
): ParkingLotConfig {
  return {
    version: 1,
    id,
    name,
    totalSlots,
    geometry: { regions },
    slotSize: { widthMeters: 0.7, lengthMeters: 2 },
    schedule: sched,
    cameras,
  };
}

interface MockParking {
  config: ParkingLotConfig;
}

const PARKINGS: MockParking[] = [
  {
    config: config(
      "p1",
      "Parking 1",
      46,
      schedule(ALL_DAYS, { start: "06:30", end: "20:00" }),
      [
        { id: "A", name: "North row", slotCount: 18, boundary: poly([2, 2], [18, 2], [18, 12], [12, 12], [12, 22], [2, 22]) },
        { id: "B", name: "Center row", slotCount: 16, boundary: poly([20, 2], [40, 2], [40, 10], [34, 22], [20, 22]) },
        { id: "C", name: "East wing", slotCount: 12, boundary: poly([43, 2], [56, 2], [56, 22], [40, 22]) },
      ],
      [
        { id: "cam-p1-1", name: "Gate cam", position: { x: 18, y: 24 }, headingDeg: 330, rangeMeters: 20, calibratedAt: CALIBRATED_AT, views: [{ regionId: "B", polygon: onPhoto([20, 1215], [1610, 680], [1400, 610], [20, 930]) }] },
        { id: "cam-p1-2", name: "Corner cam", position: { x: 53, y: 25 }, headingDeg: 245, rangeMeters: 18, calibratedAt: CALIBRATED_AT, views: [{ regionId: "C", polygon: onPhoto([420, 1370], [1870, 900], [1720, 700], [90, 1010]) }] },
      ],
    ),
  },
  {
    config: config(
      "p2",
      "Parking underground",
      44,
      schedule(WEEKDAYS, { start: "06:00", end: "21:00" }),
      [
        { id: "D", name: "Ramp side", slotCount: 20, boundary: poly([2, 2], [24, 2], [24, 10], [14, 10], [14, 16], [2, 16]) },
        { id: "E", name: "Back wall", slotCount: 24, boundary: poly([26, 2], [46, 2], [46, 16], [26, 16]) },
      ],
      [{ id: "cam-p2-1", name: "Ramp cam", position: { x: 18, y: 20 }, headingDeg: 275, rangeMeters: 20, calibratedAt: CALIBRATED_AT, views: [{ regionId: "D", polygon: onPhoto([170, 530], [1300, 1500], [2000, 1500], [2000, 1060], [240, 490]) }] }],
    ),
  },
  {
    config: config(
      "p3",
      "Pizza",
      8,
      schedule(WEEKDAYS, { start: "07:00", end: "18:30" }),
      [{ id: "F", name: "Front strip", slotCount: 8, boundary: poly([2, 2], [22, 2], [22, 14], [8, 14], [2, 8]) }],
      [{ id: "cam-p3-1", name: "Street cam", position: { x: 12, y: 18 }, headingDeg: 300, rangeMeters: 16, calibratedAt: CALIBRATED_AT, views: [{ regionId: "F", polygon: onPhoto([170, 848], [1790, 815], [1650, 720], [290, 735]) }] }],
    ),
  },
];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const saved = globalThis as unknown as { __fmbsParkings?: Map<string, ParkingLotConfig | null>; __fmbsParkingsCleared?: boolean };

/** What the admin saved, by parking id; null marks a deleted one. Lives until the dev server restarts. */
const savedParkings = () => (saved.__fmbsParkings ??= new Map());

export function mockParkings(): ParkingLotConfig[] {
  const edits = savedParkings();
  if (saved.__fmbsParkingsCleared) return [...edits.values()].filter((c): c is ParkingLotConfig => c !== null);
  const seeded = PARKINGS.flatMap((p) => {
    const edit = edits.get(p.config.id);
    return edit === null ? [] : [edit ?? p.config];
  });
  const created = [...edits.values()].filter((c): c is ParkingLotConfig => c !== null && !PARKINGS.some((p) => p.config.id === c.id));
  return [...seeded, ...created];
}

export function resetMockParkings() {
  saved.__fmbsParkings = new Map();
  saved.__fmbsParkingsCleared = true;
}

export const saveMockParking = (config: ParkingLotConfig) => void savedParkings().set(config.id, config);

export const deleteMockParking = (id: string) => void savedParkings().set(id, null);

const NEW_CAMERAS = [
  { id: "cam-shelter-bus", name: "Roadside shelter, bus side" },
  { id: "cam-shelter-entrance", name: "Roadside shelter, entrance side" },
];

export function mockDevices(): Device[] {
  const seeded = saved.__fmbsParkingsCleared ? [] : PARKINGS.flatMap((p) => p.config.cameras);
  return [...NEW_CAMERAS, ...seeded].map(({ id, name }) => ({ id, name, kind: "camera", lastSeen: new Date().toISOString(), online: true }));
}

/** The photo standing in for a mock camera's next frame. */
export const mockSnapshot = (id: string): string | undefined => SNAPSHOTS[id];

export function mockOccupancy(id: string, now: number, debug: DebugState): ParkingOccupancy | null {
  const config = mockParkings().find((c) => c.id === id);
  if (!config) return null;
  const clock: Clock = debug.clock ?? clockInZone(TIMEZONE, new Date(now));
  const base = occupancy(id, clock.day, clock.hour);
  const updatedAt = new Date(now).toISOString();

  const zones = config.geometry.regions.map((region, index): ZoneOccupancy => {
    const forced: ForcedState = debug.zones[`${id}:${region.id}`] ?? "normal";
    if (forced === "unknown") return { zoneId: region.id, capacity: region.slotCount, detected: null, occupancy: null, overflow: false, status: "unknown", cameraCount: 0, updatedAt: null };
    // Each zone drifts around the parking's rhythm on its own, so they don't all read the same.
    const drift = 0.8 + 0.3 * Math.sin(now / 45000 + index * 1.7);
    const estimate = forced === "full" ? 0.97 : forced === "empty" ? 0.03 : clamp01(base * drift + 0.015 * Math.sin(now / 5000 + index));
    const detected = Math.round(estimate * region.slotCount);
    return { zoneId: region.id, capacity: region.slotCount, detected, occupancy: Math.round(estimate * 100) / 100, overflow: false, status: "valid", cameraCount: 1, updatedAt };
  });
  return { parkingId: id, updatedAt, zones };
}

const g = globalThis as unknown as { __fmbsDebug?: DebugState };

function initialClock(): Clock | null {
  const pinned = Number(process.env.MOCK_HOUR);
  // A pinned hour demos a regular working day, whatever today is.
  return process.env.MOCK_HOUR && Number.isFinite(pinned) ? { day: 1, hour: pinned } : null;
}

export function getDebug(): DebugState {
  g.__fmbsDebug ??= { zones: {}, latencyMs: 0, networkCut: false, clock: initialClock() };
  return g.__fmbsDebug;
}

export function setDebug(patch: Partial<DebugState>): DebugState {
  g.__fmbsDebug = { ...getDebug(), ...patch };
  return g.__fmbsDebug;
}

export async function debugGate(): Promise<Response | null> {
  const { latencyMs, networkCut } = getDebug();
  if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
  return networkCut ? Response.json({ error: "network cut (debug)" }, { status: 503 }) : null;
}
