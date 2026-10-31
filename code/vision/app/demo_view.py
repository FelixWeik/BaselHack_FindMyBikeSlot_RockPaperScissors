"""Presenter view: what a camera sees right now, with the detected bikes boxed and faces masked.

Meant for showing or filming the system, so it is off unless DEMO_VIEW=1. Only the latest frame of each camera
is kept, in memory, and replaced by the next one. A frame only leaves this service masked, like a calibration
capture: if masking fails, nothing is sent.
"""

import io
import threading
import time
from dataclasses import dataclass

from .anonymizer import Anonymizer
from .detector import Detection

BOX_COLOR = (34, 197, 94)


@dataclass(frozen=True)
class Latest:
    jpeg: bytes
    bikes: tuple[Detection, ...]
    status: str
    at: float


class DemoView:
    def __init__(self, anonymizer: Anonymizer):
        self.anonymizer = anonymizer
        self._latest: dict[str, Latest] = {}
        # Masking is the expensive part (seconds of CPU): an open presenter page polls every second, so each frame
        # is masked once, not once per request.
        self._rendered: dict[str, tuple[bytes, tuple[Detection, ...], bytes]] = {}
        self._lock = threading.Lock()

    def update(self, device_id: str, jpeg: bytes, bikes: list[Detection], status: str) -> None:
        with self._lock:
            self._latest[device_id] = Latest(jpeg, tuple(bikes), status, time.time())

    def cameras(self) -> list[dict]:
        now = time.time()
        with self._lock:
            latest = dict(self._latest)
        return [
            {"id": device_id, "bikes": len(entry.bikes), "status": entry.status, "age_s": round(now - entry.at, 1)}
            for device_id, entry in sorted(latest.items())
        ]

    def render(self, device_id: str) -> bytes | None:
        """The latest frame, faces masked, bikes boxed. None if the camera has sent nothing yet."""
        with self._lock:
            entry = self._latest.get(device_id)
            cached = self._rendered.get(device_id)
        if entry is None:
            return None
        if cached and cached[0] == entry.jpeg and cached[1] == entry.bikes:
            return cached[2]
        rendered = draw_boxes(self.anonymizer.anonymize(entry.jpeg), entry.bikes)
        with self._lock:
            self._rendered[device_id] = (entry.jpeg, entry.bikes, rendered)
        return rendered


def draw_boxes(jpeg: bytes, bikes: tuple[Detection, ...]) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    image = Image.open(io.BytesIO(jpeg)).convert("RGB")
    draw = ImageDraw.Draw(image)
    width, height = image.size
    line = max(2, width // 200)
    font = ImageFont.load_default(size=max(12, width // 40))
    boxes = [(x1 * width, y1 * height, x2 * width, y2 * height) for x1, y1, x2, y2 in (bike.bbox for bike in bikes)]
    # Boxes first, labels after: otherwise a later box's outline cuts through an earlier label.
    for box in boxes:
        draw.rectangle(box, outline=BOX_COLOR, width=line)
    placed: list[Rect] = []
    for bike, box in zip(bikes, boxes, strict=True):
        label = f"bike {bike.conf:.0%}"
        _, _, text_w, text_h = draw.textbbox((0, 0), label, font=font, anchor="lt")
        tag = place_label(box, (text_w + 2 * line, text_h + 2 * line), placed, (width, height))
        placed.append(tag)
        draw.rectangle(tag, fill=BOX_COLOR)
        draw.text((tag[0] + line, tag[1] + line), label, fill=(0, 0, 0), font=font, anchor="lt")
    output = io.BytesIO()
    image.save(output, "JPEG", quality=85)
    return output.getvalue()


Rect = tuple[float, float, float, float]


def place_label(box: Rect, size: tuple[float, float], placed: list[Rect], image: tuple[int, int]) -> Rect:
    """Where a box's label goes: above it, else inside its top, else lower down, clear of the labels already placed.

    Bikes side by side in a rack give overlapping boxes whose labels would otherwise hide each other.
    """
    w, h = size
    left = max(0.0, min(box[0], image[0] - w))
    candidates = [box[1] - h, box[1]]
    candidates += [y for y in (p[3] for p in placed) if box[1] <= y <= box[3] - h]
    for top in sorted(set(candidates)):
        tag = (left, top, left + w, top + h)
        if top >= 0 and top + h <= image[1] and not any(_overlap(tag, p) for p in placed):
            return tag
    return (left, max(0.0, box[1] - h), left + w, max(0.0, box[1] - h) + h)


def _overlap(a: Rect, b: Rect) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]
