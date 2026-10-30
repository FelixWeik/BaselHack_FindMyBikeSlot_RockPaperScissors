"""Wie Nachrichten aussehen müssen. FastAPI prüft jede eingehende Nachricht gegen diese Klassen."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class SlotState(BaseModel):
    slot_id: str = Field(min_length=1, max_length=64, examples=["s1"])
    state: Literal["free", "occupied", "unknown"]
    conf: float = Field(ge=0.0, le=1.0, description="Wie sicher ist die Auswertung? 0..1")


class Observation(BaseModel):
    """Ergebnis der Auswertung für ein Foto einer Kamera. Enthält nie Bilddaten."""

    device_id: str = Field(min_length=1, max_length=64, examples=["cam-memox-nord"])
    ts: datetime = Field(description="Zeitpunkt der Aufnahme/Auswertung (ISO 8601, UTC)")
    slots: list[SlotState] = Field(min_length=1, max_length=256)
