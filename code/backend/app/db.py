"""SQLite store for the admin's configuration. Geometry and numbers only - never images or measurements."""

import json
import logging
import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError

from .models import ParkingLotConfig

log = logging.getLogger("uvicorn.error")

SCHEMA = """
CREATE TABLE IF NOT EXISTS parkings (
    id          TEXT PRIMARY KEY,
    updated_at  TEXT NOT NULL,   -- when the admin last saved it (UTC)
    config_json TEXT NOT NULL    -- one ParkingLotConfig (zones, sub-zones, cameras and their views)
);
"""


def utc_iso(dt: datetime) -> str:
    """Canonical timestamp format: 2026-10-31T10:15:02Z"""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _usable(config_json: str) -> dict | None:
    """A row saved under an older schema can't be read as one: it's skipped, not a crash on every request."""
    try:
        return ParkingLotConfig.model_validate_json(config_json).model_dump(mode="json", exclude_none=True)
    except ValidationError:
        try:
            parking_id = json.loads(config_json).get("id")
        except (ValueError, AttributeError):
            parking_id = "?"
        log.warning("Ignoring a saved parking that no longer matches the schema: %s", parking_id)
        return None


class Store:
    def __init__(self, path: str | Path):
        if str(path) != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        # FastAPI serves requests from a thread pool: share one connection, serialized by a lock.
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(SCHEMA)

    def parkings(self) -> list[dict]:
        """Every saved parking, in the order they were created."""
        with self._lock:
            rows = self._conn.execute("SELECT config_json FROM parkings ORDER BY rowid").fetchall()
        return [parking for parking in (_usable(r["config_json"]) for r in rows) if parking]

    def parking(self, parking_id: str) -> dict | None:
        with self._lock:
            row = self._conn.execute("SELECT config_json FROM parkings WHERE id = ?", (parking_id,)).fetchone()
        return _usable(row["config_json"]) if row else None

    def save_parking(self, parking: ParkingLotConfig) -> None:
        config = parking.model_dump_json(exclude_none=True)
        with self._lock:
            self._conn.execute(
                """INSERT INTO parkings (id, updated_at, config_json) VALUES (?, ?, ?)
                   ON CONFLICT (id) DO UPDATE
                   SET updated_at = excluded.updated_at, config_json = excluded.config_json""",
                (parking.id, utc_iso(datetime.now(UTC)), config),
            )
            self._conn.commit()

    def delete_parking(self, parking_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM parkings WHERE id = ?", (parking_id,))
            self._conn.commit()
            return cur.rowcount > 0
