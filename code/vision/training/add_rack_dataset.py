"""Adds a hand-labelled dataset of real bike racks (Roboflow, YOLO format) to the set made by build_dataset.py.

Used: Smart Bike Rack, CC BY 4.0, https://universe.roboflow.com/free-projects/smart-bike-rack-pou2z-wwess

Its train split is seen whole and as crops like the site photos, its valid split joins the validation set, and its test
split stays out of training entirely: written as a folder and a truth file, compare.py measures count errors on it.

Run: .venv/bin/python add_rack_dataset.py DATASET_DIR --out data/bikes --name v3 --test-dir data/rack_test
"""

import argparse
import json
import random
from pathlib import Path

from build_dataset import Output, add_site, check_labels
from PIL import Image, ImageOps

MAX_SIDE = 1600


def read_boxes(label_path: Path, width: int, height: int) -> list[tuple[float, float, float, float]]:
    """Polygons (more than 4 values) become the box around them."""
    boxes = []
    for line in label_path.read_text().splitlines():
        values = [float(v) for v in line.split()[1:]]
        if len(values) == 4:
            cx, cy, w, h = values
            boxes.append(((cx - w / 2) * width, (cy - h / 2) * height, (cx + w / 2) * width, (cy + h / 2) * height))
        elif len(values) >= 6:
            xs, ys = values[0::2], values[1::2]
            boxes.append((min(xs) * width, min(ys) * height, max(xs) * width, max(ys) * height))
    return boxes


def load(image_path: Path, label_path: Path, max_side: int) -> tuple[Image.Image, list]:
    image = ImageOps.exif_transpose(Image.open(image_path)).convert("RGB")
    image.thumbnail((max_side, max_side), Image.LANCZOS)
    return image, read_boxes(label_path, *image.size)


def split_files(root: Path, split: str) -> list[tuple[Path, Path]]:
    images = sorted((root / split / "images").glob("*.jpg"))
    return [(path, root / split / "labels" / f"{path.stem}.txt") for path in images]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--out", type=Path, default=Path("data/bikes"))
    parser.add_argument("--name", default="v3", help="suffix of the new lists; the existing ones are left alone")
    parser.add_argument("--test-dir", type=Path, default=Path("data/rack_test"))
    parser.add_argument("--crops", type=int, default=12)
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()
    rng = random.Random(args.seed)
    out = Output(args.out)

    for path, labels in split_files(args.dataset, "train"):
        image, boxes = load(path, labels, MAX_SIDE)
        add_site(out, {f"rack_{path.stem}": image}, {f"rack_{path.stem}": boxes}, rng, args.crops)
    for path, labels in split_files(args.dataset, "valid"):
        image, boxes = load(path, labels, 1024)
        out.add("val", f"rackval_{path.stem}", image, boxes, rng)
    check_labels(out)

    for split, added in out.lists.items():
        existing = (args.out / f"{split}.txt").read_text().split()
        items = existing + added
        rng.shuffle(items)
        (args.out / f"{split}_{args.name}.txt").write_text("\n".join(items) + "\n")
        print(split, len(existing), "+", len(added), flush=True)
    (args.out / f"data_{args.name}.yaml").write_text(
        f"path: {args.out.resolve()}\ntrain: train_{args.name}.txt\nval: val_{args.name}.txt\nnames:\n  0: bicycle\n"
    )

    args.test_dir.mkdir(parents=True, exist_ok=True)
    truth = {}
    for path, labels in split_files(args.dataset, "test"):
        target = args.test_dir / path.name
        if not target.exists():
            target.symlink_to(path.resolve())
        truth[path.stem] = len(labels.read_text().splitlines())
    (args.test_dir / "truth.json").write_text(json.dumps(truth, indent=1))
    print("test photos", len(truth), "bikes", sum(truth.values()))


if __name__ == "__main__":
    main()
