"""Find my Bike Slot - vision service.

Receives JPEG frames from camera nodes, detects bikes, maps them to the slots configured per camera
and reports debounced slot states to the backend. Frames are kept in memory only (latest per camera,
for the calibration page) unless RECORD_DIR is set for training data capture.

Run (from code/vision):  uv run --group model uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8001
Calibration page:        http://localhost:8001/
"""

import logging
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from starlette.concurrency import run_in_threadpool

from .config import Settings
from .debounce import Debouncer
from .detector import Detector, ModelNotReady, YoloDetector
from .geometry import Box
from .recorder import Recorder
from .slots import DEVICE_ID_RE, CameraSlots, SlotResult, SlotStore, evaluate

log = logging.getLogger("uvicorn.error")
MAX_FRAME_BYTES = 2 * 1024 * 1024
PAGE = (Path(__file__).parent / "calibrate.html").read_text()

SendObservation = Callable[[dict], None]


def http_sender(backend_url: str) -> SendObservation:
    url = backend_url.rstrip("/") + "/api/v1/observations"

    def send(observation: dict) -> None:
        try:
            httpx.post(url, json=observation, timeout=3).raise_for_status()
        except httpx.HTTPError as err:
            # The backend being down must not affect frame intake; the next frame retries.
            log.warning("Backend unreachable (%s): %s", url, err)

    return send


def create_app(
    settings: Settings | None = None,
    detector: Detector | None = None,
    send_observation: SendObservation | None = None,
) -> FastAPI:
    settings = settings or Settings()
    detector = detector or YoloDetector(settings.model_path, settings.bike_classes, settings.min_confidence)
    send_observation = send_observation or http_sender(settings.backend_url)
    slot_store = SlotStore(settings.slots_dir)
    debouncer = Debouncer(settings.debounce_frames)
    recorder = Recorder(settings.record_dir, settings.record_every_s)

    latest: dict[str, dict] = {}  # device_id -> latest frame + results, in memory only
    lock = threading.Lock()

    app = FastAPI(title="Find my Bike Slot - Vision", version="0.1.0")
    if recorder.enabled:
        log.warning("Recording training frames to %s", settings.record_dir)
    if hasattr(detector, "warmup"):
        detector.warmup()

    def process(device_id: str, jpeg: bytes) -> tuple[list[Box], list[SlotResult]]:
        boxes = detector.detect(jpeg)
        config = slot_store.get(device_id)
        if config is None or not config.slots:
            return boxes, []
        raw = evaluate(boxes, config.slots, settings.occupied_overlap)
        return boxes, debouncer.update(device_id, raw)

    @app.get("/healthz")
    def healthz() -> dict:
        return {"status": "ok", "recording": recorder.enabled}

    @app.post("/api/v1/frames")
    async def post_frame(request: Request, background: BackgroundTasks) -> dict:
        """Frame from a camera node (see documentation/api.md, interface 1)."""
        device_id = request.headers.get("x-device-id", "")
        if not DEVICE_ID_RE.match(device_id):
            raise HTTPException(400, "missing or invalid X-Device-Id")
        jpeg = await request.body()
        if not 0 < len(jpeg) <= MAX_FRAME_BYTES:
            raise HTTPException(413 if jpeg else 400, "bad frame size")
        if jpeg[:2] != b"\xff\xd8" or jpeg[-2:] != b"\xff\xd9":
            raise HTTPException(400, "body is not a complete JPEG")

        recorder.maybe_save(device_id, jpeg)
        try:
            boxes, slots = await run_in_threadpool(process, device_id, jpeg)
        except ModelNotReady:
            boxes, slots = [], []  # nothing to report yet; the backend keeps the previous state
        except Exception:
            # Keep accepting frames even if the model fails; report slots as unknown.
            log.exception("Detection failed for %s", device_id)
            config = slot_store.get(device_id)
            boxes = []
            slots = [SlotResult(slot_id=s.slot_id, state="unknown", conf=0.0) for s in (config.slots if config else [])]

        with lock:
            latest[device_id] = {
                "jpeg": jpeg,
                "t": time.time(),
                "rssi": request.headers.get("x-rssi"),
                "uptime_s": request.headers.get("x-uptime-s"),
                "boxes": boxes,
                "slots": slots,
            }
        if slots:
            background.add_task(
                send_observation,
                {
                    "device_id": device_id,
                    "ts": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "slots": [s.model_dump() for s in slots],
                },
            )
        return {"ok": True, "bikes": len(boxes), "slots": len(slots)}

    def _entry(device_id: str) -> dict:
        with lock:
            entry = latest.get(device_id)
        if entry is None:
            raise HTTPException(404, "no frame received from this device yet")
        return entry

    @app.get("/api/v1/devices")
    def devices() -> list[dict]:
        now = time.time()
        with lock:
            items = sorted(latest.items())
        return [
            {
                "device_id": d,
                "age_s": round(now - e["t"], 1),
                "rssi": e["rssi"],
                "uptime_s": e["uptime_s"],
                "bikes": len(e["boxes"]),
                "slots": [s.model_dump() for s in e["slots"]],
            }
            for d, e in items
        ]

    @app.get("/api/v1/devices/{device_id}/frame.jpg")
    def frame(device_id: str) -> Response:
        return Response(_entry(device_id)["jpeg"], media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    @app.get("/api/v1/devices/{device_id}/detections")
    def detections(device_id: str) -> dict:
        entry = _entry(device_id)
        return {
            "boxes": [b.__dict__ for b in entry["boxes"]],
            "slots": [s.model_dump() for s in entry["slots"]],
        }

    @app.get("/api/v1/devices/{device_id}/slots")
    def get_slots(device_id: str) -> CameraSlots:
        if not DEVICE_ID_RE.match(device_id):
            raise HTTPException(400, "invalid device id")
        return slot_store.get(device_id) or CameraSlots(device_id=device_id)

    @app.put("/api/v1/devices/{device_id}/slots")
    def put_slots(device_id: str, config: CameraSlots) -> CameraSlots:
        if config.device_id != device_id:
            raise HTTPException(400, "device_id in body does not match the URL")
        if len({s.slot_id for s in config.slots}) != len(config.slots):
            raise HTTPException(400, "slot_id values must be unique")
        slot_store.put(config)
        log.info("Saved %d slots for %s", len(config.slots), device_id)
        return config

    @app.get("/", response_class=HTMLResponse)
    def calibration_page() -> str:
        return PAGE

    return app
