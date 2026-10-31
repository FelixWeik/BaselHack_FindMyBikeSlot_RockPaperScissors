"""Parking configuration: site plan, regions and where each camera slot is on the plan.

The models mirror `code/types/parkingLotConfig.ts` and are serialized in camelCase for the frontend.
One file per parking in `parkings/<id>.json`.
"""

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

Weekday = Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
WEEKDAYS: tuple[Weekday, ...] = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Point(CamelModel):
    x: float
    y: float


class ParkingRegion(CamelModel):
    id: str | None = None
    name: str | None = None
    camera_ids: list[str] | None = None
    slot_count: int | None = Field(default=None, ge=0)
    boundary: list[Point] = Field(min_length=3)


class ParkingCamera(CamelModel):
    """A camera's place on the site plan (used by the admin panel to draw its field of view)."""

    id: str
    name: str
    position: Point
    heading_deg: float
    range_meters: float = Field(gt=0)


class Geometry(CamelModel):
    regions: list[ParkingRegion] = Field(min_length=1)


class SlotSize(CamelModel):
    width_meters: float = Field(gt=0)
    length_meters: float = Field(gt=0)


class OpeningWindow(CamelModel):
    start: str = Field(pattern=r"^([01]\d|2[0-4]):[0-5]\d$")
    end: str = Field(pattern=r"^([01]\d|2[0-4]):[0-5]\d$")


class Schedule(CamelModel):
    timezone: str
    weekly: dict[Weekday, list[OpeningWindow]]

    @model_validator(mode="after")
    def all_days_present(self):
        missing = set(WEEKDAYS) - set(self.weekly)
        if missing:
            raise ValueError(f"schedule.weekly is missing {sorted(missing)}")
        return self


class ParkingLotConfig(CamelModel):
    version: Literal[1] = 1
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    name: str
    total_slots: int = Field(ge=0)
    geometry: Geometry
    slot_size: SlotSize
    schedule: Schedule
    cameras: list[ParkingCamera] = Field(default_factory=list)


class SlotPlacement(CamelModel):
    """Where a slot seen by a camera lies on the site plan (metres)."""

    device_id: str
    slot_id: str
    region: str
    x: float
    y: float


class Parking(CamelModel):
    config: ParkingLotConfig
    slots: list[SlotPlacement] = Field(default_factory=list)

    @model_validator(mode="after")
    def slots_reference_known_regions(self):
        regions = {r.id for r in self.config.geometry.regions}
        unknown = {s.region for s in self.slots} - regions
        if unknown:
            raise ValueError(f"slots reference unknown regions {sorted(unknown)}")
        keys = [(s.device_id, s.slot_id) for s in self.slots]
        if len(keys) != len(set(keys)):
            raise ValueError("each (deviceId, slotId) may only be placed once")
        return self


def load_parkings(directory: Path) -> dict[str, Parking]:
    """Loads and validates all parkings; fails at startup rather than serving a broken config."""
    parkings: dict[str, Parking] = {}
    for path in sorted(directory.glob("*.json")):
        parking = Parking.model_validate_json(path.read_text())
        if parking.config.id in parkings:
            raise ValueError(f"duplicate parking id {parking.config.id!r} in {path.name}")
        parkings[parking.config.id] = parking
    return parkings
