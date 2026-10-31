"""Counts bikes per photo for several models, on photos degraded like the camera node sends them.

Run: .venv/bin/python compare.py PHOTOS_DIR --models yolo26n.pt yolo11n.pt --out out/
"""

import argparse
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps
from ultralytics import YOLO

CAMERA_SIZES = {"vga": (640, 480), "svga": (800, 600), "xga": (1024, 768), "hd": (1600, 1200)}


def as_camera(path: Path, size: tuple[int, int]) -> Image.Image:
    """Downscales and re-encodes a phone photo like the OV3660 at JPEG quality 10 (roughly 75 %)."""
    image = ImageOps.exif_transpose(Image.open(path)).convert("RGB").resize(size, Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=75)
    buffer.seek(0)
    return Image.open(buffer).convert("RGB")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("photos", type=Path)
    parser.add_argument("--models", nargs="+", required=True)
    parser.add_argument("--camera", nargs="+", default=["vga"], choices=sorted(CAMERA_SIZES))
    parser.add_argument("--imgsz", type=int, nargs="+", default=[640])
    parser.add_argument("--conf", type=float, default=0.25)
    parser.add_argument("--truth", type=Path, help="JSON {photo stem: bikes}")
    parser.add_argument("--out", type=Path, default=Path("out"))
    parser.add_argument("--draw", action="store_true")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    photos = sorted(args.photos.glob("*.jpg"))
    truth = json.loads(args.truth.read_text()) if args.truth else {}
    table: dict[str, dict[str, int]] = {p.stem: {} for p in photos}

    for weights in args.models:
        model = YOLO(weights)
        bike = next(i for i, name in model.names.items() if name in ("bicycle", "bike"))
        for camera in args.camera:
            for imgsz in args.imgsz:
                key = f"{Path(weights).parent.parent.name or Path(weights).stem}/{camera}/{imgsz}"
                for photo in photos:
                    image = as_camera(photo, CAMERA_SIZES[camera])
                    result = model.predict(image, imgsz=imgsz, conf=args.conf, classes=[bike], verbose=False)[0]
                    table[photo.stem][key] = len(result.boxes)
                    if args.draw:
                        draw = ImageDraw.Draw(image)
                        for box in result.boxes.xyxy.tolist():
                            draw.rectangle(box, outline=(255, 40, 40), width=2)
                        image.save(args.out / f"{photo.stem}_{key.replace('/', '_')}.jpg", quality=85)

    keys = sorted({k for row in table.values() for k in row})
    print("photo".ljust(18) + "truth".rjust(7) + "".join(k.rjust(26) for k in keys))
    errors = dict.fromkeys(keys, 0)
    for stem, row in table.items():
        expected = truth.get(stem)
        cells = "".join(str(row[k]).rjust(26) for k in keys)
        print(stem[4:].ljust(18) + str(expected if expected is not None else "?").rjust(7) + cells)
        if expected is not None:
            for k in keys:
                errors[k] += abs(row[k] - expected)
    if truth:
        print("sum |error|".ljust(25) + "".join(str(errors[k]).rjust(26) for k in keys))
    (args.out / "counts.json").write_text(json.dumps(table, indent=1))


if __name__ == "__main__":
    main()
