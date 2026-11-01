import type { DebugState, Device, ParkingLotConfig, ParkingOccupancy } from "./types";

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

const isOccupancy = (v: unknown): v is ParkingOccupancy =>
  isObj(v) && typeof v.parkingId === "string" && Array.isArray(v.zones) && v.zones.every((z) => isObj(z) && typeof z.zoneId === "string" && (z.occupancy === null || typeof z.occupancy === "number"));

const isDebug = (v: unknown): v is DebugState => isObj(v) && isObj(v.zones);

async function send(path: string, init: RequestInit) {
  const res = await fetch(`${BASE}${PREFIX}${path}`, { ...init, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(await refusal(res, `${path}: HTTP ${res.status}`));
}

/** The backend's own explanation. A validation error (422) holds a list, whose first message tells enough. */
async function refusal(res: Response, fallback: string): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  if (!isObj(body)) return fallback;
  if (typeof body.detail === "string") return body.detail;
  const first: unknown = Array.isArray(body.detail) ? body.detail[0] : null;
  return isObj(first) && typeof first.msg === "string" ? first.msg : fallback;
}

export const fetchParkings = () => getJson(`${PREFIX}/parkings`, isConfigs, { cache: "no-store" });

export const fetchDevices = () => getJson(`${PREFIX}/devices`, isDevices, { cache: "no-store" });

export const saveParking = (parking: ParkingLotConfig) =>
  send(`/parkings/${encodeURIComponent(parking.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parking) });

export const deleteParking = (id: string) => send(`/parkings/${encodeURIComponent(id)}`, { method: "DELETE" });

export const fetchOccupancy = (parkingId: string) =>
  getJson(`${PREFIX}/parkings/${encodeURIComponent(parkingId)}/occupancy`, isOccupancy, { cache: "no-store" });

/** A fresh, anonymized frame from the camera. The first one is slow: the face detector has to load. */
export async function captureCalibration(cameraId: string): Promise<Blob> {
  const res = await fetch(`${BASE}${PREFIX}/cameras/${encodeURIComponent(cameraId)}/calibration-capture`, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(70_000) });
  if (!res.ok) throw new Error(await refusal(res, `The capture failed (HTTP ${res.status})`));
  return res.blob();
}

/**
 * Demo only (/admin/demo): pins how many bikes a zone holds, whatever the cameras see.
 * Against the real backend this is held in its memory; in mock mode, in the mock's debug state.
 */
export async function setDemoCount(parkingId: string, zoneId: string, detected: number) {
  if (MOCK_MODE) {
    const { counts } = await fetchDebug();
    const res = await fetch("/api/debug", { method: "POST", body: JSON.stringify({ counts: { ...counts, [`${parkingId}:${zoneId}`]: detected } }) });
    if (!res.ok) throw new Error(`/api/debug: HTTP ${res.status}`);
    return;
  }
  await send(`/parkings/${encodeURIComponent(parkingId)}/zones/${encodeURIComponent(zoneId)}/demo`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ detected }),
  });
}

/** Gives the zones back to their cameras. */
export async function clearDemoCounts() {
  if (MOCK_MODE) {
    const res = await fetch("/api/debug", { method: "POST", body: JSON.stringify({ counts: {} }) });
    if (!res.ok) throw new Error(`/api/debug: HTTP ${res.status}`);
    return;
  }
  await send("/demo/overrides", { method: "DELETE" });
}

export const fetchDebug = () => getJson("/api/debug", isDebug, { cache: "no-store" });

export async function clearMockParkings() {
  if (!MOCK_MODE) return;
  const res = await fetch("/api/debug/parkings", { method: "DELETE", cache: "no-store" });
  if (!res.ok) throw new Error(`/api/debug/parkings: HTTP ${res.status}`);
}
