"""Labels the site photos with a large teacher model, looking at them tile by tile at full resolution.

Run: .venv/bin/python pseudo_label.py PHOTOS_DIR --out data/site_labels.json --review out/review
"""

import argparse
import json
from pathlib import Path

import torch
from PIL import Image, ImageDraw, ImageOps
from torchvision.ops import nms
from ultralytics import YOLO

TILE_SIZES = (1600, 2600)
OVERLAP = 0.5
BORDER = 6  # a box touching a tile's inner edge is a cut-off bike: another tile sees it whole
MAX_TILE_SHARE = 0.45


def tile_origins(length: int, tile: int) -> list[int]:
    if tile >= length:
        return [0]
    step = int(tile * (1 - OVERLAP))
    origins = list(range(0, length - tile, step))
    return [*origins, length - tile]


def detect(model: YOLO, bike: int, image: Image.Image, conf: float) -> list[list[float]]:
    width, height = image.size
    found: list[list[float]] = []
    views = [(0, 0, width, height)]
    for tile in TILE_SIZES:
        views += [(x, y, x + tile, y + tile) for x in tile_origins(width, tile) for y in tile_origins(height, tile)]
    for x0, y0, x1, y1 in views:
        x1, y1 = min(x1, width), min(y1, height)
        result = model.predict(image.crop((x0, y0, x1, y1)), imgsz=1280, conf=conf, classes=[bike], verbose=False)[0]
        whole = (x0, y0, x1, y1) == (0, 0, width, height)
        for (bx0, by0, bx1, by1), score in zip(result.boxes.xyxy.tolist(), result.boxes.conf.tolist(), strict=True):
            # In a tile, only bikes much smaller than the tile can be trusted: the large boxes are parts of a bike.
            if not whole and max((bx1 - bx0) / (x1 - x0), (by1 - by0) / (y1 - y0)) > MAX_TILE_SHARE:
                continue
            cut_off = (
                (x0 > 0 and bx0 < BORDER)
                or (y0 > 0 and by0 < BORDER)
                or (x1 < width and bx1 > (x1 - x0) - BORDER)
                or (y1 < height and by1 > (y1 - y0) - BORDER)
            )
            if not cut_off:
                found.append([bx0 + x0, by0 + y0, bx1 + x0, by1 + y0, score])
    if not found:
        return []
    boxes = torch.tensor(found)
    return boxes[nms(boxes[:, :4], boxes[:, 4], 0.5)].tolist()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("photos", type=Path)
    parser.add_argument("--teacher", default="weights/yolo26x.pt")
    parser.add_argument("--conf", type=float, default=0.3)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--review", type=Path)
    args = parser.parse_args()

    model = YOLO(args.teacher)
    bike = next(i for i, name in model.names.items() if name == "bicycle")
    labels = {}
    for photo in sorted(args.photos.glob("*.jpg")):
        image = ImageOps.exif_transpose(Image.open(photo)).convert("RGB")
        boxes = detect(model, bike, image, args.conf)
        labels[photo.stem] = [[round(v, 3) for v in b] for b in boxes]
        print(photo.stem, len(boxes), flush=True)
        if args.review:
            args.review.mkdir(parents=True, exist_ok=True)
            draw = ImageDraw.Draw(image)
            for box in boxes:
                draw.rectangle(box[:4], outline=(255, 40, 40), width=6)
            image.resize((1600, 1200)).save(args.review / f"{photo.stem}.jpg", quality=85)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(labels))


if __name__ == "__main__":
    main()
