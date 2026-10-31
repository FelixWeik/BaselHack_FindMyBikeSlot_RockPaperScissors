import { occupancy } from "./forecast";
import { boxOf, pointInPolygon, regionKey } from "./geometry";
import { clockInZone } from "./schedule";
import type { Clock, DebugState, Device, ForcedState, OpeningWindow, ParkingCamera, ParkingHeatmap, ParkingLotConfig, ParkingRegion, Weekday } from "./types";

const CELL = 0.5;
const TIMEZONE = "Europe/Zurich";

export const MOCK_ENABLED = process.env.MOCK_MODE !== "false";

export const mockDisabled = () => Response.json({ error: "mock routes are disabled" }, { status: 404 });

interface Blob {
  x: number;
  y: number;
  s: number;
  phase: number;
}

interface MockParking {
  config: ParkingLotConfig;
  width: number;
  height: number;
  blobs: Blob[];
}

const poly = (...pts: [number, number][]): ParkingRegion["boundary"] => pts.map(([x, y]) => ({ x, y }));

/** A shape on a mock camera photo, from pixels of its 2000x1500 preview to normalized image coordinates. */
const onPhoto = (...pts: [number, number][]): ParkingRegion["imagePolygon"] => pts.map(([x, y]) => ({ x: Math.round((x / 2000) * 1000) / 1000, y: Math.round((y / 1500) * 1000) / 1000 }));

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

const PARKINGS: MockParking[] = [
  {
    config: config(
      "p1",
      "Parking 1",
      46,
      schedule(ALL_DAYS, { start: "06:30", end: "20:00" }),
      [
        { id: "A", name: "North row", slotCount: 18, boundary: poly([2, 2], [18, 2], [18, 12], [12, 12], [12, 22], [2, 22]) },
        { id: "B", name: "Center row", slotCount: 16, cameraIds: ["cam-p1-1"], boundary: poly([20, 2], [40, 2], [40, 10], [34, 22], [20, 22]), imagePolygon: onPhoto([20, 1215], [1610, 680], [1400, 610], [20, 930]) },
        { id: "C", name: "East wing", slotCount: 12, cameraIds: ["cam-p1-2"], boundary: poly([43, 2], [56, 2], [56, 22], [40, 22]), imagePolygon: onPhoto([420, 1370], [1870, 900], [1720, 700], [90, 1010]) },
      ],
      [
        { id: "cam-p1-1", name: "Gate cam", position: { x: 18, y: 24 }, headingDeg: 330, rangeMeters: 20, calibratedAt: CALIBRATED_AT },
        { id: "cam-p1-2", name: "Corner cam", position: { x: 53, y: 25 }, headingDeg: 245, rangeMeters: 18, calibratedAt: CALIBRATED_AT },
      ],
    ),
    width: 58,
    height: 24,
    blobs: [
      { x: 6, y: 8, s: 6, phase: 0 },
      { x: 28, y: 8, s: 7, phase: 1.7 },
      { x: 26, y: 18, s: 5, phase: 3.1 },
      { x: 50, y: 12, s: 6, phase: 4.6 },
    ],
  },
  {
    config: config(
      "p2",
      "Parking underground",
      44,
      schedule(WEEKDAYS, { start: "06:00", end: "21:00" }),
      [
        { id: "D", name: "Ramp side", slotCount: 20, cameraIds: ["cam-p2-1"], boundary: poly([2, 2], [24, 2], [24, 10], [14, 10], [14, 16], [2, 16]), imagePolygon: onPhoto([170, 530], [1300, 1500], [2000, 1500], [2000, 1060], [240, 490]) },
        { id: "E", name: "Back wall", slotCount: 24, boundary: poly([26, 2], [46, 2], [46, 16], [26, 16]) },
      ],
      [{ id: "cam-p2-1", name: "Ramp cam", position: { x: 18, y: 20 }, headingDeg: 275, rangeMeters: 20, calibratedAt: CALIBRATED_AT }],
    ),
    width: 48,
    height: 18,
    blobs: [
      { x: 10, y: 6, s: 6, phase: 2 },
      { x: 36, y: 10, s: 7, phase: 0.6 },
      { x: 24, y: 8, s: 4, phase: 3.8 },
    ],
  },
  {
    config: config(
      "p3",
      "Pizza",
      8,
      schedule(WEEKDAYS, { start: "07:00", end: "18:30" }),
      [{ id: "F", name: "Front strip", slotCount: 8, cameraIds: ["cam-p3-1"], boundary: poly([2, 2], [22, 2], [22, 14], [8, 14], [2, 8]), imagePolygon: onPhoto([170, 848], [1790, 815], [1650, 720], [290, 735]) }],
      [{ id: "cam-p3-1", name: "Street cam", position: { x: 12, y: 18 }, headingDeg: 300, rangeMeters: 16, calibratedAt: CALIBRATED_AT }],
    ),
    width: 24,
    height: 16,
    blobs: [
      { x: 9, y: 7, s: 5, phase: 1.1 },
      { x: 17, y: 9, s: 4, phase: 4 },
    ],
  },
];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const saved = globalThis as unknown as { __fmbsParkings?: Map<string, ParkingLotConfig | null> };

/** What the admin saved, by parking id; null marks a deleted one. Lives until the dev server restarts. */
const savedParkings = () => (saved.__fmbsParkings ??= new Map());

export function mockParkings(): ParkingLotConfig[] {
  const edits = savedParkings();
  const seeded = PARKINGS.flatMap((p) => {
    const edit = edits.get(p.config.id);
    return edit === null ? [] : [edit ?? p.config];
  });
  const created = [...edits.values()].filter((c): c is ParkingLotConfig => c !== null && !PARKINGS.some((p) => p.config.id === c.id));
  return [...seeded, ...created];
}

export const saveMockParking = (config: ParkingLotConfig) => void savedParkings().set(config.id, config);

export const deleteMockParking = (id: string) => void savedParkings().set(id, null);

const NEW_CAMERAS = [
  { id: "cam-shelter-bus", name: "Roadside shelter, bus side" },
  { id: "cam-shelter-entrance", name: "Roadside shelter, entrance side" },
];

export function mockDevices(): Device[] {
  const seeded = PARKINGS.flatMap((p) => p.config.cameras);
  return [...NEW_CAMERAS, ...seeded].map(({ id, name }) => ({ id, name, kind: "camera", snapshotUrl: SNAPSHOTS[id], lastSeen: new Date().toISOString() }));
}

export function mockHeatmap(id: string, now: number, debug: DebugState): ParkingHeatmap | null {
  const config = mockParkings().find((c) => c.id === id);
  if (!config) return null;
  const seed = PARKINGS.find((p) => p.config.id === id);
  const regions = config.geometry.regions;
  const boxes = regions.map((r) => boxOf(r.boundary));
  // A parking created in the admin has no hand-tuned hotspots: one per sub-zone gives it the same movement.
  const blobs: Blob[] = seed?.blobs ?? boxes.map((b, i) => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, s: Math.max(2, (b.maxX - b.minX) / 2), phase: i * 1.7 }));

  const clock: Clock = debug.clock ?? clockInZone(TIMEZONE, new Date(now));
  const base = occupancy(id, clock.day, clock.hour);
  // The grid grows with the plan, since the admin can place a sub-zone anywhere.
  const all = boxOf(regions.flatMap((r) => r.boundary));
  const minX = Math.min(0, Math.floor(all.minX));
  const minY = Math.min(0, Math.floor(all.minY));
  const cols = Math.round((Math.max(seed?.width ?? 0, Math.ceil(all.maxX)) - minX) / CELL);
  const rows = Math.round((Math.max(seed?.height ?? 0, Math.ceil(all.maxY)) - minY) / CELL);
  const probabilities: number[][] = [];

  for (let row = 0; row < rows; row++) {
    const line: number[] = [];
    for (let col = 0; col < cols; col++) {
      const x = minX + CELL / 2 + col * CELL;
      const y = minY + CELL / 2 + row * CELL;
      const idx = regions.findIndex(
        (r, i) =>
          x >= boxes[i].minX && x <= boxes[i].maxX && y >= boxes[i].minY && y <= boxes[i].maxY && pointInPolygon({ x, y }, r.boundary),
      );
      if (idx < 0) {
        line.push(0);
        continue;
      }
      const forced: ForcedState = debug.zones[`${id}:${regionKey(regions[idx], idx)}`] ?? "normal";
      let p: number;
      if (forced === "full") p = 0.03;
      else if (forced === "empty") p = 0.97;
      else {
        let g = 0;
        for (const b of blobs) {
          const w = 0.65 + 0.35 * Math.sin(now / 45000 + b.phase);
          g += w * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.s * b.s));
        }
        const noise = 0.015 * Math.sin(now / 5000 + col * 0.11 + row * 0.17);
        p = 1 - clamp01(base * (0.2 + 1.0 * g) + noise);
      }
      line.push(Math.round(clamp01(p) * 100) / 100);
    }
    probabilities.push(line);
  }

  return {
    version: 1,
    geometry: config.geometry,
    heatmap: { origin: { x: minX + CELL / 2, y: minY + CELL / 2 }, cellSizeMeters: CELL, probabilities },
  };
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
