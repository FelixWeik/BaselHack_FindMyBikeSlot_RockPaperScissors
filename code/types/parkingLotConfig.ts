import type { ParkingHeatmap, ParkingRegion } from './parkingHeatmap';

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
}

export interface ParkingLotDataset {
  config: ParkingLotConfig;
  heatmap: ParkingHeatmap;
}
