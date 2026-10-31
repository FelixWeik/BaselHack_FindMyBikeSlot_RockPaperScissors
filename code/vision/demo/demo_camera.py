"""Demo camera: plays prepared scenes of a bike rack as if a real camera node sent them.

Use it to show the whole system (vision, backend, web app) without camera hardware. It sends the
same HTTP request as the firmware, so everything after the camera runs exactly as in production.
It appears in the admin as a camera to calibrate, like any new camera.

Run (from code/vision, with the vision service running):
    uv run python demo/demo_camera.py
    uv run python demo/demo_camera.py --frames my/photos --device-id cam-other
"""

import argparse
import contextlib
import time
from pathlib import Path

import httpx

HERE = Path(__file__).parent


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--vision-url", default="http://localhost:8001")
    parser.add_argument("--device-id", default="cam-demo")
    parser.add_argument("--frames", type=Path, default=HERE / "frames", help="folder of JPEG scenes, played in order")
    parser.add_argument("--hold", type=float, default=10, help="seconds each scene is shown")
    parser.add_argument("--fps", type=float, default=1, help="frames per second, like the camera node")
    args = parser.parse_args()

    frames = sorted(args.frames.glob("*.jpg"))
    if not frames:
        raise SystemExit(f"No .jpg file in {args.frames}")

    with httpx.Client(base_url=args.vision_url, timeout=5) as client:
        print(f"{args.device_id}: {len(frames)} scenes, {args.hold:g} s each.")
        headers = {"Content-Type": "image/jpeg", "X-Device-Id": args.device_id, "X-RSSI": "-50"}
        started = time.monotonic()
        while True:
            for frame in frames:
                print(f"scene {frame.stem}")
                jpeg = frame.read_bytes()
                end = time.monotonic() + args.hold
                while time.monotonic() < end:
                    uptime = {"X-Uptime-S": str(int(time.monotonic() - started))}
                    try:
                        client.post("/api/v1/frames", content=jpeg, headers=headers | uptime).raise_for_status()
                    except httpx.HTTPError as e:
                        print(f"  vision not reachable: {e}")
                    time.sleep(1 / args.fps)


if __name__ == "__main__":
    with contextlib.suppress(KeyboardInterrupt):
        main()
