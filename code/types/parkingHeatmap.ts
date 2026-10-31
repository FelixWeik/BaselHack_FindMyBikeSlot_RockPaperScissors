export interface Point {
  x: number;
  y: number;
}

export interface ParkingRegion {
  /** Optional region id for labels, sensors, or UI mapping. */
  id?: string;
  /** Human name shown in admin and overlays. */
  name?: string;
  /** Optional sensor/camera links owned by this region. */
  cameraIds?: string[];
  /** Optional capacity override for the region. */
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
    /** Size of one grid cell in metres. */
    cellSizeMeters: number;
    /** Row-major probability grid, with 0 for cells outside the polygon. */
    probabilities: number[][];
  };
}

export type ParkingHeatmapPayload = ParkingHeatmap;
