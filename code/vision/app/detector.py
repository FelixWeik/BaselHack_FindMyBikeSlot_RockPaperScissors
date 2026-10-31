"""Bike detection. Any object with a `detect(jpeg) -> list[Detection]` method can be plugged in."""

import io
import logging
import threading
from dataclasses import dataclass
from typing import Protocol

log = logging.getLogger("uvicorn.error")


@dataclass(frozen=True)
class Detection:
    """A bike's box, normalized to 0..1 so it doesn't depend on the camera's resolution."""

    bbox: tuple[float, float, float, float]
    conf: float


class Detector(Protocol):
    def detect(self, jpeg: bytes) -> list[Detection]: ...


class ModelNotReady(RuntimeError):
    """The model is still loading; the frame is accepted but not analysed."""


class TooDark(RuntimeError):
    """The image is too dark to see bikes in: that's not the same as seeing none."""


def _unit(value: float) -> float:
    return min(max(value, 0.0), 1.0)


def is_too_dark(image, threshold: float) -> bool:
    """`image` is a PIL image."""
    from PIL import ImageStat

    return ImageStat.Stat(image.convert("L")).mean[0] < threshold


class YoloDetector:
    """Ultralytics YOLO (.pt or .onnx).

    Loading takes several seconds, so `warmup()` loads the model in the background at startup and `detect()` fails
    fast until it is ready.
    """

    def __init__(self, model_path: str, bike_classes: tuple[str, ...], min_confidence: float, imgsz: int, dark: float):
        self.model_path = model_path
        self.bike_classes = {c.strip() for c in bike_classes if c.strip()}
        self.min_confidence = min_confidence
        self.imgsz = imgsz
        self.dark = dark
        self._model = None
        self._class_ids: list[int] = []
        self._load_lock = threading.Lock()

    def warmup(self) -> None:
        threading.Thread(target=self._load, name="model-warmup", daemon=True).start()

    @property
    def ready(self) -> bool:
        return self._model is not None

    def _load(self) -> None:
        with self._load_lock:
            if self._model is not None:
                return
            try:
                from ultralytics import YOLO  # heavy import, only when needed

                model = YOLO(self.model_path)
                self._class_ids = [i for i, name in model.names.items() if name in self.bike_classes]
                if not self._class_ids:
                    raise ValueError(f"model has none of the classes {sorted(self.bike_classes)}: {model.names}")
            except Exception:
                log.exception("Could not load model %s", self.model_path)
                return
            log.info("Loaded %s, bike classes: %s", self.model_path, [model.names[i] for i in self._class_ids])
            self._model = model

    def detect(self, jpeg: bytes) -> list[Detection]:
        if self._model is None:
            raise ModelNotReady(self.model_path)
        from PIL import Image

        image = Image.open(io.BytesIO(jpeg)).convert("RGB")
        if is_too_dark(image, self.dark):
            raise TooDark
        width, height = image.size
        result = self._model.predict(
            image, classes=self._class_ids, conf=self.min_confidence, imgsz=self.imgsz, verbose=False, save=False
        )[0]
        return [
            Detection((_unit(x0 / width), _unit(y0 / height), _unit(x1 / width), _unit(y1 / height)), float(conf))
            for (x0, y0, x1, y1), conf in zip(result.boxes.xyxy.tolist(), result.boxes.conf.tolist(), strict=True)
        ]
