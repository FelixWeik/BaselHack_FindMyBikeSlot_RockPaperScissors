import type { ParkingOccupancy, ParkingRegion, Point } from './parkingOccupancy';

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
  position?: { x: number; y: number };
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
  kind: 'camera' | 'lidar';
  name: string;
  /** ISO 8601 time of the last observation. */
  lastSeen?: string;
  /** Heard from recently, whether or not its last image could be analysed. */
  online: boolean;
  rssi?: number | null;
}

export interface ParkingLotGeometry {
  regions: ParkingRegion[];
}

export interface SlotSize {
  widthMeters: number;
  lengthMeters: number;
}

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

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

export interface ParkingLotDataset {
  config: ParkingLotConfig;
  occupancy: ParkingOccupancy;
}

export interface ParkingAdminDocument {
  version: 1;
  parkings: ParkingLotConfig[];
}
