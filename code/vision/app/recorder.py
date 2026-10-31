"""Opt-in capture of training images. Disabled unless RECORD_DIR is set."""

import time
from datetime import UTC, datetime
from pathlib import Path


class Recorder:
    def __init__(self, directory: Path | None, every_s: float):
        self.directory = directory
        self.every_s = every_s
        self._last: dict[str, float] = {}

    @property
    def enabled(self) -> bool:
        return self.directory is not None

    def maybe_save(self, device_id: str, jpeg: bytes) -> Path | None:
        """Saves at most one frame per camera every `every_s` seconds; consecutive frames are near-duplicates."""
        if self.directory is None:
            return None
        now = time.monotonic()
        if now - self._last.get(device_id, -self.every_s) < self.every_s:
            return None
        self._last[device_id] = now
        target = self.directory / device_id
        target.mkdir(parents=True, exist_ok=True)
        path = target / f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%S_%fZ')}.jpg"
        path.write_bytes(jpeg)
        return path
