"""Builds the training set from three sources, so the model learns what breaks the stock one.

1. COCO: real labels and a wide variety of bikes, with motorcycle images as hard negatives.
2. Site photos: pseudo-labelled by the teacher, seen whole and as crops, at camera quality.
3. Synthetic racks: bikes cut out with their masks and pasted in tight rows over bike-free backgrounds.
   Labels are exact even when bikes hide each other, which no teacher can provide.

Held-out photos appear nowhere: they measure the final count error.

Run: .venv/bin/python build_dataset.py PHOTOS_DIR --out data/bikes
"""

import argparse
import json
import random
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps
from ultralytics import YOLO

HOLDOUT = {
    "IMG_20261029_084521",  # underground, wide view
    "IMG_20261029_084430",  # underground, close view
    "IMG_20261029_083909",  # full shelter
    "IMG_20261029_083750",  # open air
    "IMG_20261029_084040",  # motorcycles only and one bike
    "IMG_20261029_084248",  # cargo bike and bus
}
CANVAS = (960, 720)
MIN_VISIBLE = 0.3


def save_jpeg(image: Image.Image, path: Path, rng: random.Random) -> None:
    """Sensor softness and JPEG artefacts, like the OV3660 at VGA to XGA."""
    if rng.random() < 0.5:
        image = image.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.0)))
    image.save(path, "JPEG", quality=rng.randint(45, 90))


def write_labels(path: Path, boxes: list[tuple[float, float, float, float]], width: int, height: int) -> None:
    lines = []
    for x0, y0, x1, y1 in boxes:
        x0, x1 = max(0.0, x0), min(float(width), x1)
        y0, y1 = max(0.0, y0), min(float(height), y1)
        if x1 - x0 < 3 or y1 - y0 < 3:
            continue
        cx, cy = (x0 + x1) / 2 / width, (y0 + y1) / 2 / height
        lines.append(f"0 {cx:.5f} {cy:.5f} {(x1 - x0) / width:.5f} {(y1 - y0) / height:.5f}")
    path.write_text("\n".join(lines))


class Output:
    def __init__(self, root: Path):
        self.root = root
        self.images = root / "images"
        self.labels = root / "labels"
        self.lists: dict[str, list[str]] = {"train": [], "val": []}
        for directory in (self.images, self.labels):
            directory.mkdir(parents=True, exist_ok=True)

    def add(self, split: str, name: str, image: Image.Image, boxes, rng: random.Random) -> None:
        target = self.images / f"{name}.jpg"
        save_jpeg(image, target, rng)
        write_labels(self.labels / f"{name}.txt", boxes, *image.size)
        self.lists[split].append(str(target.absolute()))

    def add_existing(self, split: str, name: str, source: Path, boxes, size: tuple[int, int]) -> None:
        target = self.images / f"{name}.jpg"
        if not target.exists():
            target.symlink_to(source.resolve())
        write_labels(self.labels / f"{name}.txt", boxes, *size)
        # Not resolved: Ultralytics finds a label by swapping /images/ for /labels/ in this very path.
        self.lists[split].append(str(target.absolute()))


def check_labels(out: Output) -> None:
    """A missing label file isn't an error for Ultralytics: the image silently becomes a bike-free background."""
    for name, paths in out.lists.items():
        missing = [p for p in paths if not Path(p.replace("/images/", "/labels/")).with_suffix(".txt").exists()]
        if missing:
            raise SystemExit(f"{len(missing)} {name} images have no label file, e.g. {missing[0]}")


def add_coco(out: Output, coco: Path, rng: random.Random, val_share: float = 0.06) -> None:
    index = json.loads((coco / "index.json").read_text())
    for file_name, info in index.items():
        source = coco / "images" / file_name
        if not source.exists():
            continue
        boxes = [
            (b["bbox"][0], b["bbox"][1], b["bbox"][0] + b["bbox"][2], b["bbox"][1] + b["bbox"][3])
            for b in info["bikes"]
        ]
        split = "val" if rng.random() < val_share else "train"
        out.add_existing(split, f"coco_{Path(file_name).stem}", source, boxes, (info["width"], info["height"]))


def crop_boxes(boxes, crop) -> list[tuple[float, float, float, float]]:
    """Boxes seen through the crop, keeping those mostly inside it."""
    cx0, cy0, cx1, cy1 = crop
    kept = []
    for x0, y0, x1, y1, *_ in boxes:
        ix0, iy0, ix1, iy1 = max(x0, cx0), max(y0, cy0), min(x1, cx1), min(y1, cy1)
        if ix1 <= ix0 or iy1 <= iy0:
            continue
        if (ix1 - ix0) * (iy1 - iy0) / ((x1 - x0) * (y1 - y0)) >= 0.45:
            kept.append((ix0 - cx0, iy0 - cy0, ix1 - cx0, iy1 - cy0))
    return kept


def add_site(out: Output, photos: dict[str, Image.Image], labels: dict, rng: random.Random, per_photo: int) -> None:
    for stem, image in photos.items():
        boxes = labels[stem]
        width, height = image.size
        for size in ((640, 480), (800, 600), (1024, 768)):
            scale = size[0] / width
            scaled = [tuple(v * scale for v in b[:4]) for b in boxes]
            out.add("train", f"site_{stem}_full{size[0]}", image.resize(size, Image.LANCZOS), scaled, rng)
        for n in range(per_photo):
            crop_w = rng.randint(width // 4, width * 3 // 4)
            crop_h = crop_w * 3 // 4
            x = rng.randint(0, width - crop_w)
            y = rng.randint(0, height - crop_h)
            crop = (x, y, x + crop_w, y + crop_h)
            target = rng.choice(((640, 480), (800, 600), (960, 720)))
            scale = target[0] / crop_w
            kept = [tuple(v * scale for v in b) for b in crop_boxes(boxes, crop)]
            view = image.crop(crop).resize(target, Image.LANCZOS)
            out.add("train", f"site_{stem}_c{n}", view, kept, rng)


def cutouts_from_coco(coco: Path, limit: int = 1500) -> list[Image.Image]:
    index = json.loads((coco / "index.json").read_text())
    pieces = []
    for file_name, info in index.items():
        source = coco / "images" / file_name
        if not source.exists():
            continue
        for bike in info["bikes"]:
            x, y, w, h = bike["bbox"]
            if (
                bike["crowd"]
                or h < 110
                or w < 70
                or bike["area"] / (w * h) < 0.12
                or not isinstance(bike["segmentation"], list)
            ):
                continue
            if x <= 1 or y <= 1 or x + w >= info["width"] - 1 or y + h >= info["height"] - 1:
                continue  # cut off by the photo's edge
            mask = Image.new("L", (info["width"], info["height"]), 0)
            draw = ImageDraw.Draw(mask)
            for polygon in bike["segmentation"]:
                if len(polygon) >= 6:
                    draw.polygon(polygon, fill=255)
            piece = Image.open(source).convert("RGB").crop((x, y, x + w, y + h))
            piece.putalpha(mask.crop((x, y, x + w, y + h)))
            pieces.append(piece)
            if len(pieces) >= limit:
                return pieces
    return pieces


def cutouts_from_site(photos: dict[str, Image.Image], teacher: str) -> list[Image.Image]:
    """Bikes of the real site, in the real poses: the ones standing clear enough to segment well."""
    model = YOLO(teacher)
    bike = next(i for i, name in model.names.items() if name == "bicycle")
    pieces = []
    for image in photos.values():
        view = image.resize((2000, 1500), Image.LANCZOS)
        result = model.predict(view, imgsz=1280, conf=0.6, classes=[bike], retina_masks=True, verbose=False)[0]
        if result.masks is None:
            continue
        boxes = result.boxes.xyxy.tolist()
        for i, (x0, y0, x1, y1) in enumerate(boxes):
            area = (x1 - x0) * (y1 - y0)
            crowded = any(
                j != i and max(0, min(x1, o[2]) - max(x0, o[0])) * max(0, min(y1, o[3]) - max(y0, o[1])) > 0.25 * area
                for j, o in enumerate(boxes)
            )
            if crowded or y1 - y0 < 150 or x0 < 3 or y0 < 3 or x1 > 1997 or y1 > 1497:
                continue
            mask = Image.fromarray((result.masks.data[i].cpu().numpy() * 255).astype(np.uint8)).resize(view.size)
            piece = view.crop((x0, y0, x1, y1))
            piece.putalpha(mask.crop((x0, y0, x1, y1)))
            pieces.append(piece)
    return pieces


def backgrounds_from(photos: dict[str, Image.Image], labels: dict, coco: Path, rng: random.Random) -> list[Image.Image]:
    """Places with no bike: bike-free photos, bike-free parts of the others, and scenes with motorcycles."""
    backgrounds = []
    for stem, image in photos.items():
        boxes = labels[stem]
        width, height = image.size
        if not boxes:
            backgrounds.append(image.resize(CANVAS, Image.LANCZOS))
        for _ in range(60):
            crop_w = rng.randint(width // 3, width * 3 // 4)
            crop_h = crop_w * 3 // 4
            x = rng.randint(0, width - crop_w)
            y = rng.randint(0, height - crop_h)
            if not any(b[0] < x + crop_w and b[2] > x and b[1] < y + crop_h and b[3] > y for b in boxes):
                backgrounds.append(image.crop((x, y, x + crop_w, y + crop_h)).resize(CANVAS, Image.LANCZOS))
    index = json.loads((coco / "index.json").read_text())
    negatives = [name for name, info in index.items() if not info["bikes"] and (coco / "images" / name).exists()]
    for name in rng.sample(negatives, min(300, len(negatives))):
        backgrounds.append(Image.open(coco / "images" / name).convert("RGB").resize(CANVAS, Image.LANCZOS))
    return backgrounds


def paste_bike(
    canvas: Image.Image,
    cover: np.ndarray,
    piece: Image.Image,
    base_x: float,
    base_y: float,
    height: float,
    rng: random.Random,
):
    """Pastes a bike standing at (base_x, base_y) and records which pixels it covers."""
    squeeze = rng.choice((1.0, rng.uniform(0.3, 1.0)))
    width = max(8, int(piece.width * height / piece.height * squeeze))
    height = int(height)
    bike = piece.resize((width, height), Image.BILINEAR)
    if rng.random() < 0.5:
        bike = ImageOps.mirror(bike)
    rgb = bike.convert("RGB")
    rgb = ImageEnhance.Brightness(rgb).enhance(rng.uniform(0.7, 1.15))
    rgb = ImageEnhance.Color(rgb).enhance(rng.uniform(0.7, 1.1))
    bike = Image.merge("RGBA", (*rgb.split(), bike.getchannel("A")))
    x0, y0 = int(base_x - width / 2), int(base_y - height)
    canvas.paste(bike, (x0, y0), bike)

    mask = np.array(bike.getchannel("A")) > 128
    ix0, iy0 = max(0, x0), max(0, y0)
    ix1, iy1 = min(canvas.width, x0 + width), min(canvas.height, y0 + height)
    if ix1 <= ix0 or iy1 <= iy0:
        return None
    region = mask[iy0 - y0 : iy1 - y0, ix0 - x0 : ix1 - x0]
    return (x0, y0, x0 + width, y0 + height), region, (ix0, iy0, ix1, iy1), int(mask.sum())


def synth_scene(backgrounds, pieces, rng: random.Random):
    canvas = rng.choice(backgrounds).copy()
    width, height = canvas.size
    rows = rng.choice((1, 1, 2, 2, 3, 3, 4))
    horizon = rng.uniform(0.3, 0.55) * height
    bottom = rng.uniform(0.8, 1.02) * height
    spacing = rng.uniform(0.18, 0.75)

    placed = []
    owner = np.full((height, width), -1, dtype=np.int32)
    for row in range(rows):  # far rows first, near bikes hide them
        t = (row + 1) / rows
        base_y = horizon + (bottom - horizon) * t
        bike_height = (base_y - horizon * 0.55) * rng.uniform(0.55, 0.85)
        bike_height = max(35.0, min(bike_height, height * 0.8))
        x = rng.uniform(-0.2, 0.4) * bike_height
        end = rng.uniform(0.5, 1.15) * width
        while x < end:
            if rng.random() > 0.1:  # the odd free space, so that gaps look real
                pasted = paste_bike(
                    canvas,
                    owner,
                    rng.choice(pieces),
                    x,
                    base_y + rng.uniform(-0.03, 0.03) * bike_height,
                    bike_height,
                    rng,
                )
                if pasted:
                    box, region, (ix0, iy0, ix1, iy1), full = pasted
                    index = len(placed)
                    placed.append((box, full))
                    view = owner[iy0:iy1, ix0:ix1]
                    view[region] = index
            x += bike_height * spacing * rng.uniform(0.7, 1.3)

    boxes = []
    for index, (box, full) in enumerate(placed):
        ys, xs = np.nonzero(owner == index)
        if full and len(xs) / full >= MIN_VISIBLE:
            boxes.append(box)
    return canvas, boxes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("photos", type=Path)
    parser.add_argument("--labels", type=Path, default=Path("data/site_labels.json"))
    parser.add_argument("--coco", type=Path, default=Path("data/coco"))
    parser.add_argument("--teacher-seg", default="weights/yolo26x-seg.pt")
    parser.add_argument("--synthetic", type=int, default=1800)
    parser.add_argument("--crops", type=int, default=30)
    parser.add_argument("--out", type=Path, default=Path("data/bikes"))
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    if args.out.exists():
        shutil.rmtree(args.out)
    out = Output(args.out)
    labels = json.loads(args.labels.read_text())
    photos = {
        p.stem: ImageOps.exif_transpose(Image.open(p)).convert("RGB")
        for p in sorted(args.photos.glob("*.jpg"))
        if p.stem not in HOLDOUT
    }

    add_coco(out, args.coco, rng)
    print("coco", {k: len(v) for k, v in out.lists.items()}, flush=True)
    add_site(out, photos, labels, rng, args.crops)
    print("site", {k: len(v) for k, v in out.lists.items()}, flush=True)

    site_pieces = cutouts_from_site(photos, args.teacher_seg)
    coco_pieces = cutouts_from_coco(args.coco)
    print(f"cutouts: {len(site_pieces)} site, {len(coco_pieces)} coco", flush=True)
    # Site bikes are few but look like production: they make up about a third of the draws.
    pieces = coco_pieces + site_pieces * max(1, len(coco_pieces) // (2 * max(1, len(site_pieces))))
    backgrounds = backgrounds_from(photos, labels, args.coco, rng)
    print(f"backgrounds: {len(backgrounds)}", flush=True)

    for n in range(args.synthetic):
        scene, boxes = synth_scene(backgrounds, pieces, rng)
        split = "val" if n % 15 == 0 else "train"
        scale = rng.choice((1.0, 0.8, 2 / 3))  # as if seen by a lower resolution camera
        if scale != 1.0:
            size = (int(scene.width * scale), int(scene.height * scale))
            scene = scene.resize(size, Image.LANCZOS)
            boxes = [tuple(v * scale for v in b) for b in boxes]
        out.add(split, f"synth_{n:05d}", scene, boxes, rng)
    print("all", {k: len(v) for k, v in out.lists.items()}, flush=True)
    check_labels(out)

    for split, items in out.lists.items():
        rng.shuffle(items)
        (args.out / f"{split}.txt").write_text("\n".join(items) + "\n")
    (args.out / "data.yaml").write_text(
        f"path: {args.out.resolve()}\ntrain: train.txt\nval: val.txt\nnames:\n  0: bicycle\n"
    )


if __name__ == "__main__":
    main()
