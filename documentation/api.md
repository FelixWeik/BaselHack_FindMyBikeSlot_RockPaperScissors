# Interfaces

> Shared contract between camera nodes, vision service, backend and frontend.
> Change it only together with the code on both sides of an interface.

```
Camera ──(1) JPEG──▶ Vision :8001 ──(2) bike boxes──▶ Backend :8000 ──(3) occupancy──▶ Frontend
                        ▲                                │
                        └──(4) calibration capture───────┘
```

All timestamps are ISO 8601 in UTC, e.g. `2026-10-31T10:15:02Z`.

## (1) Camera → Vision

```
POST http://<vision-host>:8001/api/v1/frames
Content-Type: image/jpeg
X-Device-Id: cam-a1b2c3          unique camera name: letters, digits, - and _
X-RSSI: -55                      WiFi signal in dBm
X-Uptime-S: 1234                 seconds since camera boot
Body: JPEG, about three a second
```

A simulated camera (`code/vision/demo`) sends the same request, with an ID starting with `sim-`.

`200` means received, before the frame is analysed: `{"ok": true}`. The camera counts any other response as a failure.
Invalid frames (missing `X-Device-Id`, not a complete JPEG, larger than 2 MB) get `400`/`413`.

While the model is busy, a newer frame of a camera replaces its waiting one; nothing queues up.

**Privacy:** frames are processed in memory only and discarded afterwards. They are never stored.

## (2) Vision → Backend

```
POST http://<backend>:8000/api/v1/observations
Content-Type: application/json
```

```json
{
  "device_id": "cam-memox-nord",
  "ts": "2026-10-31T10:15:02Z",
  "status": "ok",
  "bikes": [{ "bbox": [0.12, 0.40, 0.31, 0.77], "conf": 0.91 }],
  "rssi": -55,
  "uptime_s": 1234
}
```

| Field | Meaning |
|---|---|
| `device_id` | camera the frame came from (from `X-Device-Id`) |
| `ts` | analysis time. Informative: freshness is measured on the backend's clock |
| `status` | `ok` = analysed. `dark` = too dark to tell, `failed` = the model failed, `not_ready` = still loading. Only `ok` is a measurement |
| `bikes[].bbox` | `x_min, y_min, x_max, y_max`, normalized to 0..1 |
| `bikes[].conf` | detection confidence, 0..1 |
| `rssi`, `uptime_s` | camera health, optional |

Vision knows nothing about zones and sends this for every camera, calibrated or not: that's how a new camera
shows up in the admin. Response `201`. Invalid payloads get `422`.

## (3) Backend → Frontend

Field names are camelCase.

```
GET    /api/v1/parkings                   → ParkingLotConfig[]   (code/types/parkingLotConfig.ts)
PUT    /api/v1/parkings/{id}              ← ParkingLotConfig
DELETE /api/v1/parkings/{id}              → 204, also when the id is unknown (idempotent)
GET    /api/v1/parkings/{id}/occupancy    → ParkingOccupancy     (code/types/parkingOccupancy.ts)
GET    /api/v1/parkings/{id}/cameras      → each camera's own reading, for diagnosis
GET    /api/v1/devices                    → Device[]             (cameras heard since the backend started)
```

A device's `analysis` tells whether its last image could be analysed, and `simulated` marks a `sim-` camera. A simulated
camera is otherwise counted like any other.

### Configuration

A *region* (the admin's "sub-zone") is a physical zone. It belongs to the parking and holds the capacity
(`slotCount`, at least 1). A *view* belongs to a camera and only holds the polygon of a region in that camera's image:

```json
{
  "version": 1, "id": "memox", "name": "Memox", "totalSlots": 20,
  "geometry": { "regions": [{ "id": "A", "name": "Aisle 1", "slotCount": 20, "boundary": [{ "x": 0, "y": 0 }, ...] }] },
  "cameras": [
    { "id": "cam-1", "name": "North", "views": [{ "regionId": "A", "polygon": [{ "x": 0.1, "y": 0.3 }, ...] }] },
    { "id": "cam-2", "name": "South", "views": [{ "regionId": "A", "polygon": [{ "x": 0.2, "y": 0.1 }, ...] }] }
  ],
  "slotSize": { "widthMeters": 0.7, "lengthMeters": 2 },
  "schedule": { "timezone": "Europe/Zurich", "weekly": { "mon": [{ "start": "06:00", "end": "22:00" }], ... } }
}
```

`PUT` refuses with `422`: a capacity below 1, a missing region id, a view of an unknown region, two views of one region
in a camera, a polygon that crosses itself or has no area, and two polygons of **one** camera overlapping (a bike in
both would be ambiguous; polygons of different cameras are independent). It refuses with `409` a camera
that already belongs to another parking.

### Occupancy

```json
{
  "parkingId": "memox",
  "updatedAt": "2026-10-31T10:15:02Z",
  "zones": [
    { "zoneId": "A", "capacity": 20, "detected": 16, "occupancy": 0.8, "overflow": false,
      "status": "valid", "cameraCount": 2, "updatedAt": "2026-10-31T10:15:02Z" },
    { "zoneId": "B", "capacity": 10, "detected": null, "occupancy": null, "overflow": false,
      "status": "unknown", "cameraCount": 0, "updatedAt": null }
  ]
}
```

- Each camera with a view of the zone counts its bikes, as the median over its last 5 analysed frames.
- `occupancy` is the mean of `detected / capacity` over those cameras, bounded to 1 after averaging. `overflow` tells it
  went over. `detected` is the mean of the counts, so it may not be a whole number.
- `status: "unknown"`: no camera holds a valid measurement younger than `MEASUREMENT_TTL_S` (30 s): none configured, offline, or
  its latest image couldn't be analysed. **It doesn't mean empty**, and `0` only ever means analysed and found empty.
- It is computed when read, from the latest boxes and the current configuration, so a changed capacity or polygon applies at once.
- It is an estimate of how full the zone is, not a guaranteed number of free places.

`/cameras` returns the same per camera, before merging, with `rawOccupancy` (unbounded), `online` and `analysis`
(`ok`, `dark`, `failed`, `not_ready` or `offline`).

To run the web app against the backend: `scripts/start.sh`. On its own, with an address the browser can reach:

```bash
MOCK_MODE=false NEXT_PUBLIC_API_URL=http://<backend-host>:8000 bun run dev
```

## (4) Calibration capture

```
POST http://<backend>:8000/api/v1/cameras/{id}/calibration-capture
→ 200 image/jpeg, Cache-Control: no-store
```

The backend relays to `POST <VISION_URL>/api/v1/devices/{id}/calibration-capture`. Vision waits for the camera's **next** frame,
masks the faces it finds with Deface, in memory, and answers. Nothing keeps the frame or the result afterwards.

| Status | Meaning |
|---|---|
| `504` | no frame arrived within 5 s (`CAPTURE_TIMEOUT_S`): camera off or disconnected |
| `503` | anonymization failed, **so no image is sent**; or the vision service is unreachable |

This is the only route that returns an image, and there is no route returning a raw frame. Authentication is
still to be added: anybody on the network can ask for this view.
