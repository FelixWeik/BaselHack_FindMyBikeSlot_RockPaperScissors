"""Trains the bike detector on the dataset made by build_dataset.py.

Run: .venv/bin/python train.py --weights weights/yolo26n.pt --name yolo26n-960
Interrupted: .venv/bin/python train.py --weights runs/yolo26n-960/weights/last.pt --name yolo26n-960 --resume
"""

import argparse
from pathlib import Path

from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", default="weights/yolo26n.pt")
    parser.add_argument("--data", type=Path, default=Path("data/bikes/data.yaml"))
    parser.add_argument("--name", required=True)
    parser.add_argument("--imgsz", type=int, default=960)
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch", type=int, default=12)
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--finetune", action="store_true", help="the weights already know bikes: small steps, no warmup")
    parser.add_argument("--resume", action="store_true", help="carry on an interrupted run from its last.pt")
    args = parser.parse_args()

    if args.resume:
        YOLO(args.weights).train(resume=True)
        return
    steps = {"optimizer": "AdamW", "lr0": 0.0005, "lrf": 0.2, "warmup_epochs": 1} if args.finetune else {}
    YOLO(args.weights).train(
        data=str(args.data.resolve()),
        project=str(Path("runs").resolve()),
        name=args.name,
        imgsz=args.imgsz,
        epochs=args.epochs,
        batch=args.batch,
        workers=args.workers,
        patience=12,
        close_mosaic=8,
        scale=0.6,
        degrees=3,
        translate=0.1,
        mixup=0.05,
        plots=False,
        exist_ok=True,
        **steps,
    )


if __name__ == "__main__":
    main()
