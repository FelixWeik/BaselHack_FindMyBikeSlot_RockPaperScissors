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
        if entry is None:
            return None
        return draw_boxes(self.anonymizer.anonymize(entry.jpeg), entry.bikes)


def draw_boxes(jpeg: bytes, bikes: tuple[Detection, ...]) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    image = Image.open(io.BytesIO(jpeg)).convert("RGB")
    draw = ImageDraw.Draw(image)
    width, height = image.size
    line = max(2, width // 200)
    font = ImageFont.load_default(size=max(12, width // 40))
    for bike in bikes:
        x1, y1, x2, y2 = bike.bbox
        box = (x1 * width, y1 * height, x2 * width, y2 * height)
        draw.rectangle(box, outline=BOX_COLOR, width=line)
        label = f"bike {bike.conf:.0%}"
        _, _, text_w, text_h = draw.textbbox((0, 0), label, font=font, anchor="lt")
        top = max(0, box[1] - text_h - 2 * line)  # above the box, or inside it at the image's top edge
        draw.rectangle((box[0], top, box[0] + text_w + 2 * line, top + text_h + 2 * line), fill=BOX_COLOR)
        draw.text((box[0] + line, top + line), label, fill=(0, 0, 0), font=font, anchor="lt")
    output = io.BytesIO()
    image.save(output, "JPEG", quality=85)
    return output.getvalue()
