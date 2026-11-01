# Find my Bike Slot

[![CI](https://github.com/FelixWeik/BaselHack_FindMyBikeSlot_C4/actions/workflows/ci.yml/badge.svg)](https://github.com/FelixWeik/BaselHack_FindMyBikeSlot_C4/actions/workflows/ci.yml)

**Know where to park your bike before you get there.** Low-cost camera nodes watch bike parking
areas and a web app shows, in real time and as a forecast, where free slots are.

Built at BaselHack 2026.

## The problem

Bike parking at stations and campuses is often full at peak times. Riders circle between
parking areas, park in unofficial spots and block walkways. There is no live information
about which area still has space.

## How it works

```
┌──────────────┐  JPEG, WiFi   ┌──────────────┐  bike boxes   ┌──────────────┐  occupancy ┌──────────────┐
│ Camera node  │ ────────────> │    Vision    │ ────────────> │   Backend    │ ─────────> │   Web app    │
│ ESP32-S3     │  HTTP POST    │  detection   │  JSON         │ FastAPI      │  JSON      │ Next.js PWA  │
│ + OV3660     │               │  (in memory) │               │ + SQLite     │            │              │
└──────────────┘               └──────────────┘               └──────────────┘            └──────────────┘
```

1. **Camera node** (`code/firmware`): a low-cost Seeed XIAO ESP32S3 Sense sends about three JPEGs a second over WiFi.
   It recovers on its own from WiFi loss, hangs and crashes, and can be updated over the air.
2. **Vision service** (`code/vision`): detects bikes with a YOLO model trained for dense racks, reports their
   positions, and masks faces in the rare image that leaves it: the admin's calibration view.
3. **Backend** (`code/backend`): stores the parkings, puts each bike in a zone, and merges the cameras into an
   estimated occupancy per zone.
4. **Web app** (`code/frontend`): live occupancy, map, forecast by time of day and week, and an
   admin view to set up parkings, sub-zones and cameras.

Interfaces between the components are defined in [`documentation/api.md`](documentation/api.md),
design decisions in [`documentation/architecture.md`](documentation/architecture.md).

## Privacy by design

- Images never leave memory: no frame is written to disk on the camera, the vision service or the backend.
  Capturing training images is a separate, explicit opt-in for the team's own test setup.
- Only the parking configuration is stored. Bike positions stay in memory for a few seconds.
- Users never see a camera image. An admin calibrating a camera gets one view with its faces masked by
  [Deface](https://github.com/ORB-HD/deface), or nothing if masking fails. Masking can miss a face: it reduces
  the risk, it doesn't remove it.
- No identification or tracking of people or bikes; the system only counts occupancy.

## Status

| Component | Status |
|---|---|
| Camera node firmware | working on hardware |
| Vision service: detection + anonymized capture | working, tested |
| Custom-trained bike model | trained; see `code/vision/training/README.md` for what it was and wasn't measured on |
| Backend: attribution, occupancy, multi-camera fusion | working, tested |
| Web app | working; live mode against the backend, mock mode for offline demos |
| Forecast | simulated, the backend keeps no history |
| Authentication | none yet: this is a prototype, keep it on a trusted network |

## Quick start

Everything on one laptop, with one command. Testing with your own camera node or without one:
[documentation/team-setup.md](documentation/team-setup.md).

```bash
scripts/start.sh          # backend, vision and web app, on what the camera nodes send
scripts/start.sh --demo   # the same, plus the simulated cameras
```

It prints the URLs. The cameras show up in the admin (`/admin/setup`) after their first frame, simulated ones marked as
such. Without this script, the web app runs on its offline mock (`cd code/frontend && bun run dev`).

A simulated camera sends real images through the same route as a camera node, so its count is what the model finds
in them, errors included. See [`code/vision/README.md`](code/vision/README.md#simulated-cameras).

To add a camera node, flash it once ([`code/firmware/README.md`](code/firmware/README.md)): it joins the WiFi and finds
the vision service on its own, under an ID of its own.

Or each service by hand. Requirements: [uv](https://docs.astral.sh/uv/), [Bun](https://bun.sh/), [PlatformIO](https://platformio.org/).

```bash
# Backend (http://localhost:8000/docs)
cd code/backend
uv sync
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

# Vision service
cd code/vision
uv sync --group model
MDNS_HOSTNAME=bikeslot uv run --group model uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8001

# Web app (http://localhost:3000), against the backend, at an address a phone can reach too
cd code/frontend
bun install
MOCK_MODE=false BACKEND_INTERNAL_URL=http://127.0.0.1:8000 bun run dev

# Camera node: see code/firmware/README.md
cd code/firmware
cp include/secrets.h.example include/secrets.h   # WiFi credentials
pio run -t upload
```

Run the checks that CI runs:

```bash
cd code/backend  && uv run ruff check . && uv run pytest
cd code/vision   && uv run ruff check . && uv run pytest
cd code/frontend && bun run lint && bun run build
cd code/firmware && pio run
```

## Repository layout

```
code/
  firmware/   ESP32-S3 camera node (PlatformIO, Arduino)
  vision/     bike detection service (YOLO), anonymized captures, model training
  backend/    FastAPI service, zone attribution and occupancy, pytest suite
  frontend/   Next.js progressive web app
  types/      shared TypeScript types for parking geometry and occupancy
documentation/
  api.md            component interfaces
  architecture.md   architecture and design decisions
assets/       pitch material
```

## Future / Half-Completed Research

The team put significant effort into replacing the camera node with a lidar node.
This means the software no longer relies on a machine learning model, using a simpler threshold metric instead.
Therefore, we would not need to train a model that is fixed in its detection capabilities (e.g. bikes only).

Also, one could build an all-in-one device containing the lidar sensors, powered by battery and solar, leaving us with a screw-on / screw-off device.
The hardware and software already exists - The only remaining step is to actually build it


## Team

[Aber-58](https://github.com/Aber-58) ·
[Elnix90](https://github.com/Elnix90) ·
[FelixWeik](https://github.com/FelixWeik) ·
[LuckyTheCookie](https://github.com/LuckyTheCookie) ·
[Nynferid](https://github.com/Nynferid) ·
[Weftus](https://github.com/Weftus) ·
[Corentin250000](https://github.com/Corentin250000)

## License

[MIT](license.txt)
