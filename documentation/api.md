# Interfaces

> Shared contract between camera nodes, vision service, backend and frontend.
> Change it only together with the code on both sides of an interface.

```
Camera ──(1) JPEG──▶ Vision :8001 ──(2) JSON──▶ Backend :8000 ──(3) Heatmap──▶ Frontend
```

All timestamps are ISO 8601 in UTC, e.g. `2026-10-31T10:15:02Z`.

## (1) Camera → Vision — implemented (`code/firmware`, `code/vision`)

```
POST http://<vision-host>:8001/api/v1/frames
Content-Type: image/jpeg
X-Device-Id: cam-memox-nord      unique camera name
X-RSSI: -55                      WiFi signal in dBm
X-Uptime-S: 1234                 seconds since camera boot
Body: JPEG 640x480, every 2 s
```

`200` means received; the camera counts any other response as a failure.
Response body (informational): `{"ok": true, "bikes": 2, "slots": 6}`.
Invalid frames (missing `X-Device-Id`, not a complete JPEG, larger than 2 MB) get `400`/`413`.

**Privacy:** frames are processed in memory only and discarded afterwards. They are never stored.

## (2) Vision → Backend — implemented (`code/vision` → `code/backend`)

```
POST http://<backend>:8000/api/v1/observations
Content-Type: application/json
```

```json
{
  "device_id": "cam-memox-nord",
  "ts": "2026-10-31T10:15:02Z",
  "slots": [
    {"slot_id": "s1", "state": "occupied", "conf": 0.92},
    {"slot_id": "s2", "state": "free",     "conf": 0.88},
    {"slot_id": "s3", "state": "unknown",  "conf": 0.0}
  ]
}
```

| Field | Meaning |
|---|---|
| `device_id` | camera the frame came from (from `X-Device-Id`) |
| `ts` | analysis time |
| `slots[].slot_id` | slot name, unique per camera |
| `slots[].state` | `free`, `occupied` or `unknown` (e.g. occluded by a person, image too dark) |
| `slots[].conf` | detection confidence, 0..1 |

Response `201`: `{"id": 1, "device_id": "cam-memox-nord", "free": 1, "occupied": 1, "unknown": 1}`.
Invalid payloads are rejected with `422` and a description of the error.

`GET /api/v1/observations/latest` returns the most recent observation per camera (for debugging).

## (3) Backend → Frontend — implemented (`code/backend`)

The paths match what the web app already calls (`code/frontend/lib/api.ts`). Field names are camelCase.

```
GET /api/parkings                  → ParkingLotConfig[]   (code/types/parkingLotConfig.ts)
GET /api/parkings/{id}/heatmap     → ParkingHeatmap       (code/types/parkingHeatmap.ts)
```

`probabilities` is the chance of finding a **free** slot per 0.5 m cell: `1` = free, `0` = full,
`0.5` = no current information (camera offline for more than 60 s or no slots mapped), `0` outside regions.
Cells close to a slot follow its state; cells further away blend towards the free share of their region.

Run the web app against the backend:

```bash
NEXT_PUBLIC_MOCK_MODE=false NEXT_PUBLIC_API_URL=http://<backend-host>:8000 bun run dev
```

### Parking configuration

One file per parking in `code/backend/parkings/<id>.json`: the site plan in metres plus where each
camera slot lies on it.

```json
{
  "config": { "version": 1, "id": "memox", "name": "...", "totalSlots": 1,
              "geometry": { "regions": [{ "id": "A", "boundary": [{ "x": 0, "y": 0 }, ...] }] },
              "slotSize": { "widthMeters": 0.7, "lengthMeters": 2 },
              "schedule": { "timezone": "Europe/Zurich", "weekly": { "mon": [{ "start": "06:00", "end": "22:00" }], ... } } },
  "slots": [
    { "deviceId": "cam-memox-nord", "slotId": "s1", "region": "A", "x": 2, "y": 1.25 }
  ]
}
```

`config` follows `ParkingLotConfig` exactly, including the fields the admin panel edits:
`cameras` (`id`, `name`, `position`, `headingDeg`, `rangeMeters`; always present, may be empty) and the
optional region fields `name`, `cameraIds` and `slotCount`.

`deviceId` + `slotId` link a slot drawn in the vision calibration page to its position on the site plan.
Region polygons can be drawn with the admin zone editor of the web app (exported as JSON).
The backend validates all files at startup and refuses to start with a broken configuration.
