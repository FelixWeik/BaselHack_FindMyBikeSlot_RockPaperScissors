"""Turns per-slot states into the `ParkingHeatmap` grid the frontend renders.

Each cell holds the chance (0..1) of finding a free slot there: 1 = free, 0 = full, 0 outside regions.
"""

import math

from .parkings import Parking, Point

CELL_SIZE_M = 0.5
# How far (metres) a slot's state spreads to the cells around it.
SIGMA_M = 1.5
# Weight of the region-wide free share in each cell. Cells far from any known slot fall back to it.
REGION_PRIOR_WEIGHT = 0.5
# Chance shown for a region without any current information (camera offline, no slots mapped).
NO_INFORMATION = 0.5

SlotKey = tuple[str, str]  # (device_id, slot_id)


def point_in_polygon(x: float, y: float, poly: list[Point]) -> bool:
    """Ray casting."""
    inside = False
    j = len(poly) - 1
    for i, p in enumerate(poly):
        q = poly[j]
        if (p.y > y) != (q.y > y) and x < (q.x - p.x) * (y - p.y) / (q.y - p.y) + p.x:
            inside = not inside
        j = i
    return inside


def build_heatmap(parking: Parking, states: dict[SlotKey, str]) -> dict:
    """`states` maps (device_id, slot_id) to "free" / "occupied" / "unknown"; missing = unknown."""
    regions = parking.config.geometry.regions
    xs = [p.x for r in regions for p in r.boundary]
    ys = [p.y for r in regions for p in r.boundary]
    min_x, min_y = min(xs), min(ys)
    cols = max(1, math.ceil((max(xs) - min_x) / CELL_SIZE_M))
    rows = max(1, math.ceil((max(ys) - min_y) / CELL_SIZE_M))
    origin = Point(x=min_x + CELL_SIZE_M / 2, y=min_y + CELL_SIZE_M / 2)

    # Known slots per region: (x, y, 1.0 if free else 0.0)
    known: dict[str | None, list[tuple[float, float, float]]] = {r.id: [] for r in regions}
    for slot in parking.slots:
        state = states.get((slot.device_id, slot.slot_id), "unknown")
        if state in ("free", "occupied"):
            known[slot.region].append((slot.x, slot.y, 1.0 if state == "free" else 0.0))

    region_share = {
        rid: (sum(f for _, _, f in pts) / len(pts) if pts else NO_INFORMATION) for rid, pts in known.items()
    }

    grid: list[list[float]] = []
    for row in range(rows):
        cy = origin.y + row * CELL_SIZE_M
        line = []
        for col in range(cols):
            cx = origin.x + col * CELL_SIZE_M
            region = next((r for r in regions if point_in_polygon(cx, cy, r.boundary)), None)
            if region is None:
                line.append(0.0)
                continue
            pts = known[region.id]
            if not pts:
                line.append(NO_INFORMATION)
                continue
            weights = [math.exp(-((cx - x) ** 2 + (cy - y) ** 2) / (2 * SIGMA_M**2)) for x, y, _ in pts]
            free = sum(w * f for w, (_, _, f) in zip(weights, pts, strict=True))
            prior = REGION_PRIOR_WEIGHT * region_share[region.id]
            line.append(round((free + prior) / (sum(weights) + REGION_PRIOR_WEIGHT), 3))
        grid.append(line)

    return {
        "version": 1,
        "geometry": parking.config.geometry.model_dump(by_alias=True, exclude_none=True),
        "heatmap": {"origin": origin.model_dump(), "cellSizeMeters": CELL_SIZE_M, "probabilities": grid},
    }
