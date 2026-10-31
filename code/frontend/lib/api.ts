import type { DebugState, Device, ParkingHeatmap, ParkingLotConfig } from "./types";

export const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE !== "false";

const BASE = MOCK_MODE ? "" : (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
// The mock's route handlers live under /api, the FastAPI backend under /api/v1.
const PREFIX = MOCK_MODE ? "/api" : "/api/v1";

async function getJson<T>(path: string, guard: (v: unknown) => v is T, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const json: unknown = await res.json();
  if (!guard(json)) throw new Error(`${path}: invalid response`);
  return json;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const hasRegions = (v: unknown) => isObj(v) && Array.isArray(v.regions);

export const isConfig = (c: unknown): c is ParkingLotConfig =>
  isObj(c) && typeof c.id === "string" && typeof c.name === "string" && hasRegions(c.geometry) && isObj(c.schedule) && Array.isArray(c.cameras);

const isConfigs = (v: unknown): v is ParkingLotConfig[] => Array.isArray(v) && v.every(isConfig);

const isDevices = (v: unknown): v is Device[] => Array.isArray(v) && v.every((d) => isObj(d) && typeof d.id === "string" && typeof d.name === "string");

const isHeatmap = (v: unknown): v is ParkingHeatmap =>
  isObj(v) &&
  hasRegions(v.geometry) &&
  isObj(v.heatmap) &&
  isObj(v.heatmap.origin) &&
  typeof v.heatmap.cellSizeMeters === "number" &&
  Array.isArray(v.heatmap.probabilities);

const isDebug = (v: unknown): v is DebugState => isObj(v) && isObj(v.zones);

async function send(path: string, init: RequestInit) {
  const res = await fetch(`${BASE}${PREFIX}${path}`, { ...init, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
}

export const fetchParkings = () => getJson(`${PREFIX}/parkings`, isConfigs, { cache: "no-store" });

export const fetchDevices = () => getJson(`${PREFIX}/devices`, isDevices, { cache: "no-store" });

export const saveParking = (parking: ParkingLotConfig) =>
  send(`/parkings/${encodeURIComponent(parking.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parking) });

export const deleteParking = (id: string) => send(`/parkings/${encodeURIComponent(id)}`, { method: "DELETE" });

export const fetchHeatmap = (parkingId: string) =>
  getJson(`${PREFIX}/parkings/${encodeURIComponent(parkingId)}/heatmap`, isHeatmap, { cache: "no-store" });

export const fetchDebug = () => getJson("/api/debug", isDebug, { cache: "no-store" });
