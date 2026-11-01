// Backend schema, mirrored from code/types/parkingOccupancy.ts and code/types/parkingLotConfig.ts.
// Keep in sync with those files.

export interface Point {
  x: number;
  y: number;
}

/** A physical zone of a parking. Its capacity lives here and nowhere else, whichever cameras watch it. */
export interface ParkingRegion {
  id: string;
  name?: string;
  /** Maximum number of bikes, at least 1. */
  slotCount: number;
  /** Ordered polygon path of the zone on the plan, in metres. */
  boundary: Point[];
}

export interface ParkingGeometry {
  regions: ParkingRegion[];
}

export interface ZoneOccupancy {
  zoneId: string;
  capacity: number;
  /** Bikes seen, averaged across cameras; null when `status` is "unknown". */
  detected: number | null;
  /** Estimated share of the capacity in use, 0..1; null when `status` is "unknown". */
  occupancy: number | null;
  /** More bikes detected than the capacity allows: the setup or the detection deserves a look. */
  overflow: boolean;
  /** "unknown": no camera holds a valid, recent measurement. It doesn't mean empty. */
  status: "valid" | "unknown";
  cameraCount: number;
  /** ISO 8601 time of the newest measurement used. */
  updatedAt: string | null;
}

export interface ParkingOccupancy {
  parkingId: string;
  updatedAt: string | null;
  zones: ZoneOccupancy[];
}

export interface ParkingLotGeometry {
  regions: ParkingRegion[];
}

/** How one camera sees one physical zone. */
export interface CameraView {
  regionId: string;
  /** Corners in image coordinates, normalized to 0..1. */
  polygon: Point[];
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
  /** The zones this camera watches. Polygons of one camera may not overlap; another camera's may. */
  views?: CameraView[];
}

/** Hardware reporting to the backend. It is "assigned" once a parking lists it in `cameras`. */
export interface Device {
  id: string;
  kind: "camera" | "lidar";
  name: string;
  /** ISO 8601 time of the last observation. */
  lastSeen?: string;
  /** Heard from recently, whether or not its last image could be analysed. */
  online: boolean;
  /** Whether its last image could be analysed. Only "ok" gives a measurement. */
  analysis?: "ok" | "dark" | "failed" | "not_ready";
  /** Real images and a real analysis, but no physical camera behind them. */
  simulated?: boolean;
  rssi?: number | null;
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

export type ForcedState = "normal" | "full" | "empty" | "unknown";

export interface DebugState {
  /** Keyed by `${parkingId}:${regionKey}` */
  zones: Record<string, ForcedState>;
  /** Bikes pinned on a zone from /admin/demo, keyed like `zones`. */
  counts: Record<string, number>;
  latencyMs: number;
  networkCut: boolean;
  /** Replaces the real time everywhere in mock mode, to replay a day during a demo. */
  clock: Clock | null;
}
