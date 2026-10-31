# Architecture

## Overview

```
Camera node ──JPEG──▶ Vision ──slot states──▶ Backend ──heatmap──▶ Web app
 (edge)               (LAN)                   (API + DB)            (PWA)
```

The system is split along the data it handles. Only the first hop carries images; everything after
the vision service works with slot states. This keeps privacy-sensitive data in one place and lets
each component be developed and tested on its own against the contract in [`api.md`](api.md).

## Components

### Camera node (`code/firmware`)

- **Hardware:** Seeed XIAO ESP32S3 Sense, OV3660 sensor, external antenna. Low cost, small, USB powered.
- **Push, not pull:** the node POSTs a JPEG every 2 s. No server runs on the device, so there is
  nothing to attack from the network and the node works behind NAT.
- **Hardware JPEG:** the sensor encodes JPEG itself; frames are streamed from the PSRAM frame buffer
  straight into the HTTP request without a copy.
- **Discovery:** the vision host is resolved via mDNS (`<host>.local`) with a static IP fallback,
  so a changing laptop IP does not require reflashing.
- **Self-recovery:** task watchdog (30 s), restart after 10 consecutive failures or 60 s without
  WiFi, and the reset reason is logged at boot. A full restart is the most reliable way to recover
  camera driver, WiFi stack and heap together.
- **OTA updates:** password-protected (`espota`). Failed authentication is logged but never triggers
  a restart, so the network cannot be used to reboot cameras.

### Vision service (`code/vision`)

- Receives frames on `POST /api/v1/frames`, detects bikes with Ultralytics YOLO (pretrained `yolo11n`
  or a custom-trained model) and maps detections to the slot polygons configured for each `X-Device-Id`.
- **Ground footprint matching:** only the bottom 30 % of a bike box is compared with a slot polygon,
  because the upper part of a bike overlaps neighbouring slots in a perspective view.
- **Debouncing:** a slot changes state only after 3 consecutive frames agree, so passers-by and
  single-frame detection dropouts do not cause flicker.
- **Fail-safe:** the model loads in the background so the camera's 5 s HTTP timeout is never hit;
  detection errors report `unknown` instead of stale or guessed states; a backend outage never blocks
  frame intake.
- Slot polygons are drawn on the live frame in a built-in calibration page and stored as JSON per camera.
- Frames stay in memory (latest per camera, for calibration). Training data capture is a separate,
  explicit opt-in (`RECORD_DIR`).
- The detector is an interface (`detect(jpeg) -> boxes`), so the model can be swapped without touching
  the rest of the pipeline; tests use a fake detector and run without PyTorch.

### Backend (`code/backend`)

- **FastAPI + Pydantic:** payloads are validated at the boundary; invalid data is rejected with `422`
  and never stored.
- **SQLite:** a single file, no server to operate, enough for a few writes per second. Slot states are
  stored as JSON per observation.
- **App factory (`create_app`)** lets every test run against its own temporary database.
- Next step: aggregate observations into the `ParkingHeatmap` format consumed by the web app.

### Web app (`code/frontend`)

- Next.js progressive web app, installable on phones.
- Views: live occupancy, map, forecast by time of day and weekday, settings, and an admin view to
  draw parking zone polygons.
- Shared types in `code/types` define parking geometry and heatmaps for frontend and backend.

## Quality

| Area | Tooling |
|---|---|
| Backend, vision | ruff (lint + format), pytest |
| Web app | ESLint, TypeScript, production build |
| Firmware | PlatformIO build |

All checks run in GitHub Actions on every push and pull request (`.github/workflows/ci.yml`).
