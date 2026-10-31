"""Plays photos as if they came from a camera node, for testing without the ESP32 hardware.

Sends one frame per second to the vision service, like the firmware does, cycling through the given images.
Calibrate the camera in the admin afterwards, like a real one.

Run (from code/vision):
    uv run python tools/fake_camera.py                          # the sample rack photo from assets/
    uv run python tools/fake_camera.py my-photos/ --id cam-alice
    uv run python tools/fake_camera.py a.jpg b.jpg --hold 10    # switch scene every 10 s
"""

import argparse
import contextlib
import io
import itertools
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[3]
SAMPLE = REPO / "assets" / "IMG_20261029_084439.jpg"
# Same size the firmware sends (FRAMESIZE_XGA); also keeps phone photos under the service's 2 MB limit.
FRAME_SIZE = (1024, 768)


def load_frames(paths: list[Path]) -> list[tuple[str, bytes]]:
    files = sorted(p for path in paths for p in ([path] if path.is_file() else path.iterdir()))
    frames = []
    for file in files:
        if file.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
            continue
        image = Image.open(file).convert("RGB")
        image.thumbnail(FRAME_SIZE)
        output = io.BytesIO()
        image.save(output, "JPEG", quality=85)
        frames.append((file.name, output.getvalue()))
    return frames


def send(url: str, device_id: str, jpeg: bytes) -> str:
    request = urllib.request.Request(
        url, data=jpeg, method="POST", headers={"Content-Type": "image/jpeg", "X-Device-Id": device_id, "X-RSSI": "-50"}
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return f"HTTP {response.status}"
    except urllib.error.HTTPError as err:
        return f"HTTP {err.code}"
    except OSError as err:
        return f"unreachable ({err})"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("images", nargs="*", type=Path, default=[SAMPLE], help="JPEG/PNG files or folders")
    parser.add_argument("--id", default="cam-fake", help="camera name (default: cam-fake)")
    parser.add_argument("--url", default="http://localhost:8001", help="vision service (default: %(default)s)")
    parser.add_argument("--hold", type=float, default=5, help="seconds per image before the next one")
    args = parser.parse_args()

    frames = load_frames(args.images)
    if not frames:
        parser.error("no JPEG or PNG images found")
    url = args.url.rstrip("/") + "/api/v1/frames"
    print(f"Sending {len(frames)} image(s) as '{args.id}' to {url}, 1 frame/s. Ctrl+C to stop.")
    last = ""
    for name, jpeg in itertools.cycle(frames):
        until = time.monotonic() + args.hold
        while time.monotonic() < until:
            result = send(url, args.id, jpeg)
            if f"{name} {result}" != last:  # log changes only, not every second
                print(f"{name}: {result}", flush=True)
                last = f"{name} {result}"
            time.sleep(1)


if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt):
        main()
