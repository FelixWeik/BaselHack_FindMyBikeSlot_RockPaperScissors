"""Bike detection. Any object with a `detect(jpeg) -> list[Box]` method can be plugged in."""

import io
import logging
import threading
from typing import Protocol

from .geometry import Box

log = logging.getLogger("uvicorn.error")


class Detector(Protocol):
    def detect(self, jpeg: bytes) -> list[Box]: ...


class ModelNotReady(RuntimeError):
    """The model is still loading; the frame is accepted but not analysed."""


class YoloDetector:
    """Ultralytics YOLO (.pt or .onnx).

    Loading takes several seconds, longer than the camera's HTTP timeout, so `warmup()` loads the
    model in the background at startup and `detect()` fails fast until it is ready.
    """

    def __init__(self, model_path: str, bike_classes: tuple[str, ...], min_confidence: float):
        self.model_path = model_path
        self.bike_classes = {c.strip() for c in bike_classes if c.strip()}
        self.min_confidence = min_confidence
        self._model = None
        self._class_ids: list[int] = []
        self._load_lock = threading.Lock()
        self._infer_lock = threading.Lock()  # inference is not thread-safe

    def warmup(self) -> None:
        threading.Thread(target=self._load, name="model-warmup", daemon=True).start()

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

    def detect(self, jpeg: bytes) -> list[Box]:
        if self._model is None:
            raise ModelNotReady(self.model_path)
        from PIL import Image

        image = Image.open(io.BytesIO(jpeg)).convert("RGB")
        with self._infer_lock:
            result = self._model.predict(image, classes=self._class_ids, conf=self.min_confidence, verbose=False)[0]
        names = result.names
        return [
            Box(*map(float, xyxy), conf=float(conf), label=names[int(cls)])
            for xyxy, conf, cls in zip(
                result.boxes.xyxy.tolist(), result.boxes.conf.tolist(), result.boxes.cls.tolist(), strict=True
            )
        ]
