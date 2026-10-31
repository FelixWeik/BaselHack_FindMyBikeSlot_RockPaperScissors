"""Per-camera slot configuration and slot state evaluation."""

import json
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from .geometry import Box, footprint_overlap

SlotStateName = Literal["free", "occupied", "unknown"]
DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class Slot(BaseModel):
    slot_id: str = Field(min_length=1, max_length=64)
    polygon: list[tuple[float, float]] = Field(min_length=3, max_length=64, description="Image pixel coordinates")


class CameraSlots(BaseModel):
    device_id: str = Field(pattern=DEVICE_ID_RE.pattern)
    image_width: int = Field(default=640, gt=0)
    image_height: int = Field(default=480, gt=0)
    slots: list[Slot] = Field(default_factory=list, max_length=256)


class SlotResult(BaseModel):
    slot_id: str
    state: SlotStateName
    conf: float


class SlotStore:
    """Reads and writes slots/<device_id>.json."""

    def __init__(self, directory: Path):
        self.directory = directory

    def _path(self, device_id: str) -> Path:
        if not DEVICE_ID_RE.match(device_id):
            raise ValueError(f"invalid device id: {device_id!r}")
        return self.directory / f"{device_id}.json"

    def get(self, device_id: str) -> CameraSlots | None:
        path = self._path(device_id)
        if not path.exists():
            return None
        return CameraSlots.model_validate_json(path.read_text())

    def put(self, config: CameraSlots) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        self._path(config.device_id).write_text(json.dumps(config.model_dump(), indent=2) + "\n")


def evaluate(boxes: list[Box], slots: list[Slot], occupied_overlap: float) -> list[SlotResult]:
    """Raw (not debounced) state of every slot for one frame."""
    results = []
    for slot in slots:
        best_conf, best_overlap = 0.0, 0.0
        for box in boxes:
            overlap = footprint_overlap(box, slot.polygon)
            if overlap >= occupied_overlap and box.conf > best_conf:
                best_conf = box.conf
            best_overlap = max(best_overlap, overlap * box.conf)
        if best_conf > 0:
            results.append(SlotResult(slot_id=slot.slot_id, state="occupied", conf=round(best_conf, 3)))
        else:
            # Lower confidence for "free" when a detection partly touches the slot.
            results.append(SlotResult(slot_id=slot.slot_id, state="free", conf=round(1 - best_overlap, 3)))
    return results
