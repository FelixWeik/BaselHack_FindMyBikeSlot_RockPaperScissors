"""Find my Bike Slot - backend API.

Run (from code/backend):  uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
Interactive docs:         http://localhost:8000/docs
"""

import contextlib
import logging
import os
import time
from collections.abc import Callable
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from .db import Store
from .models import Observation, ParkingLotConfig
from .occupancy import Frame, Measurements, camera_occupancy, parking_occupancy, utc_iso

log = logging.getLogger("uvicorn.error")
SERVICE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DB = SERVICE_DIR / "data" / "bikeslot.db"
CAPTURE_TIMEOUT_S = 60  # the first capture loads the face detector

Capture = Callable[[str], httpx.Response]


def vision_capture(vision_url: str) -> Capture:
    def capture(camera_id: str) -> httpx.Response:
        url = f"{vision_url.rstrip('/')}/api/v1/devices/{camera_id}/calibration-capture"
        return httpx.post(url, timeout=CAPTURE_TIMEOUT_S)

    return capture


def create_app(
    db_path: str | Path | None = None,
    measurement_ttl_s: float | None = None,
    clock: Callable[[], float] = time.time,
    capture: Capture | None = None,
) -> FastAPI:
    """App factory. Tests pass their own database, clock and camera so they never touch the real ones."""
    store = Store(db_path or os.getenv("DB_PATH", DEFAULT_DB))
    measurements = Measurements()
    # Older measurements no longer count, and a camera silent for this long is offline.
    ttl_s = measurement_ttl_s if measurement_ttl_s is not None else float(os.getenv("MEASUREMENT_TTL_S", "30"))
    capture = capture or vision_capture(os.getenv("VISION_URL", "http://localhost:8001"))

    app = FastAPI(title="Find my Bike Slot - Backend", version="0.3.0")
    # The web app may be served from another origin or a phone on the LAN. CORS_ORIGINS is a comma-separated list.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
    )

    def require_parking(parking_id: str) -> dict:
        parking = store.parking(parking_id)
        if parking is None:
            raise HTTPException(status_code=404, detail="Unknown parking")
        return parking

    @app.get("/healthz")
    def healthz() -> dict:
        """Liveness probe."""
        return {"status": "ok"}

    @app.post("/api/v1/observations", status_code=201)
    def post_observation(obs: Observation) -> dict:
        """Accept a vision result (bike boxes only, no images), whether or not the camera is calibrated yet."""
        frame = Frame(clock(), obs.status, tuple(bike.bbox for bike in obs.bikes))
        measurements.add(obs.device_id, frame, obs.rssi, obs.uptime_s)
        return {"device_id": obs.device_id, "status": obs.status, "bikes": len(obs.bikes)}

    @app.get("/api/v1/devices")
    def devices() -> list[dict]:
        """Devices heard since startup. The client compares them with the parkings' cameras to find the new ones."""
        now = clock()
        return [
            {
                "id": device_id,
                "name": device_id,
                "kind": "camera",
                "lastSeen": utc_iso(info.last_seen),
                "online": now - info.last_seen <= ttl_s,
                "analysis": info.status,
                "rssi": info.rssi,
            }
            for device_id, info in sorted(measurements.devices().items())
        ]

    @app.post("/api/v1/cameras/{camera_id}/calibration-capture")
    def calibration_capture(camera_id: str) -> Response:
        """The camera's next frame with faces masked by the vision service. Nothing is stored or cached on the way."""
        try:
            answer = capture(camera_id)
        except httpx.HTTPError as err:
            log.warning("Vision service unreachable: %s", type(err).__name__)
            raise HTTPException(status_code=503, detail="The vision service is unreachable") from err
        if answer.status_code != 200 or answer.headers.get("content-type") != "image/jpeg":
            detail = "The capture failed"
            with contextlib.suppress(ValueError, KeyError, TypeError):
                detail = answer.json()["detail"]
            raise HTTPException(status_code=answer.status_code if answer.status_code >= 400 else 502, detail=detail)
        return Response(answer.content, media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    @app.get("/api/v1/parkings")
    def admin_parkings() -> list[dict]:
        """The zones set up in the admin, with their sub-zones and calibration."""
        return store.parkings()

    @app.put("/api/v1/parkings/{parking_id}")
    def put_parking(parking_id: str, parking: ParkingLotConfig) -> dict:
        """Create or replace a zone."""
        if parking.id != parking_id:
            raise HTTPException(status_code=422, detail="The id in the path and in the body differ")
        cameras = {camera.id for camera in parking.cameras}
        for other in store.parkings():
            taken = cameras & {camera["id"] for camera in other["cameras"]} if other["id"] != parking_id else None
            if taken:
                raise HTTPException(status_code=409, detail=f"{sorted(taken)} already belong to {other['id']}")
        store.save_parking(parking)
        return parking.model_dump(mode="json", exclude_none=True)

    @app.delete("/api/v1/parkings/{parking_id}", status_code=204)
    def delete_parking(parking_id: str) -> Response:
        """Idempotent: the admin may delete a zone it never managed to save, and a retry must not fail."""
        store.delete_parking(parking_id)
        return Response(status_code=204)

    @app.get("/api/v1/parkings/{parking_id}/occupancy")
    def occupancy(parking_id: str) -> dict:
        """Estimated occupancy per physical zone, merged across cameras (`ParkingOccupancy`)."""
        return parking_occupancy(require_parking(parking_id), measurements, clock(), ttl_s)

    @app.get("/api/v1/parkings/{parking_id}/cameras")
    def cameras(parking_id: str) -> dict:
        """Each camera's own reading, before merging. For diagnosis: two cameras disagreeing shows here."""
        parking = require_parking(parking_id)
        return {"parkingId": parking_id, "cameras": camera_occupancy(parking, measurements, clock(), ttl_s)}

    return app


app = create_app()
