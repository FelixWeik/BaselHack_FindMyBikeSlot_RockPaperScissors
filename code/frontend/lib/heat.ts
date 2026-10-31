import { forEachCell, pointInPolygon } from "./geometry";
import type { ParkingHeatmap, ParkingRegion } from "./types";

export type Palette = "standard" | "safe";

// Keep in sync with --chance-* in app/globals.css.
const RAMPS: Record<Palette, [string, string, string]> = {
  standard: ["#e5484d", "#f5a524", "#12a150"],
  safe: ["#c2410c", "#f2d544", "#1f77d0"],
};

const UPSCALE = 3;

// Where the ramp reaches ok and good; a "Quiet" zone (60%+) must already read as green.
// Keep in sync with --chance-ramp in app/globals.css.
const OK_AT = 0.4;
const GOOD_AT = 0.75;

/** CSS color for a probability of finding a spot: bad (0) through ok to good. */
export function chanceColor(p: number): string {
  const c = Math.min(1, Math.max(0, p));
  if (c < OK_AT) return `color-mix(in oklab, var(--chance-bad), var(--chance-ok) ${Math.round((c / OK_AT) * 100)}%)`;
  const t = Math.min(1, (c - OK_AT) / (GOOD_AT - OK_AT));
  return `color-mix(in oklab, var(--chance-ok), var(--chance-good) ${Math.round(t * 100)}%)`;
}

const luts = new Map<Palette, Uint8ClampedArray>();

function lut(palette: Palette): Uint8ClampedArray | null {
  const cached = luts.get(palette);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const gradient = ctx.createLinearGradient(0, 0, 256, 0);
  const [bad, ok, good] = RAMPS[palette];
  gradient.addColorStop(0, bad);
  gradient.addColorStop(OK_AT, ok);
  gradient.addColorStop(GOOD_AT, good);
  gradient.addColorStop(1, good);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 1);
  const data = ctx.getImageData(0, 0, 256, 1).data;
  luts.set(palette, data);
  return data;
}

const images = new WeakMap<ParkingHeatmap, Map<Palette, string>>();
const masks = new WeakMap<ParkingRegion[], Map<string, Uint8Array>>();

function maskOf(heat: ParkingHeatmap, regions: ParkingRegion[], rows: number, cols: number): Uint8Array {
  const { origin, cellSizeMeters } = heat.heatmap;
  const id = `${rows}:${cols}:${origin.x}:${origin.y}:${cellSizeMeters}`;
  const perRegions = masks.get(regions) ?? new Map<string, Uint8Array>();
  masks.set(regions, perRegions);
  const hit = perRegions.get(id);
  if (hit) return hit;
  const mask = new Uint8Array(rows * cols);
  forEachCell(heat, (row, col, c) => {
    if (regions.some((r) => pointInPolygon(c, r.boundary))) mask[row * cols + col] = 1;
  });
  perRegions.set(id, mask);
  return mask;
}

/** Renders the probability grid as a smooth image; memoized per heatmap so thumbnails share it. */
export function heatImage(heat: ParkingHeatmap, regions: ParkingRegion[], palette: Palette): string | null {
  const perHeat = images.get(heat);
  const cached = perHeat?.get(palette);
  if (cached) return cached;

  const grid = heat.heatmap.probabilities;
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const colors = lut(palette);
  if (rows === 0 || cols === 0 || !colors) return null;

  const mask = maskOf(heat, regions, rows, cols);
  const values = new Float32Array(rows * cols).fill(NaN);
  grid.forEach((line, row) =>
    line.forEach((p, col) => {
      if (mask[row * cols + col]) values[row * cols + col] = p;
    }),
  );

  // Fill cells outside the regions from their neighbours so edges don't blend towards 0.
  for (let pass = 0; pass < 3; pass++) {
    const next = values.slice();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (!Number.isNaN(values[row * cols + col])) continue;
        let sum = 0;
        let n = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (row + dr < 0 || row + dr >= rows || col + dc < 0 || col + dc >= cols) continue;
            const v = values[(row + dr) * cols + col + dc];
            if (!Number.isNaN(v)) {
              sum += v;
              n++;
            }
          }
        }
        if (n > 0) next[row * cols + col] = sum / n;
      }
    }
    values.set(next);
  }

  const source = document.createElement("canvas");
  source.width = cols;
  source.height = rows;
  const sourceCtx = source.getContext("2d");
  if (!sourceCtx) return null;
  const img = sourceCtx.createImageData(cols, rows);
  values.forEach((v, i) => {
    const p = Number.isNaN(v) ? 0 : Math.min(1, Math.max(0, v));
    const at = Math.round(p * 255) * 4;
    img.data[i * 4] = colors[at];
    img.data[i * 4 + 1] = colors[at + 1];
    img.data[i * 4 + 2] = colors[at + 2];
    img.data[i * 4 + 3] = 255;
  });
  sourceCtx.putImageData(img, 0, 0);

  const scaled = document.createElement("canvas");
  scaled.width = cols * UPSCALE;
  scaled.height = rows * UPSCALE;
  const scaledCtx = scaled.getContext("2d");
  if (!scaledCtx) return null;
  scaledCtx.imageSmoothingEnabled = true;
  scaledCtx.imageSmoothingQuality = "high";
  scaledCtx.drawImage(source, 0, 0, scaled.width, scaled.height);

  const url = scaled.toDataURL();
  images.set(heat, (perHeat ?? new Map<Palette, string>()).set(palette, url));
  return url;
}
