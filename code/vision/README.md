# Vision service

Receives JPEG frames from the camera nodes, detects bikes with YOLO and reports their positions to the backend,
which knows the zones. It also serves the admin's calibration view, with faces masked.

```
camera nodes ──JPEG──▶ vision :8001 ──bike boxes──▶ backend :8000
                         ▲                              │
                         └──── calibration capture ─────┘
```

## Run

```bash
cd code/vision
uv sync --group model     # installs ultralytics, Deface + CPU-only PyTorch (first time only)
uv run --group model uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8001
```

The model loads in the background at startup. Frames received before that are accepted and reported as `not_ready`.

## Presenter view

To show or film what a camera sees, start the service with `DEMO_VIEW=1` and open `http://localhost:8001/demo`.
It shows the latest frame of each camera with the detected bikes boxed and faces masked, refreshed every second.

```bash
DEMO_VIEW=1 uv run --group model uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8001
```

- Off by default: without `DEMO_VIEW=1` the `/demo` routes don't exist.
- Only the latest frame of each camera is kept, in memory, and replaced by the next one.
- Frames are masked like a calibration capture (see below); if masking fails, no image is sent.

## What happens to a frame

- It is answered at once, then waits in its camera's mailbox for the single inference thread. A newer frame of the same
  camera replaces it, so nothing queues up.
- YOLO looks for bikes (`MIN_CONFIDENCE`, `IMGSZ`), and the frame is dropped. The normalized boxes go to the backend.
- A frame too dark to read (`DARK_BELOW`) or a detection failure are reported as such: the backend treats them as
  "unknown", never as an empty parking.

## Calibration capture

`POST /api/v1/devices/{id}/calibration-capture` takes the camera's next frame, finds faces with
[Deface](https://github.com/ORB-HD/deface)'s CenterFace, masks them with opaque rectangles larger than the face, and returns the JPEG
with `Cache-Control: no-store`. All in memory, with no temporary file. If it fails, the answer is `503` and no image.

Deface can miss a face, especially a small or turned-away one: this reduces the risk but doesn't remove it.

## Using another model

Any Ultralytics model works (`.pt` or `.onnx`). Its class names must include `bicycle` or `bike`
(configurable with `BIKE_CLASSES`). `training/README.md` tells how the default one was made.

```bash
MODEL_PATH=models/other.pt uv run --group model uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8001
```

## Collecting training data

By default **no frame is ever written to disk**. For building a training set, recording can be switched on
explicitly:

```bash
RECORD_DIR=recordings uv run --group model uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8001
```

- Saves at most one frame per camera every `RECORD_EVERY_S` seconds (default 10) to `recordings/<device_id>/`.
- `recordings/` is git-ignored.
- Only record at your own test setup, inform people in the camera's field of view, and delete the images once
  the model is trained.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `BACKEND_URL` | `http://localhost:8000` | where the bike boxes are sent |
| `MODEL_PATH` | `models/yolo-bikes-v3.pt` | Ultralytics model file |
| `BIKE_CLASSES` | `bicycle,bike` | class names counted as a bike |
| `MIN_CONFIDENCE` | `0.25` | detection threshold |
| `IMGSZ` | `960` | inference resolution |
| `DARK_BELOW` | `18` | mean brightness (0..255) under which an image isn't analysed |
| `CAPTURE_TIMEOUT_S` | `5` | how long a calibration capture waits for a frame |
| `RECORD_DIR` | unset | enables training data capture |
| `RECORD_EVERY_S` | `10` | capture interval per camera |
| `DEMO_VIEW` | unset | `1` enables the presenter view at `/demo` |

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/frames` | frame from a camera node (see `documentation/api.md`) |
| `POST` | `/api/v1/devices/{id}/calibration-capture` | the camera's next frame, anonymized |
| `GET` | `/demo` | presenter view, only with `DEMO_VIEW=1` |
| `GET` | `/healthz` | liveness, whether the model is ready and whether recording is on |

## Tests

```bash
uv run ruff check . && uv run pytest
```

The tests use a fake detector and a fake anonymizer, so they run without PyTorch.
