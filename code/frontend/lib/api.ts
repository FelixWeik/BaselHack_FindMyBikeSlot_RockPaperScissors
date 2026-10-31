import type { DebugState, ParkingHeatmap, ParkingLotConfig } from "./types";

export const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE !== "false";

const BASE = MOCK_MODE ? "" : (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

async function getJson<T>(path: string, guard: (v: unknown) => v is T, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const json: unknown = await res.json();
  if (!guard(json)) throw new Error(`${path}: invalid response`);
  return json;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const hasRegions = (v: unknown) => isObj(v) && Array.isArray(v.regions);

const isConfigs = (v: unknown): v is ParkingLotConfig[] =>
  Array.isArray(v) &&
  v.every((c) => isObj(c) && typeof c.id === "string" && typeof c.name === "string" && hasRegions(c.geometry) && isObj(c.schedule));

const isHeatmap = (v: unknown): v is ParkingHeatmap =>
  isObj(v) &&
  hasRegions(v.geometry) &&
  isObj(v.heatmap) &&
  isObj(v.heatmap.origin) &&
  typeof v.heatmap.cellSizeMeters === "number" &&
  Array.isArray(v.heatmap.probabilities);

const isDebug = (v: unknown): v is DebugState => isObj(v) && isObj(v.zones);

export const fetchParkings = () => getJson("/api/parkings", isConfigs, { cache: "no-store" });

export const fetchHeatmap = (parkingId: string) =>
  getJson(`/api/parkings/${encodeURIComponent(parkingId)}/heatmap`, isHeatmap, { cache: "no-store" });

export const fetchDebug = () => getJson("/api/debug", isDebug, { cache: "no-store" });
