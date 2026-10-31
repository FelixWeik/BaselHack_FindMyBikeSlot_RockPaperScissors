"""Find my Bike Slot - vision service.

Receives JPEG frames from camera nodes, detects bikes and reports their boxes to the backend, which knows the zones.
Frames live in memory only until they are analysed, unless RECORD_DIR is set for training data capture. The only
image that ever leaves this service is a calibration capture, and only with its faces masked. The presenter view
(off unless DEMO_VIEW=1) shows the latest frame of each camera, masked the same way.

Run (from code/vision):  uv run --group model uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8001
"""

import asyncio
import contextlib
import logging
import re
from collections.abc import AsyncIterator
from concurrent.futures import Future
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Lock

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from starlette.concurrency import run_in_threadpool

from .announce import announce
from .anonymizer import Anonymizer, DefaceAnonymizer
from .config import Settings
from .demo_view import DemoView
from .detector import Detector, YoloDetector
from .recorder import Recorder
from .worker import FrameWorker, Pending, SendObservation

log = logging.getLogger("uvicorn.error")
MAX_FRAME_BYTES = 2 * 1024 * 1024
DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def http_sender(backend_url: str) -> SendObservation:
    url = backend_url.rstrip("/") + "/api/v1/observations"

    def send(observation: dict) -> None:
        try:
            httpx.post(url, json=observation, timeout=3).raise_for_status()
        except httpx.HTTPError as err:
            # The backend being down must not affect frame intake; the next frame retries.
            log.warning("Backend unreachable (%s): %s", url, err)

    return send


def _number(value: str | None) -> int | None:
    with contextlib.suppress(TypeError, ValueError):
        return int(value)
    return None


def create_app(
    settings: Settings | None = None,
    detector: Detector | None = None,
    send_observation: SendObservation | None = None,
    anonymizer: Anonymizer | None = None,
) -> FastAPI:
    settings = settings or Settings()
    detector = detector or YoloDetector(
        settings.model_path, settings.bike_classes, settings.min_confidence, settings.imgsz, settings.dark_below
    )
    anonymizer = anonymizer or DefaceAnonymizer()
    demo = DemoView(anonymizer) if settings.demo_view else None
    worker = FrameWorker(detector, send_observation or http_sender(settings.backend_url), demo.update if demo else None)
    recorder = Recorder(settings.record_dir, settings.record_every_s)

    # Calibration captures waiting for a camera's next frame. Nothing keeps a frame around for them.
    waiting: dict[str, list[Future[bytes]]] = {}
    waiting_lock = Lock()

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        if recorder.enabled:
            log.warning("Recording training frames to %s", settings.record_dir)
        if demo:
            log.warning("Presenter view enabled at /demo: the latest masked frame of each camera can be viewed")
        if hasattr(detector, "warmup"):
            detector.warmup()
        worker.start()
        announcement = await run_in_threadpool(announce, settings.mdns_hostname, settings.port)
        yield
        if announcement:
            await run_in_threadpool(announcement.stop)
        worker.stop()

    app = FastAPI(title="Find my Bike Slot - Vision", version="0.2.0", lifespan=lifespan)
    app.state.worker = worker
    app.state.waiting = waiting

    @app.get("/healthz")
    def healthz() -> dict:
        return {"status": "ok", "recording": recorder.enabled, "model_ready": getattr(detector, "ready", True)}

    @app.post("/api/v1/frames")
    async def post_frame(request: Request) -> dict:
        """Frame from a camera node (see documentation/api.md, interface 1). Answers before the frame is analysed."""
        device_id = request.headers.get("x-device-id", "")
        if not DEVICE_ID_RE.match(device_id):
            raise HTTPException(400, "missing or invalid X-Device-Id")
        jpeg = await request.body()
        if not 0 < len(jpeg) <= MAX_FRAME_BYTES:
            raise HTTPException(413 if jpeg else 400, "bad frame size")
        if jpeg[:2] != b"\xff\xd8" or jpeg[-2:] != b"\xff\xd9":
            raise HTTPException(400, "body is not a complete JPEG")

        recorder.maybe_save(device_id, jpeg)
        with waiting_lock:
            for future in waiting.pop(device_id, ()):
                # A capture that just timed out is cancelled but may still be listed: it must not cost this frame.
                if not future.cancelled():
                    future.set_result(jpeg)
        worker.submit(
            device_id, Pending(jpeg, _number(request.headers.get("x-rssi")), _number(request.headers.get("x-uptime-s")))
        )
        return {"ok": True}

    @app.post("/api/v1/devices/{device_id}/calibration-capture")
    async def calibration_capture(device_id: str) -> Response:
        """A fresh frame of the camera with its faces masked. No masked image, no answer: the raw frame never leaves."""
        if not DEVICE_ID_RE.match(device_id):
            raise HTTPException(400, "invalid device id")
        future: Future[bytes] = Future()
        with waiting_lock:
            waiting.setdefault(device_id, []).append(future)
        try:
            jpeg = await asyncio.wait_for(asyncio.wrap_future(future), settings.capture_timeout_s)
        except TimeoutError:
            with waiting_lock:
                if future in waiting.get(device_id, ()):
                    waiting[device_id].remove(future)
                if not waiting.get(device_id):
                    waiting.pop(device_id, None)
            raise HTTPException(504, "No frame arrived from this camera") from None
        try:
            masked = await run_in_threadpool(anonymizer.anonymize, jpeg)
        except Exception as err:
            log.error("Anonymization failed for %s: %s", device_id, type(err).__name__)
            raise HTTPException(503, "The capture could not be anonymized, so it was not sent") from None
        finally:
            del jpeg
        return Response(masked, media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    if demo:

        @app.get("/demo", response_class=HTMLResponse)
        def demo_page() -> str:
            return DEMO_PAGE

        @app.get("/demo/cameras")
        def demo_cameras() -> list[dict]:
            return demo.cameras()

        @app.get("/demo/cameras/{device_id}/frame.jpg")
        async def demo_frame(device_id: str) -> Response:
            try:
                jpeg = await run_in_threadpool(demo.render, device_id)
            except Exception as err:
                log.error("Presenter view failed for %s: %s", device_id, type(err).__name__)
                raise HTTPException(503, "The frame could not be anonymized, so it was not sent") from None
            if jpeg is None:
                raise HTTPException(404, "No frame from this camera yet")
            return Response(jpeg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    return app


DEMO_PAGE = (Path(__file__).parent / "demo_view.html").read_text()
