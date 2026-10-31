"""Runtime settings, read from environment variables."""

import os
from dataclasses import dataclass, field
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parents[1]


def _env_path(name: str) -> Path | None:
    value = os.getenv(name, "").strip()
    return Path(value) if value else None


@dataclass(frozen=True)
class Settings:
    backend_url: str = field(default_factory=lambda: os.getenv("BACKEND_URL", "http://localhost:8000"))
    model_path: str = field(default_factory=lambda: os.getenv("MODEL_PATH", "yolo11n.pt"))
    # Class names counted as a bike. Pretrained COCO models use "bicycle"; custom models may use "bike".
    bike_classes: tuple[str, ...] = field(
        default_factory=lambda: tuple(os.getenv("BIKE_CLASSES", "bicycle,bike").split(","))
    )
    min_confidence: float = field(default_factory=lambda: float(os.getenv("MIN_CONFIDENCE", "0.35")))
    # Share of a bike's ground footprint that must lie inside a slot polygon to mark it occupied.
    occupied_overlap: float = field(default_factory=lambda: float(os.getenv("OCCUPIED_OVERLAP", "0.3")))
    # A slot changes state only after this many consecutive frames agree (suppresses flicker).
    debounce_frames: int = field(default_factory=lambda: int(os.getenv("DEBOUNCE_FRAMES", "3")))
    slots_dir: Path = field(default_factory=lambda: _env_path("SLOTS_DIR") or SERVICE_DIR / "slots")
    # Opt-in dataset capture for model training. Unset = frames are never written to disk.
    record_dir: Path | None = field(default_factory=lambda: _env_path("RECORD_DIR"))
    record_every_s: float = field(default_factory=lambda: float(os.getenv("RECORD_EVERY_S", "10")))
