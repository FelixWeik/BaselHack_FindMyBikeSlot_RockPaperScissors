"""Simulated cameras: real images sent exactly as a camera node sends them.

Everything after the camera runs as in production, so the bike counts are what the model really finds in these
images, errors included. Nothing here knows or decides a count, an occupancy or a zone.

Frames of one camera keep one viewpoint, otherwise the polygons drawn on it would mean nothing:
- sim-abri plays a shelter filling up and emptying (photomontages of one real shelter), so its count moves.
- sim-rack-N each show one real photo of the site, so their count stays the same.

Run (from code/vision, with the vision service running):  uv run python demo/demo_cameras.py
"""

import argparse
import contextlib
import io
import logging
import time
from dataclasses import dataclass
from pathlib import Path

import httpx
from PIL import Image

HERE = Path(__file__).resolve().parent
SITE_PHOTOS = HERE.parents[1] / "frontend" / "public" / "mock"
FRAME_SIZE = (1024, 768)  # like a camera node; the site photos are too large for the frame route otherwise
JPEG_QUALITY = 85

log = logging.getLogger("demo-cameras")


@dataclass(frozen=True)
class Camera:
    device_id: str
    frames: tuple[bytes, ...]


def to_camera_frame(path: Path) -> bytes:
    """A JPEG no larger than what a camera node sends."""
    image = Image.open(path).convert("RGB")
    image.thumbnail(FRAME_SIZE)
    output = io.BytesIO()
    image.save(output, "JPEG", quality=JPEG_QUALITY)
    return output.getvalue()


def load_cameras() -> list[Camera]:
    scenes = sorted((HERE / "frames").glob("*.jpg"))
    photos = sorted(SITE_PHOTOS.glob("*.jpg"))
    return [
        Camera("sim-abri", tuple(to_camera_frame(scene) for scene in scenes)),
        *(Camera(f"sim-rack-{i}", (to_camera_frame(photo),)) for i, photo in enumerate(photos, start=1)),
    ]


def frame_at(camera: Camera, elapsed_s: float, hold_s: float) -> bytes:
    """The scene a camera shows after `elapsed_s`, each one held for `hold_s`."""
    return camera.frames[int(elapsed_s / hold_s) % len(camera.frames)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--vision-url", default="http://localhost:8001")
    parser.add_argument("--hold", type=float, default=15, help="seconds each scene of a moving camera is shown")
    parser.add_argument("--fps", type=float, default=1, help="frames per second, per camera")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")

    cameras = load_cameras()
    log.info("%d cameras to %s: %s", len(cameras), args.vision_url, ", ".join(c.device_id for c in cameras))
    start = time.monotonic()
    with httpx.Client(base_url=args.vision_url, timeout=5) as client:
        while True:
            cycle = time.monotonic()
            elapsed = cycle - start
            for camera in cameras:
                headers = {
                    "Content-Type": "image/jpeg",
                    "X-Device-Id": camera.device_id,
                    "X-Uptime-S": str(int(elapsed)),
                }
                try:
                    client.post(
                        "/api/v1/frames", content=frame_at(camera, elapsed, args.hold), headers=headers
                    ).raise_for_status()
                except httpx.HTTPError as err:
                    log.warning("%s: %s", camera.device_id, err)
            time.sleep(max(0.0, 1 / args.fps - (time.monotonic() - cycle)))


if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt):
        main()
