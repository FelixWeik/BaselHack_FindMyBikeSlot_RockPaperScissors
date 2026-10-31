"""SQLite store for vision results.

Only slot states and numbers are persisted - never images.
"""

import json
import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path

from .models import Observation

SCHEMA = """
CREATE TABLE IF NOT EXISTS observations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at TEXT NOT NULL,   -- when the backend received it (UTC)
    ts          TEXT NOT NULL,   -- capture/analysis time reported by vision (UTC)
    device_id   TEXT NOT NULL,
    slots_json  TEXT NOT NULL    -- [{"slot_id": "s1", "state": "free", "conf": 0.9}, ...]
);
CREATE INDEX IF NOT EXISTS idx_obs_device ON observations (device_id, id);
"""


def utc_iso(dt: datetime) -> str:
    """Canonical timestamp format: 2026-10-31T10:15:02Z"""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


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

    def add(self, obs: Observation) -> int:
        slots = json.dumps([s.model_dump() for s in obs.slots])
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO observations (received_at, ts, device_id, slots_json) VALUES (?, ?, ?, ?)",
                (utc_iso(datetime.now(UTC)), utc_iso(obs.ts), obs.device_id, slots),
            )
            self._conn.commit()
            return cur.lastrowid

    def latest_per_device(self) -> list[dict]:
        """Most recent observation of each device."""
        with self._lock:
            rows = self._conn.execute(
                """SELECT * FROM observations
                   WHERE id IN (SELECT MAX(id) FROM observations GROUP BY device_id)
                   ORDER BY device_id"""
            ).fetchall()
        return [
            {
                "device_id": r["device_id"],
                "ts": r["ts"],
                "received_at": r["received_at"],
                "slots": json.loads(r["slots_json"]),
            }
            for r in rows
        ]
