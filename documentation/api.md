# Interfaces

> Shared contract between camera nodes, vision service, backend and frontend.
> Change it only together with the code on both sides of an interface.

```
Camera ──(1) JPEG──▶ Vision :8001 ──(2) JSON──▶ Backend :8000 ──(3) Heatmap──▶ Frontend
```

All timestamps are ISO 8601 in UTC, e.g. `2026-10-31T10:15:02Z`.

## (1) Camera → Vision — implemented (`code/firmware`)

```
POST http://<vision-host>:8001/api/v1/frames
Content-Type: image/jpeg
X-Device-Id: cam-memox-nord      unique camera name
X-RSSI: -55                      WiFi signal in dBm
X-Uptime-S: 1234                 seconds since camera boot
Body: JPEG 640x480, every 2 s
```

`200` means received; the camera counts any other response as a failure.

**Privacy:** frames are processed in memory only and discarded afterwards. They are never stored.

## (2) Vision → Backend — implemented (`code/backend`)

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

## (3) Backend → Frontend — planned

Format: `ParkingHeatmap` from `code/types/parkingHeatmap.ts`. The backend knows the position of every
slot on the site plan (in metres) and converts slot states into the probability grid.
