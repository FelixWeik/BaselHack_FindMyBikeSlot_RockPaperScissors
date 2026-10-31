# Architecture

## Overview

```
Camera node ──JPEG──▶ Vision ──bike boxes──▶ Backend ──occupancy──▶ Web app
 (edge)               (LAN)                  (API + DB)              (PWA)
```

The system is split along the data it handles. Only the first hop carries images; everything after
the vision service works with bike boxes and numbers. This keeps privacy-sensitive data in one place and lets
each component be developed and tested on its own against the contract in [`api.md`](api.md).

## Components

### Camera node (`code/firmware`)

- **Hardware:** Seeed XIAO ESP32S3 Sense, OV3660 sensor, external antenna. Low cost, small, USB powered.
- **Push, not pull:** the node POSTs about three JPEGs a second. No server runs on the device, so there is
  nothing to attack from the network and the node works behind NAT.
- **One firmware for every board:** a camera's ID comes from its MAC address, so two boards can't be taken for one.
- **Hardware JPEG:** the sensor encodes JPEG itself; frames are streamed from the PSRAM frame buffer
  straight into the HTTP request without a copy.
- **Discovery:** the node looks for `bikeslot.local`, which the vision service announces, with a static IP fallback,
  so neither another laptop nor a changing IP requires reflashing.
- **Self-recovery:** task watchdog (30 s), restart after 10 consecutive failures or 60 s without
  WiFi, and the reset reason is logged at boot. A full restart is the most reliable way to recover
  camera driver, WiFi stack and heap together.
- **OTA updates:** password-protected (`espota`). Failed authentication is logged but never triggers
  a restart, so the network cannot be used to reboot cameras.

### Vision service (`code/vision`)

Stateless: it knows cameras by name, and nothing about parkings or zones.

- Receives frames on `POST /api/v1/frames`, answers at once, and analyses them on a single worker thread.
  Each camera has a mailbox holding its latest frame, so a slow model drops frames rather than queuing them or
  hitting the camera's 5 s HTTP timeout. Cameras take turns.
- Detects bikes with Ultralytics YOLO (the model trained in `training/`) and sends their normalized boxes to the backend.
- **Fail-safe:** a frame too dark to read, a model failure or a model still loading are reported as such, never as
  an empty scene. A backend outage never blocks frame intake.
- **Calibration capture:** waits for the next frame, masks faces with Deface in memory, and refuses to answer if that fails.
- No frame is kept once analysed. Training data capture is a separate, explicit opt-in (`RECORD_DIR`).
- The detector and the anonymizer are interfaces, so they can be swapped without touching the rest of the pipeline;
  tests use fakes and run without PyTorch.

### Backend (`code/backend`)

- **FastAPI + Pydantic:** payloads are validated at the boundary; invalid data is rejected with `422`.
- **SQLite for the configuration only.** Measurements stay in memory: they are worthless after 30 s anyway, and a restart
  just shows `unknown` for a few seconds.
- **App factory (`create_app`)** lets every test run against its own temporary database, clock and camera.
- **Attribution (`attribution.py`)** puts each bike in a zone: at its horizontal centre, trying points from 95 % down to
  65 % of the box's height. It's pure functions, with no idea where the boxes come from.
- **Occupancy (`occupancy.py`)** is computed when read, from the latest boxes and the current configuration.
  A zone is `unknown` when no camera has a valid, recent measurement. Merging is one replaceable function.

### Decisions

| Decision | Why |
|---|---|
| Attribution in the backend, not in vision | The backend owns the polygons. Vision stays stateless, and a changed polygon applies at once to the last frames. |
| Vision reports uncalibrated cameras too | That's how a new camera reaches the admin's list, and it's what makes its first calibration possible. |
| A median of the last 5 frames per camera | A person walking past or a borderline confidence moves the count by a bike or two for a second. It's one line, not tracking. |
| Averaging before bounding at 100 % | Cameras reading 25/20 and 15/20 agree on a full zone; bounding first would call it 87 %. `overflow` keeps the anomaly visible. |
| Plain coloured polygons instead of a grid | A zone has one value. A smooth grid would show precision that the measurement doesn't have. |
| Overlapping polygons of a camera are refused | An ambiguous bike has no right answer; the wizard blocks it and the API refuses it. Overlaps on the *plan* only warn, as they don't affect counting. |
| Simulated cameras send images, not numbers | They run the whole real pipeline, so a demo shows real counts and real model errors, and tests the system instead of bypassing it. |
| Trained detector instead of stock `yolo26n` | The stock model badly under-counts dense racks, which is the case that matters. See `code/vision/training/README.md`. |

### Web app (`code/frontend`)

- Next.js progressive web app, installable on phones.
- Views: live occupancy, map, forecast by time of day and weekday, settings, and an admin view to set up
  parkings, sub-zones and cameras.
- The map colours each sub-zone from its merged occupancy, grey when unknown. No camera image reaches a user.
- The forecast is still simulated (`lib/forecast.ts`), as the backend keeps no history.
- Shared types in `code/types` define parking geometry and occupancy for frontend and backend.

## Quality

| Area | Tooling |
|---|---|
| Backend, vision | ruff (lint + format), pytest |
| Web app | ESLint, TypeScript, production build |
| Firmware | PlatformIO build |

All checks run in GitHub Actions on every push and pull request (`.github/workflows/ci.yml`).
