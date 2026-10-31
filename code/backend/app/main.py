"""Find my Bike Slot - backend API.

Run (from code/backend):  uv run uvicorn app.main:app --reload --port 8000
Interactive docs:         http://localhost:8000/docs
"""

import logging
import os
from pathlib import Path

from fastapi import FastAPI

from .db import Store
from .models import Observation

log = logging.getLogger("uvicorn.error")
DEFAULT_DB = Path(__file__).resolve().parents[1] / "data" / "bikeslot.db"


def create_app(db_path: str | Path | None = None) -> FastAPI:
    """App factory. Tests pass their own database path so they never touch the real one."""
    store = Store(db_path or os.getenv("DB_PATH", DEFAULT_DB))
    app = FastAPI(title="Find my Bike Slot - Backend", version="0.1.0")

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

    return app


app = create_app()
