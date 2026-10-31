"""Polygon/box geometry in image pixel coordinates. Pure Python, no dependencies."""

from dataclasses import dataclass

Point = tuple[float, float]

# Only the bottom part of a bike's bounding box is compared with the slot polygon: slots are drawn
# on the ground, while the upper part of the box (handlebar, saddle) usually overlaps neighbouring slots.
FOOTPRINT_SHARE = 0.3


@dataclass(frozen=True)
class Box:
    x1: float
    y1: float
    x2: float
    y2: float
    conf: float
    label: str = "bicycle"

    def footprint(self) -> list[Point]:
        top = self.y2 - (self.y2 - self.y1) * FOOTPRINT_SHARE
        return [(self.x1, top), (self.x2, top), (self.x2, self.y2), (self.x1, self.y2)]


def area(poly: list[Point]) -> float:
    """Shoelace formula; works for any simple polygon regardless of orientation."""
    n = len(poly)
    s = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    return abs(s) / 2


def clip_to_rect(poly: list[Point], x1: float, y1: float, x2: float, y2: float) -> list[Point]:
    """Sutherland-Hodgman clipping of a polygon against an axis-aligned rectangle."""

    def clip(points: list[Point], inside, intersect) -> list[Point]:
        out: list[Point] = []
        for i, cur in enumerate(points):
            prev = points[i - 1]
            if inside(cur):
                if not inside(prev):
                    out.append(intersect(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(intersect(prev, cur))
        return out

    def at_x(x):
        return lambda p, q: (x, p[1] + (q[1] - p[1]) * (x - p[0]) / (q[0] - p[0]))

    def at_y(y):
        return lambda p, q: (p[0] + (q[0] - p[0]) * (y - p[1]) / (q[1] - p[1]), y)

    for inside, intersect in (
        (lambda p: p[0] >= x1, at_x(x1)),
        (lambda p: p[0] <= x2, at_x(x2)),
        (lambda p: p[1] >= y1, at_y(y1)),
        (lambda p: p[1] <= y2, at_y(y2)),
    ):
        if not poly:
            break
        poly = clip(poly, inside, intersect)
    return poly


def footprint_overlap(box: Box, slot: list[Point]) -> float:
    """Share (0..1) of the box's ground footprint that lies inside the slot polygon."""
    fp = box.footprint()
    fp_area = area(fp)
    if fp_area == 0:
        return 0.0
    (fx1, fy1), (fx2, fy2) = fp[0], fp[2]
    return area(clip_to_rect(slot, fx1, fy1, fx2, fy2)) / fp_area
