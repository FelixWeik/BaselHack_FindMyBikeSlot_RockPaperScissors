export interface Point {
  x: number;
  y: number;
}

export interface ParkingGeometry {
  /** Ordered polygon path for the usable parking area. */
  boundary: Point[];
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
