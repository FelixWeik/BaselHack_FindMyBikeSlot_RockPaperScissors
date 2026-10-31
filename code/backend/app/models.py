"""Request schemas. FastAPI validates every incoming payload against these models."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SlotState(BaseModel):
    slot_id: str = Field(min_length=1, max_length=64, examples=["s1"])
    state: Literal["free", "occupied", "unknown"]
    conf: float = Field(ge=0.0, le=1.0, description="Detection confidence, 0..1")


class Observation(BaseModel):
    """Vision result for one frame of one camera. Never contains image data."""

    device_id: str = Field(min_length=1, max_length=64, examples=["cam-memox-nord"])
    ts: datetime = Field(description="Capture/analysis time (ISO 8601, UTC)")
    slots: list[SlotState] = Field(min_length=1, max_length=256)


class ConfigModel(BaseModel):
    """Field names mirror code/types/parkingLotConfig.ts. Unknown fields are refused, so a schema drift fails loudly."""

    model_config = ConfigDict(extra="forbid")


class Point(ConfigModel):
    x: float
    y: float


class ImagePoint(ConfigModel):
    """Position in a camera image, normalized so it doesn't depend on the resolution."""

    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)


class ParkingRegion(ConfigModel):
    id: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, max_length=120)
    cameraIds: list[str] | None = None
    slotCount: int | None = Field(default=None, ge=0)
    boundary: list[Point] = Field(min_length=3, max_length=64)
    imagePolygon: list[ImagePoint] | None = Field(default=None, max_length=64)


class ParkingGeometry(ConfigModel):
    regions: list[ParkingRegion] = Field(max_length=256)


class ParkingCamera(ConfigModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(max_length=120)
    position: Point | None = None
    headingDeg: float | None = None
    rangeMeters: float | None = None
    calibratedAt: datetime | None = None


class SlotSize(ConfigModel):
    widthMeters: float = Field(ge=0.0)
    lengthMeters: float = Field(ge=0.0)


class OpeningWindow(ConfigModel):
    start: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


class ParkingSchedule(ConfigModel):
    timezone: str = Field(min_length=1, max_length=64)
    weekly: dict[Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"], list[OpeningWindow]]


class ParkingLotConfig(ConfigModel):
    """One zone of the admin: its sub-zones are the geometry's regions."""

    version: Literal[1]
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(max_length=120)
    totalSlots: int = Field(ge=0)
    geometry: ParkingGeometry
    slotSize: SlotSize
    schedule: ParkingSchedule
    cameras: list[ParkingCamera] = Field(max_length=64)
