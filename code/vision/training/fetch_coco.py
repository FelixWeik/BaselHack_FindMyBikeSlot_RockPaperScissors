"""Downloads the COCO images that show bikes, plus motorcycle images as hard negatives.

Motorcycles stay unlabelled on purpose: scooters and motorbikes share the real shelters and must not count.

Run: .venv/bin/python fetch_coco.py --out data/coco
"""

import argparse
import json
import random
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ANNOTATIONS = "http://images.cocodataset.org/annotations/annotations_trainval2017.zip"
BICYCLE = 2
MOTORCYCLE = 4
NEGATIVES = 1200


def fetch(item: tuple[str, Path]) -> bool:
    url, target = item
    if target.exists():
        return True
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            target.write_bytes(response.read())
        return True
    except OSError:
        return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path("data/coco"))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    archive = args.out / "annotations.zip"
    if not (args.out / "instances_train2017.json").exists():
        urllib.request.urlretrieve(ANNOTATIONS, archive)
        with zipfile.ZipFile(archive) as z:
            (args.out / "instances_train2017.json").write_bytes(z.read("annotations/instances_train2017.json"))
        archive.unlink()

    coco = json.loads((args.out / "instances_train2017.json").read_text())
    images = {i["id"]: i for i in coco["images"]}
    bikes: dict[int, list[dict]] = {}
    crowded: set[int] = set()
    motorcycles: set[int] = set()
    for a in coco["annotations"]:
        if a["category_id"] == BICYCLE:
            bikes.setdefault(a["image_id"], []).append(
                {"bbox": a["bbox"], "segmentation": a["segmentation"], "area": a["area"], "crowd": a["iscrowd"]}
            )
            if a["iscrowd"]:
                crowded.add(a["image_id"])
        elif a["category_id"] == MOTORCYCLE:
            motorcycles.add(a["image_id"])

    negatives = sorted(motorcycles - set(bikes))
    random.Random(0).shuffle(negatives)
    negatives = negatives[:NEGATIVES]
    keep = sorted(set(bikes) - crowded) + negatives

    images_dir = args.out / "images"
    images_dir.mkdir(exist_ok=True)
    jobs = [(images[i]["coco_url"], images_dir / images[i]["file_name"]) for i in keep]
    with ThreadPoolExecutor(32) as pool:
        done = sum(pool.map(fetch, jobs))
    print(f"{done}/{len(jobs)} images, {len(negatives)} of them negatives")

    index = {
        images[i]["file_name"]: {
            "width": images[i]["width"],
            "height": images[i]["height"],
            "bikes": bikes.get(i, []),
        }
        for i in keep
    }
    (args.out / "index.json").write_text(json.dumps(index))
    (args.out / "instances_train2017.json").unlink()


if __name__ == "__main__":
    main()
