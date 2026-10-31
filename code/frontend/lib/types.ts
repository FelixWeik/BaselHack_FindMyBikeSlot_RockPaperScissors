// Backend schema, mirrored from code/types/parkingHeatmap.ts and code/types/parkingLotConfig.ts.
// Keep in sync with those files.

export interface Point {
  x: number;
  y: number;
}

export interface ParkingRegion {
  id?: string;
  /** Ordered polygon path for one usable parking area. */
  boundary: Point[];
}

export interface ParkingGeometry {
  regions: ParkingRegion[];
}

export interface ParkingHeatmap {
  version: 1;
  geometry: ParkingGeometry;
  heatmap: {
    /** First cell center in the same coordinate frame as `geometry`. */
    origin: Point;
    cellSizeMeters: number;
    /** Row-major probability grid, with 0 for cells outside the polygon. */
    probabilities: number[][];
  };
}

export interface ParkingLotGeometry {
  regions: ParkingRegion[];
}

export interface SlotSize {
  widthMeters: number;
  lengthMeters: number;
}

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface OpeningWindow {
  start: string; // HH:mm
  end: string; // HH:mm
}

export interface ParkingSchedule {
  timezone: string;
  weekly: Record<Weekday, OpeningWindow[]>;
}

export interface ParkingLotConfig {
  version: 1;
  id: string;
  name: string;
  totalSlots: number;
  geometry: ParkingLotGeometry;
  slotSize: SlotSize;
  schedule: ParkingSchedule;
}

/** A moment in the week; `day` 0 is Monday, `hour` is fractional. */
export interface Clock {
  day: number;
  hour: number;
}

// Mock-only debug panel

export type ForcedState = "normal" | "full" | "empty";

export interface DebugState {
  /** Keyed by `${parkingId}:${regionKey}` */
  zones: Record<string, ForcedState>;
  latencyMs: number;
  networkCut: boolean;
  /** Replaces the real time everywhere in mock mode, to replay a day during a demo. */
  clock: Clock | null;
}
