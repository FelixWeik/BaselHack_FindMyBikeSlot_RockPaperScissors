"""Decides which zone each detected bike stands in. Knows nothing about the model that found the bikes.

Bikes and polygons only need to share a coordinate frame: the rest of the system uses image coordinates normalized
to 0..1, so the result doesn't depend on the camera's resolution.
"""

from collections.abc import Iterable, Mapping, Sequence

XY = tuple[float, float]
Polygon = Sequence[XY]
BBox = tuple[float, float, float, float]

# A bike's wheels are near the bottom of its box. Start there, and climb when the bottom falls outside the zone
# (front wheel past the edge of the slab, box cut off by the image).
RATIOS = (0.95, 0.90, 0.85, 0.80, 0.75, 0.70, 0.65)
EPSILON = 1e-9


def _cross(a: XY, b: XY, c: XY) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _on_segment(p: XY, a: XY, b: XY) -> bool:
    return (
        abs(_cross(a, b, p)) <= EPSILON
        and min(a[0], b[0]) - EPSILON <= p[0] <= max(a[0], b[0]) + EPSILON
        and min(a[1], b[1]) - EPSILON <= p[1] <= max(a[1], b[1]) + EPSILON
    )


def _edges(polygon: Polygon) -> Iterable[tuple[XY, XY]]:
    return zip(polygon, [*polygon[1:], polygon[0]], strict=True)


def point_in_polygon(point: XY, polygon: Polygon) -> bool:
    """Ray casting. A point exactly on an edge counts as inside, for every zone sharing that edge."""
    if len(polygon) < 3:
        return False
    x, y = point
    inside = False
    for a, b in _edges(polygon):
        if _on_segment(point, a, b):
            return True
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            inside = not inside
    return inside


def attribute(bbox: BBox, zones: Mapping[str, Polygon]) -> str | None:
    """The zone a bike belongs to, or None. Zones are tried in id order, so a shared edge always gives the same one."""
    x_min, y_min, x_max, y_max = bbox
    x = (x_min + x_max) / 2
    ordered = sorted(zones.items())
    for ratio in RATIOS:
        point = (x, y_min + ratio * (y_max - y_min))
        for zone_id, polygon in ordered:
            if point_in_polygon(point, polygon):
                return zone_id
    return None


def count_by_zone(bboxes: Iterable[BBox], zones: Mapping[str, Polygon]) -> dict[str, int]:
    """Bikes per zone. A zone without any bike is present with 0: it was analysed and found empty."""
    counts = dict.fromkeys(zones, 0)
    for bbox in bboxes:
        zone_id = attribute(bbox, zones)
        if zone_id is not None:
            counts[zone_id] += 1
    return counts


def _segments_cross(a: XY, b: XY, c: XY, d: XY) -> bool:
    """True only when the segments properly cross; sharing an end or touching does not count."""

    def side(p: XY, q: XY, r: XY) -> int:
        value = _cross(p, q, r)
        return 0 if abs(value) <= EPSILON else (1 if value > 0 else -1)

    return side(a, b, c) * side(a, b, d) < 0 and side(c, d, a) * side(c, d, b) < 0


def self_crosses(polygon: Polygon) -> bool:
    edges = list(_edges(polygon))
    return any(_segments_cross(*e, *f) for i, e in enumerate(edges) for f in edges[i + 1 :])


def is_valid_polygon(polygon: Polygon) -> bool:
    """At least three corners, enclosing an area, without crossing itself."""
    if len(polygon) < 3 or self_crosses(polygon):
        return False
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in _edges(polygon)) / 2
    return abs(area) > EPSILON


def _strictly_inside(point: XY, polygon: Polygon) -> bool:
    on_edge = any(_on_segment(point, a, b) for a, b in _edges(polygon))
    return not on_edge and point_in_polygon(point, polygon)


def _centroid(polygon: Polygon) -> XY:
    return sum(p[0] for p in polygon) / len(polygon), sum(p[1] for p in polygon) / len(polygon)


def polygons_overlap(a: Polygon, b: Polygon) -> bool:
    """Neighbours sharing an edge do not overlap; crossing edges or one inside the other do."""
    if any(_segments_cross(*e, *f) for e in _edges(a) for f in _edges(b)):
        return True
    return (
        any(_strictly_inside(p, b) for p in a)
        or any(_strictly_inside(p, a) for p in b)
        or _strictly_inside(_centroid(a), b)
        or _strictly_inside(_centroid(b), a)
    )


def overlapping_zones(zones: Mapping[str, Polygon]) -> list[tuple[str, str]]:
    """Pairs of zones a bike could ambiguously belong to."""
    ids = sorted(zones)
    return [(a, b) for i, a in enumerate(ids) for b in ids[i + 1 :] if polygons_overlap(zones[a], zones[b])]
