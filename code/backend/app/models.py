"""Request schemas. FastAPI validates every incoming payload against these models."""

from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .attribution import is_valid_polygon, overlapping_zones

Unit = Annotated[float, Field(ge=0.0, le=1.0)]


class Bike(BaseModel):
    bbox: tuple[Unit, Unit, Unit, Unit] = Field(description="x_min, y_min, x_max, y_max, normalized to 0..1")
    conf: Unit

    @model_validator(mode="after")
    def corners_in_order(self) -> Self:
        if self.bbox[0] > self.bbox[2] or self.bbox[1] > self.bbox[3]:
            raise ValueError("bbox corners are out of order")
        return self


class Observation(BaseModel):
    """Vision result for one frame of one camera. Never contains image data."""

    device_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$", examples=["cam-memox-nord"])
    ts: datetime = Field(description="Capture/analysis time (ISO 8601, UTC)")
    status: Literal["ok", "dark", "failed", "not_ready"] = Field(
        description="Only `ok` is a measurement: the other ones say the camera is alive but its image told us nothing"
    )
    bikes: list[Bike] = Field(default_factory=list, max_length=512)
    rssi: int | None = None
    uptime_s: int | None = None


class ConfigModel(BaseModel):
    """Field names mirror code/types/parkingLotConfig.ts. Unknown fields are refused, so a schema drift fails loudly."""

    model_config = ConfigDict(extra="forbid")


class Point(ConfigModel):
    x: float
    y: float


class ImagePoint(ConfigModel):
    """Position in a camera image, normalized so it doesn't depend on the resolution."""

    x: Unit
    y: Unit


class ParkingRegion(ConfigModel):
    """A physical zone: its capacity lives here and nowhere else, whichever cameras watch it."""

    id: str = Field(min_length=1, max_length=64)
    name: str | None = Field(default=None, max_length=120)
    slotCount: int = Field(ge=1)
    boundary: list[Point] = Field(min_length=3, max_length=64)


class ParkingGeometry(ConfigModel):
    regions: list[ParkingRegion] = Field(max_length=256)


class CameraView(ConfigModel):
    """How one camera sees one zone."""

    regionId: str = Field(min_length=1, max_length=64)
    polygon: list[ImagePoint] = Field(min_length=3, max_length=64)


class ParkingCamera(ConfigModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    name: str = Field(max_length=120)
    position: Point | None = None
    headingDeg: float | None = None
    rangeMeters: float | None = None
    calibratedAt: datetime | None = None
    views: list[CameraView] | None = Field(default=None, max_length=256)


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

    @model_validator(mode="after")
    def views_are_consistent(self) -> Self:
        regions = [region.id for region in self.geometry.regions]
        if len(set(regions)) != len(regions):
            raise ValueError("region ids must be unique")
        cameras = [camera.id for camera in self.cameras]
        if len(set(cameras)) != len(cameras):
            raise ValueError("camera ids must be unique")
        for camera in self.cameras:
            views = camera.views or []
            zones = {view.regionId: [(p.x, p.y) for p in view.polygon] for view in views}
            if len(zones) != len(views):
                raise ValueError(f"camera {camera.id} has two polygons for one region")
            unknown = zones.keys() - set(regions)
            if unknown:
                raise ValueError(f"camera {camera.id} refers to unknown regions: {sorted(unknown)}")
            invalid = [zone for zone, polygon in zones.items() if not is_valid_polygon(polygon)]
            if invalid:
                raise ValueError(f"camera {camera.id} has invalid polygons for: {sorted(invalid)}")
            overlaps = overlapping_zones(zones)
            if overlaps:
                raise ValueError(f"camera {camera.id} has ambiguous overlapping polygons: {overlaps}")
        return self
