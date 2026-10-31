"""Demo camera: plays prepared scenes of a bike rack as if a real camera node sent them.

Use it to show the whole system (vision, backend, web app) without camera hardware. It sends the
same HTTP request as the firmware, so everything after the camera runs exactly as in production.

Run (from code/vision, with the vision service running):
    uv run python demo/demo_camera.py
"""

import argparse
import contextlib
import json
import time
from pathlib import Path

import httpx

HERE = Path(__file__).parent


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--vision-url", default="http://localhost:8001")
    parser.add_argument("--hold", type=float, default=10, help="seconds each scene is shown")
    parser.add_argument("--fps", type=float, default=1, help="frames per second, like the camera node")
    args = parser.parse_args()

    slots = json.loads((HERE / "cam-demo.slots.json").read_text())
    device_id = slots["device_id"]
    frames = sorted((HERE / "frames").glob("*.jpg"))

    with httpx.Client(base_url=args.vision_url, timeout=5) as client:
        # Same slots every time, so nobody has to draw them on the calibration page.
        client.put(f"/api/v1/devices/{device_id}/slots", json=slots).raise_for_status()
        print(f"{device_id}: {len(frames)} scenes, {args.hold:g} s each. Watch {args.vision_url}/ and the web app.")
        headers = {"Content-Type": "image/jpeg", "X-Device-Id": device_id}
        while True:
            for frame in frames:
                print(f"scene {frame.stem}")
                jpeg = frame.read_bytes()
                end = time.monotonic() + args.hold
                while time.monotonic() < end:
                    try:
                        client.post("/api/v1/frames", content=jpeg, headers=headers).raise_for_status()
                    except httpx.HTTPError as e:
                        print(f"  vision not reachable: {e}")
                    time.sleep(1 / args.fps)


if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt):
        main()
