"""Find my Bike Slot - backend API.

Run (from code/backend):  uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
Interactive docs:         http://localhost:8000/docs
"""

import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from .db import Store
from .heatmap import build_heatmap
from .models import Observation, ParkingLotConfig
from .parkings import load_parkings

log = logging.getLogger("uvicorn.error")
SERVICE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DB = SERVICE_DIR / "data" / "bikeslot.db"
DEFAULT_PARKINGS = SERVICE_DIR / "parkings"


def create_app(
    db_path: str | Path | None = None,
    parkings_dir: str | Path | None = None,
    stale_after_s: float | None = None,
) -> FastAPI:
    """App factory. Tests pass their own database and parkings so they never touch the real ones."""
    store = Store(db_path or os.getenv("DB_PATH", DEFAULT_DB))
    parkings = load_parkings(Path(parkings_dir or os.getenv("PARKINGS_DIR", DEFAULT_PARKINGS)))
    # A camera that has not reported for this long is treated as offline (its slots become unknown).
    stale_after_s = stale_after_s if stale_after_s is not None else float(os.getenv("STALE_AFTER_S", "60"))
    log.info("Loaded parkings: %s", sorted(parkings))

    app = FastAPI(title="Find my Bike Slot - Backend", version="0.2.0")
    # The web app may be served from another origin or a phone on the LAN. CORS_ORIGINS is a comma-separated list.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
        allow_methods=["GET", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
    )

    @app.get("/healthz")
    def healthz() -> dict:
        """Liveness probe."""
        return {"status": "ok"}

    @app.post("/api/v1/observations", status_code=201)
    def post_observation(obs: Observation) -> dict:
        """Accept a vision result (per-slot states only, no images)."""
        obs_id = store.add(obs)
        counts = {state: sum(s.state == state for s in obs.slots) for state in ("free", "occupied", "unknown")}
        log.info("Observation from %s: %s", obs.device_id, counts)
        return {"id": obs_id, "device_id": obs.device_id, **counts}

    @app.get("/api/v1/observations/latest")
    def latest_observations() -> list[dict]:
        """Debug view: most recent observation per device."""
        return store.latest_per_device()

    @app.get("/api/parkings")
    def list_parkings() -> list[dict]:
        """All parkings (`ParkingLotConfig[]`, see code/types/parkingLotConfig.ts)."""
        return [p.config.model_dump(by_alias=True, exclude_none=True) for p in parkings.values()]

    @app.get("/api/parkings/{parking_id}/heatmap")
    def parking_heatmap(parking_id: str) -> dict:
        """Live chance of a free slot per grid cell (`ParkingHeatmap`, see code/types/parkingHeatmap.ts)."""
        parking = parkings.get(parking_id)
        if parking is None:
            raise HTTPException(404, "unknown parking")
        return build_heatmap(parking, store.current_slot_states(stale_after_s))

    @app.get("/api/v1/devices")
    def devices() -> list[dict]:
        """Devices seen so far. The client compares them with the parkings' cameras to find the unassigned ones."""
        return store.devices()

    @app.get("/api/v1/parkings")
    def admin_parkings() -> list[dict]:
        """The zones set up in the admin, with their sub-zones and calibration."""
        return store.parkings()

    @app.put("/api/v1/parkings/{parking_id}")
    def put_parking(parking_id: str, parking: ParkingLotConfig) -> dict:
        """Create or replace a zone."""
        if parking.id != parking_id:
            raise HTTPException(status_code=422, detail="The id in the path and in the body differ")
        store.save_parking(parking)
        return parking.model_dump(mode="json", exclude_none=True)

    @app.delete("/api/v1/parkings/{parking_id}", status_code=204)
    def delete_parking(parking_id: str) -> Response:
        if not store.delete_parking(parking_id):
            raise HTTPException(status_code=404, detail="Unknown parking")
        return Response(status_code=204)

    return app


app = create_app()
