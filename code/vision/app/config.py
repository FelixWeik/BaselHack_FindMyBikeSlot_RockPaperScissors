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
    model_path: str = field(default_factory=lambda: os.getenv("MODEL_PATH", str(SERVICE_DIR / "models" / "bikes.pt")))
    # Class names counted as a bike. Pretrained COCO models use "bicycle"; custom models may use "bike".
    bike_classes: tuple[str, ...] = field(
        default_factory=lambda: tuple(os.getenv("BIKE_CLASSES", "bicycle,bike").split(","))
    )
    min_confidence: float = field(default_factory=lambda: float(os.getenv("MIN_CONFIDENCE", "0.25")))
    imgsz: int = field(default_factory=lambda: int(os.getenv("IMGSZ", "960")))
    # Under this mean brightness (0..255) the image says nothing about the bikes: not a measurement, not an empty zone.
    dark_below: float = field(default_factory=lambda: float(os.getenv("DARK_BELOW", "18")))
    # How long a calibration capture waits for the camera's next frame.
    capture_timeout_s: float = field(default_factory=lambda: float(os.getenv("CAPTURE_TIMEOUT_S", "5")))
    # Opt-in dataset capture for model training. Unset = frames are never written to disk.
    record_dir: Path | None = field(default_factory=lambda: _env_path("RECORD_DIR"))
    record_every_s: float = field(default_factory=lambda: float(os.getenv("RECORD_EVERY_S", "10")))
    # Presenter view at /demo (latest frame per camera, faces masked, bikes boxed). Off unless DEMO_VIEW=1.
    demo_view: bool = field(default_factory=lambda: os.getenv("DEMO_VIEW", "") == "1")
