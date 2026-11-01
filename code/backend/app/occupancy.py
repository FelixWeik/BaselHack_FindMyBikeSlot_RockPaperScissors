"""From the last frames of each camera to the occupancy of each zone.

Everything is computed when read, from the latest bike boxes and the parking's current configuration. A changed
capacity or polygon therefore applies at once to every camera, and no result ever outlives what it was made from.
Measurements are kept in memory only: after a restart they are simply unknown for a few seconds.
"""

import statistics
import threading
from collections import deque
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from .attribution import BBox, Polygon, count_by_zone

# Consecutive frames disagree by a bike or two (occlusion, a borderline confidence): the median steadies the count.
FRAMES_PER_READING = 5


@dataclass(frozen=True)
class Frame:
    received_at: float  # the backend's clock, so a camera or vision host with a wrong time can't fake freshness
    status: str  # "ok" means analysed; anything else is not a measurement, and certainly not an empty zone
    bboxes: tuple[BBox, ...]


@dataclass(frozen=True)
class DeviceInfo:
    last_seen: float
    status: str
    rssi: int | None
    uptime_s: int | None


class Measurements:
    """The latest frames of each camera. FastAPI serves requests from a thread pool, hence the lock."""

    def __init__(self) -> None:
        self._frames: dict[str, deque[Frame]] = {}
        self._devices: dict[str, DeviceInfo] = {}
        self._overrides: dict[tuple[str, str], int] = {}
        self._lock = threading.Lock()

    def add(self, device_id: str, frame: Frame, rssi: int | None = None, uptime_s: int | None = None) -> None:
        with self._lock:
            self._frames.setdefault(device_id, deque(maxlen=FRAMES_PER_READING)).append(frame)
            self._devices[device_id] = DeviceInfo(frame.received_at, frame.status, rssi, uptime_s)

    def frames(self, device_id: str, now: float, ttl_s: float) -> list[Frame]:
        """The usable frames, newest last. None at all once the camera's latest analysis failed or went stale."""
        with self._lock:
            frames = list(self._frames.get(device_id, ()))
        if not frames or frames[-1].status != "ok" or now - frames[-1].received_at > ttl_s:
            return []
        return [f for f in frames if f.status == "ok" and now - f.received_at <= ttl_s]

    def devices(self) -> dict[str, DeviceInfo]:
        with self._lock:
            return dict(self._devices)

    def device(self, device_id: str) -> DeviceInfo | None:
        with self._lock:
            return self._devices.get(device_id)

    def override(self, parking_id: str, zone_id: str, detected: int) -> None:
        """Demo only: pins a zone's bike count, whatever the cameras see. Kept in memory, never saved."""
        with self._lock:
            self._overrides[(parking_id, zone_id)] = detected

    def overrides(self) -> dict[tuple[str, str], int]:
        with self._lock:
            return dict(self._overrides)

    def clear_overrides(self) -> None:
        with self._lock:
            self._overrides.clear()


def utc_iso(timestamp: float | None) -> str | None:
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def camera_counts(frames: Sequence[Frame], zones: dict[str, Polygon]) -> dict[str, int]:
    """Bikes per zone for one camera over its usable frames: the median, rounded down between two frames."""
    per_frame = [count_by_zone(frame.bboxes, zones) for frame in frames]
    return {zone: statistics.median_low(counts[zone] for counts in per_frame) for zone in zones}


Fusion = Callable[[Sequence[float]], float]


def mean_fusion(occupancies: Sequence[float]) -> float:
    """V1: each camera that has a good view of the zone gets an equal say."""
    return sum(occupancies) / len(occupancies)


def _views_of(camera: dict[str, Any]) -> dict[str, Polygon]:
    return {v["regionId"]: [(p["x"], p["y"]) for p in v["polygon"]] for v in camera.get("views") or []}


def camera_occupancy(parking: dict[str, Any], measurements: Measurements, now: float, ttl_s: float) -> list[dict]:
    """Each camera's own reading of the zones it watches. Capacities always come from the parking's zones."""
    capacities = {r["id"]: r["slotCount"] for r in parking["geometry"]["regions"]}
    result = []
    for camera in parking["cameras"]:
        camera_id = camera["id"]
        views = {zone: polygon for zone, polygon in _views_of(camera).items() if zone in capacities}
        frames = measurements.frames(camera_id, now, ttl_s)
        info = measurements.device(camera_id)
        online = info is not None and now - info.last_seen <= ttl_s
        counts = camera_counts(frames, views) if frames else None
        zones = []
        for zone in views:
            raw = counts[zone] / capacities[zone] if counts is not None else None
            zones.append(
                {
                    "zoneId": zone,
                    "capacity": capacities[zone],
                    "detected": counts[zone] if counts is not None else None,
                    "rawOccupancy": raw,
                    "occupancy": min(raw, 1.0) if raw is not None else None,
                    "status": "valid" if counts is not None else "unknown",
                }
            )
        result.append(
            {
                "cameraId": camera_id,
                "online": online,
                "analysis": (info.status if online else "offline") if info else "offline",
                "updatedAt": utc_iso(frames[-1].received_at) if frames else None,
                "zones": zones,
            }
        )
    return result


def parking_occupancy(
    parking: dict[str, Any],
    measurements: Measurements,
    now: float,
    ttl_s: float,
    fusion: Fusion = mean_fusion,
) -> dict:
    """The estimate per physical zone, merged across the cameras that hold a valid reading of it."""
    cameras = camera_occupancy(parking, measurements, now, ttl_s)
    overrides = measurements.overrides()
    zones = []
    for region in parking["geometry"]["regions"]:
        zone_id = region["id"]
        capacity = region["slotCount"]
        if (parking["id"], zone_id) in overrides:
            detected = overrides[(parking["id"], zone_id)]
            zones.append(
                {
                    "zoneId": zone_id,
                    "capacity": capacity,
                    "detected": detected,
                    "occupancy": min(detected / capacity, 1.0),
                    "overflow": detected > capacity,
                    "status": "valid",
                    "cameraCount": 1,
                    "updatedAt": utc_iso(now),
                }
            )
            continue
        readings = [
            (zone, camera["updatedAt"])
            for camera in cameras
            for zone in camera["zones"]
            if zone["zoneId"] == zone_id and zone["status"] == "valid"
        ]
        if readings:
            # Merged before bounding: a camera reading 25/20 and one reading 15/20 agree on 20/20, not on 17.5/20.
            merged = fusion([zone["rawOccupancy"] for zone, _ in readings])
            detected = sum(zone["detected"] for zone, _ in readings) / len(readings)
            zones.append(
                {
                    "zoneId": zone_id,
                    "capacity": capacity,
                    "detected": detected,
                    "occupancy": min(merged, 1.0),
                    "overflow": merged > 1.0,
                    "status": "valid",
                    "cameraCount": len(readings),
                    "updatedAt": max(updated for _, updated in readings),
                }
            )
        else:
            zones.append(
                {
                    "zoneId": zone_id,
                    "capacity": capacity,
                    "detected": None,
                    "occupancy": None,
                    "overflow": False,
                    "status": "unknown",
                    "cameraCount": 0,
                    "updatedAt": None,
                }
            )
    times = [zone["updatedAt"] for zone in zones if zone["updatedAt"]]
    return {"parkingId": parking["id"], "updatedAt": max(times, default=None), "zones": zones}
