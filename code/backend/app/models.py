"""Request schemas. FastAPI validates every incoming payload against these models."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class SlotState(BaseModel):
    slot_id: str = Field(min_length=1, max_length=64, examples=["s1"])
    state: Literal["free", "occupied", "unknown"]
    conf: float = Field(ge=0.0, le=1.0, description="Detection confidence, 0..1")


class Observation(BaseModel):
    """Vision result for one frame of one camera. Never contains image data."""

    device_id: str = Field(min_length=1, max_length=64, examples=["cam-memox-nord"])
    ts: datetime = Field(description="Capture/analysis time (ISO 8601, UTC)")
    slots: list[SlotState] = Field(min_length=1, max_length=256)
