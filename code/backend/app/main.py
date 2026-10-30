"""Find my Bike Slot – Backend.

Starten (im Ordner code/backend):  uv run uvicorn app.main:app --reload --port 8000
Testseite im Browser:              http://localhost:8000/docs
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
    """Baut die App. Tests übergeben eine eigene Datenbank, damit sie die echte nicht anfassen."""
    store = Store(db_path or os.getenv("DB_PATH", DEFAULT_DB))
    app = FastAPI(title="Find my Bike Slot – Backend", version="0.1.0")

    @app.get("/healthz")
    def healthz() -> dict:
        """Lebenszeichen: Antwortet, solange das Backend läuft."""
        return {"status": "ok"}

    @app.post("/api/v1/observations", status_code=201)
    def post_observation(obs: Observation) -> dict:
        """Ergebnis der Auswertung annehmen (nur Zustände pro Stellplatz, keine Bilder)."""
        obs_id = store.add(obs)
        counts = {state: sum(s.state == state for s in obs.slots) for state in ("free", "occupied", "unknown")}
        log.info("Ergebnis von %s: %s", obs.device_id, counts)
        return {"id": obs_id, "device_id": obs.device_id, **counts}

    @app.get("/api/v1/observations/latest")
    def latest_observations() -> list[dict]:
        """Zur Kontrolle: die neueste Nachricht jeder Kamera."""
        return store.latest_per_device()

    return app


app = create_app()
