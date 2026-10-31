import { occupancy } from "./forecast";
import { boxOf, pointInPolygon, regionKey } from "./geometry";
import { clockInZone } from "./schedule";
import type { Clock, DebugState, ForcedState, OpeningWindow, ParkingCamera, ParkingHeatmap, ParkingLotConfig, ParkingRegion, Weekday } from "./types";

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
      60,
      schedule(ALL_DAYS, { start: "06:30", end: "20:00" }),
      [
        { id: "A", name: "North row", slotCount: 18, boundary: poly([2, 2], [18, 2], [18, 12], [12, 12], [12, 22], [2, 22]) },
        { id: "B", name: "Center row", slotCount: 24, cameraIds: ["cam-p1-1"], boundary: poly([20, 2], [40, 2], [40, 10], [34, 22], [20, 22]) },
        { id: "C", name: "East wing", slotCount: 18, cameraIds: ["cam-p1-2"], boundary: poly([43, 2], [56, 2], [56, 22], [40, 22]) },
      ],
      [
        { id: "cam-p1-1", name: "Gate cam", position: { x: 18, y: 24 }, headingDeg: 330, rangeMeters: 20 },
        { id: "cam-p1-2", name: "Corner cam", position: { x: 53, y: 25 }, headingDeg: 245, rangeMeters: 18 },
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
        { id: "D", name: "Ramp side", slotCount: 20, cameraIds: ["cam-p2-1"], boundary: poly([2, 2], [24, 2], [24, 10], [14, 10], [14, 16], [2, 16]) },
        { id: "E", name: "Back wall", slotCount: 24, boundary: poly([26, 2], [46, 2], [46, 16], [26, 16]) },
      ],
      [{ id: "cam-p2-1", name: "Ramp cam", position: { x: 18, y: 20 }, headingDeg: 275, rangeMeters: 20 }],
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
      18,
      schedule(WEEKDAYS, { start: "07:00", end: "18:30" }),
      [{ id: "F", name: "Front strip", slotCount: 18, cameraIds: ["cam-p3-1"], boundary: poly([2, 2], [22, 2], [22, 14], [8, 14], [2, 8]) }],
      [{ id: "cam-p3-1", name: "Street cam", position: { x: 12, y: 18 }, headingDeg: 300, rangeMeters: 16 }],
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

export const mockParkings = (): ParkingLotConfig[] => PARKINGS.map((p) => p.config);

export function mockHeatmap(id: string, now: number, debug: DebugState): ParkingHeatmap | null {
  const parking = PARKINGS.find((p) => p.config.id === id);
  if (!parking) return null;

  const clock: Clock = debug.clock ?? clockInZone(TIMEZONE, new Date(now));
  const base = occupancy(id, clock.day, clock.hour);
  const regions = parking.config.geometry.regions;
  const boxes = regions.map((r) => boxOf(r.boundary));

  const cols = Math.round(parking.width / CELL);
  const rows = Math.round(parking.height / CELL);
  const probabilities: number[][] = [];

  for (let row = 0; row < rows; row++) {
    const line: number[] = [];
    for (let col = 0; col < cols; col++) {
      const x = CELL / 2 + col * CELL;
      const y = CELL / 2 + row * CELL;
      const idx = regions.findIndex(
        (r, i) =>
          x >= boxes[i].minX && x <= boxes[i].maxX && y >= boxes[i].minY && y <= boxes[i].maxY && pointInPolygon({ x, y }, r.boundary),
      );
      if (idx < 0) {
        line.push(0);
        continue;
      }
      const forced: ForcedState = debug.zones[`${parking.config.id}:${regionKey(regions[idx], idx)}`] ?? "normal";
      let p: number;
      if (forced === "full") p = 0.03;
      else if (forced === "empty") p = 0.97;
      else {
        let g = 0;
        for (const b of parking.blobs) {
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
    geometry: parking.config.geometry,
    heatmap: { origin: { x: CELL / 2, y: CELL / 2 }, cellSizeMeters: CELL, probabilities },
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
