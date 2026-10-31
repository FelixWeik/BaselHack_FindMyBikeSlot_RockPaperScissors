# Training the bike detector

The service loads `models/yolo-bikes-v3.pt`: YOLO26n, one class (`bicycle`), trained at 960 px. Its run was named `yolo26n-960-v3`.

## How it was made

1. `pseudo_label.py`: a tiled YOLO26x labels the site photos.
2. `fetch_coco.py`, `build_dataset.py`: COCO bikes, motorcycle negatives, synthetic racks and the site photos, all degraded like the camera. Test photos are held out whole.
3. `train.py --weights weights/yolo26n.pt --name yolo26n-960-v2 --batch 10 --workers 3`: stopped after 32 of 40 epochs.
4. `add_rack_dataset.py`: adds Smart Bike Rack, hand-labelled real racks.
5. `train.py --weights runs/yolo26n-960-v2/weights/best.pt --data data/bikes/data_v3.yaml --name yolo26n-960-v3 --epochs 12 --batch 10 --workers 3 --finetune`.

Base weights download again on first use. No image or dataset belongs in git.

## Results

At confidence 0.25 and 960 px, against the unmodified `yolo26n`.

| | YOLO26n | `yolo-bikes-v3.pt` |
|---|---|---|
| Smart Bike Rack test, 20 photos, 141 bikes: precision | 0.716 | 0.894 |
| Same: recall | 0.716 | 0.901 |
| Same: AP50 | 0.724 | 0.923 |
| Same: mean count error per photo | 1.20 | 0.65 |
| 6 held-out site photos, sum of count errors (HD / VGA / XGA) | 53 / 52 / 54 | 20 / 22 / 22 |

Read these with care:

- The Smart Bike Rack test photos come from the same series as its training photos, so these scores are likely optimistic.
- The six site photos are few, and two of their counts are approximate (±5).
- Camera quality was simulated by resizing: nothing has been measured on the real OV3660.
- It undercounts tight rows seen from close and low: about 8 of 24 bikes on one held-out photo, which can announce a free spot that doesn't exist. Mount cameras high.

## Dataset credit

Smart Bike Rack, Roboflow Universe, CC BY 4.0: https://universe.roboflow.com/free-projects/smart-bike-rack-pou2z-wwess/dataset/1
