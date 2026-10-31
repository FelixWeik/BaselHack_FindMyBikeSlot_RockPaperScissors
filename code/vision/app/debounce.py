"""Suppresses single-frame flicker (a person walking past, a detection dropping out for one frame)."""

from .slots import SlotResult


class Debouncer:
    def __init__(self, frames: int):
        self.frames = max(1, frames)
        self._stable: dict[tuple[str, str], SlotResult] = {}
        self._pending: dict[tuple[str, str], tuple[str, int]] = {}

    def update(self, device_id: str, raw: list[SlotResult]) -> list[SlotResult]:
        out = []
        for r in raw:
            key = (device_id, r.slot_id)
            stable = self._stable.get(key)
            if stable is None or stable.state == r.state:
                # First observation, or no change: accept and refresh the confidence.
                self._stable[key] = r
                self._pending.pop(key, None)
            else:
                state, count = self._pending.get(key, (r.state, 0))
                count = count + 1 if state == r.state else 1
                if count >= self.frames:
                    self._stable[key] = r
                    self._pending.pop(key, None)
                else:
                    self._pending[key] = (r.state, count)
            out.append(self._stable[key])
        return out
