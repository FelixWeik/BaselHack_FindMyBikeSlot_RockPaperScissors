// Backend schema, mirrored from code/types/parkingHeatmap.ts and code/types/parkingLotConfig.ts.
// Keep in sync with those files.

export interface Point {
  x: number;
  y: number;
}

export interface ParkingRegion {
  id?: string;
  name?: string;
  cameraIds?: string[];
  slotCount?: number;
  /** Ordered polygon path for one usable parking area. */
  boundary: Point[];
  /** The same area as seen by the calibrating camera, in image coordinates normalized to 0..1. */
  imagePolygon?: Point[];
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

export interface ParkingCamera {
  id: string;
  name: string;
  /** Optional: a camera is calibrated from its own view, not placed on the plan. */
  position?: Point;
  headingDeg?: number;
  rangeMeters?: number;
  /** ISO 8601 time of the last calibration. */
  calibratedAt?: string;
}

/** Hardware reporting to the backend. It is "assigned" once a parking lists it in `cameras`. */
export interface Device {
  id: string;
  kind: "camera" | "lidar";
  name: string;
  /** Where to get a view to calibrate on; without one the admin provides a photo. */
  snapshotUrl?: string;
  /** ISO 8601 time of the last observation. */
  lastSeen?: string;
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
  cameras: ParkingCamera[];
}

export interface ParkingAdminDocument {
  version: 1;
  parkings: ParkingLotConfig[];
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
