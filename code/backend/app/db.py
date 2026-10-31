"""SQLite store for vision results.

Only slot states and numbers are persisted - never images.
"""

import json
import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path

from .models import Observation, ParkingLotConfig

SCHEMA = """
CREATE TABLE IF NOT EXISTS observations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at TEXT NOT NULL,   -- when the backend received it (UTC)
    ts          TEXT NOT NULL,   -- capture/analysis time reported by vision (UTC)
    device_id   TEXT NOT NULL,
    slots_json  TEXT NOT NULL    -- [{"slot_id": "s1", "state": "free", "conf": 0.9}, ...]
);
CREATE INDEX IF NOT EXISTS idx_obs_device ON observations (device_id, id);
CREATE TABLE IF NOT EXISTS parkings (
    id          TEXT PRIMARY KEY,
    updated_at  TEXT NOT NULL,   -- when the admin last saved it (UTC)
    config_json TEXT NOT NULL    -- one ParkingLotConfig (zones, sub-zones, calibration)
);
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

    def current_slot_states(self, max_age_s: float, now: datetime | None = None) -> dict[tuple[str, str], str]:
        """State per (device_id, slot_id) from each device's latest observation.

        Devices silent for longer than `max_age_s` are left out, so their slots count as unknown
        instead of showing a stale state.
        """
        now = now or datetime.now(UTC)
        states = {}
        for obs in self.latest_per_device():
            received = datetime.strptime(obs["received_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
            if (now - received).total_seconds() > max_age_s:
                continue
            for slot in obs["slots"]:
                states[(obs["device_id"], slot["slot_id"])] = slot["state"]
        return states

    def parkings(self) -> list[dict]:
        """Every saved parking, in the order they were created."""
        with self._lock:
            rows = self._conn.execute("SELECT config_json FROM parkings ORDER BY rowid").fetchall()
        return [json.loads(r["config_json"]) for r in rows]

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

    def devices(self) -> list[dict]:
        """Every device that ever reported an observation, with the time of its latest one."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT device_id, MAX(ts) AS last_seen FROM observations GROUP BY device_id ORDER BY device_id"
            ).fetchall()
        return [
            {"id": r["device_id"], "name": r["device_id"], "kind": "camera", "lastSeen": r["last_seen"]} for r in rows
        ]
