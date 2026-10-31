export interface Point {
  x: number;
  y: number;
}

/** A physical zone of a parking. Its capacity lives here and nowhere else, whichever cameras watch it. */
export interface ParkingRegion {
  id: string;
  /** Human name shown in admin and overlays. */
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
  status: 'valid' | 'unknown';
  cameraCount: number;
  /** ISO 8601 time of the newest measurement used. */
  updatedAt: string | null;
}

export interface ParkingOccupancy {
  parkingId: string;
  updatedAt: string | null;
  zones: ZoneOccupancy[];
}
