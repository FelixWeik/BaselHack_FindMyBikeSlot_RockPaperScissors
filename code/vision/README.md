# Vision service

Receives JPEG frames from the camera nodes, detects bikes with YOLO, maps them to the parking slots
configured for each camera and reports debounced slot states to the backend.

```
camera nodes ──JPEG──▶ vision :8001 ──slot states──▶ backend :8000
                         │
                         └─ calibration page: http://<host>:8001/
```

## Run

```bash
cd code/vision
uv sync --group model     # installs ultralytics + CPU-only PyTorch (first time only)
uv run --group model uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8001
```

The model loads in the background at startup (~10 s on first run, the pretrained `yolo11n.pt` is
downloaded automatically). Frames received before that are accepted but not analysed.

## Demo without a camera

`demo/demo_camera.py` plays prepared scenes of a bike rack (`demo/frames/`) and sends them exactly like
a camera node, one frame per second. Bikes arrive and leave every 10 s, so the whole system can be shown
on one screen: the calibration page at `http://localhost:8001/` and the web app side by side.

```bash
uv run python demo/demo_camera.py            # vision, backend and web app must be running
```

It registers its slots itself (`demo/cam-demo.slots.json`); the backend maps them to the parking
`demo` (`code/backend/parkings/demo.json`). The scenes are composed from photos the team took of a bike
shelter in Basel: an empty shelter with bikes cut out of other photos, number plate blurred. Every scene
is checked to be classified correctly by the default model.

## Calibrate slots

1. Start the service and a camera node.
2. Open `http://localhost:8001/`, pick the camera.
3. Click the corners of each slot **on the ground**, press *Finish slot*, then *Save*.

Slots are stored in `slots/<device_id>.json` (image pixel coordinates). Commit these files so every
team member runs with the same configuration.

## How a slot is classified

- YOLO detects bikes in the frame (`MIN_CONFIDENCE`, default 0.35).
- Only the bottom 30 % of each bike box (where the wheels touch the ground) is compared with the slot
  polygon. The upper part of the box usually reaches into neighbouring slots.
- A slot is `occupied` if at least `OCCUPIED_OVERLAP` (default 30 %) of a bike footprint lies inside it.
- A state change is only reported after `DEBOUNCE_FRAMES` (default 3) consecutive frames agree, so a
  person walking past does not flip a slot.
- If detection fails, all slots of that camera are reported as `unknown`.

## Using a custom model

Any Ultralytics model works (`.pt` or `.onnx`). Its class names must include `bicycle` or `bike`
(configurable with `BIKE_CLASSES`).

```bash
MODEL_PATH=models/bikes.pt uv run --group model uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8001
```

Model files are git-ignored; share them separately.

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
| `BACKEND_URL` | `http://localhost:8000` | where slot states are sent |
| `MODEL_PATH` | `yolo11n.pt` | Ultralytics model file |
| `BIKE_CLASSES` | `bicycle,bike` | class names counted as a bike |
| `MIN_CONFIDENCE` | `0.35` | detection threshold |
| `OCCUPIED_OVERLAP` | `0.3` | share of the bike footprint inside a slot |
| `DEBOUNCE_FRAMES` | `3` | consecutive frames before a state change |
| `SLOTS_DIR` | `slots/` | slot configuration directory |
| `RECORD_DIR` | unset | enables training data capture |
| `RECORD_EVERY_S` | `10` | capture interval per camera |

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/frames` | frame from a camera node (see `documentation/api.md`) |
| `GET` | `/api/v1/devices` | cameras with last frame age, signal and slot states |
| `GET` | `/api/v1/devices/{id}/frame.jpg` | latest frame (memory only) |
| `GET` | `/api/v1/devices/{id}/detections` | latest bike boxes and slot states |
| `GET`/`PUT` | `/api/v1/devices/{id}/slots` | slot configuration |
| `GET` | `/healthz` | liveness, shows whether recording is on |

## Tests

```bash
uv run ruff check . && uv run pytest
```

The tests use a fake detector, so they run without PyTorch.
