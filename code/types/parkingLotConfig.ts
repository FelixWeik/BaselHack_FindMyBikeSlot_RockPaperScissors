import type { ParkingHeatmap, ParkingRegion } from './parkingHeatmap';

export interface ParkingCamera {
  id: string;
  name: string;
  /** Optional: a camera is calibrated from its own view, not placed on the plan. */
  position?: { x: number; y: number };
  headingDeg?: number;
  rangeMeters?: number;
  /** ISO 8601 time of the last calibration. */
  calibratedAt?: string;
}

/** Hardware reporting to the backend. It is "assigned" once a parking lists it in `cameras`. */
export interface Device {
  id: string;
  kind: 'camera' | 'lidar';
  name: string;
  /** Where to get a view to calibrate on; without one the admin provides a photo. */
  snapshotUrl?: string;
  /** ISO 8601 time of the last observation. */
  lastSeen?: string;
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
  heatmap: ParkingHeatmap;
}

export interface ParkingAdminDocument {
  version: 1;
  parkings: ParkingLotConfig[];
}
