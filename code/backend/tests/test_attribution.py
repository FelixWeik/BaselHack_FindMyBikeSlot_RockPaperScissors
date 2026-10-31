import pytest

from app.attribution import (
    attribute,
    count_by_zone,
    is_valid_polygon,
    overlapping_zones,
    point_in_polygon,
    polygons_overlap,
)

SQUARE = [(0.2, 0.5), (0.6, 0.5), (0.6, 0.9), (0.2, 0.9)]
ZONES = {"A": SQUARE}


def test_bike_entirely_in_a_zone():
    assert attribute((0.3, 0.6, 0.5, 0.8), ZONES) == "A"


def test_climbs_from_95_percent_until_it_finds_the_zone():
    # Box from y=0 to y=1: 95 % is at y=0.95 (outside), 85 % at y=0.85 (inside).
    assert attribute((0.3, 0.0, 0.5, 1.0), ZONES) == "A"


def test_stops_climbing_at_65_percent():
    zones = {"A": [(0, 0), (1, 0), (1, 0.5), (0, 0.5)]}
    assert attribute((0.3, 0.0, 0.5, 0.76), zones) == "A"  # 65 % is at y=0.494
    assert attribute((0.3, 0.0, 0.5, 1.0), zones) is None  # 65 % is at y=0.65, and the box's top half doesn't count


def test_the_lowest_point_found_wins():
    zones = {"low": [(0, 0.8), (1, 0.8), (1, 1), (0, 1)], "high": [(0, 0), (1, 0), (1, 0.8), (0, 0.8)]}
    assert attribute((0.4, 0.4, 0.6, 0.9), zones) == "low"  # 95 % is at y=0.88
    assert attribute((0.4, 0.4, 0.6, 0.8), zones) == "high"  # 95 % is at y=0.78


def test_uses_the_horizontal_centre_only():
    assert attribute((0.0, 0.6, 0.3, 0.8), ZONES) is None  # centre at x=0.15, though the box reaches into the zone


def test_bike_outside_every_zone_is_ignored():
    assert attribute((0.7, 0.6, 0.9, 0.8), ZONES) is None
    assert count_by_zone([(0.7, 0.6, 0.9, 0.8)], ZONES) == {"A": 0}


@pytest.mark.parametrize("point", [(0.2, 0.7), (0.6, 0.7), (0.4, 0.5), (0.4, 0.9), (0.2, 0.5), (0.6, 0.9)])
def test_a_point_on_the_boundary_is_inside(point):
    assert point_in_polygon(point, SQUARE)


def test_bike_on_a_shared_boundary_goes_to_one_zone_and_always_the_same():
    zones = {"B": [(0.5, 0), (1, 0), (1, 1), (0.5, 1)], "A": [(0, 0), (0.5, 0), (0.5, 1), (0, 1)]}
    box = (0.4, 0.2, 0.6, 0.8)  # centre exactly on x=0.5
    assert attribute(box, zones) == "A"
    assert count_by_zone([box], zones) == {"A": 1, "B": 0}


def test_several_bikes_in_one_zone():
    boxes = [(0.25, 0.6, 0.35, 0.8), (0.35, 0.6, 0.45, 0.8), (0.45, 0.6, 0.55, 0.8), (0.7, 0.6, 0.9, 0.8)]
    assert count_by_zone(boxes, ZONES) == {"A": 3}


def test_a_zone_without_bikes_is_counted_as_zero():
    assert count_by_zone([], ZONES) == {"A": 0}


def test_normalized_and_pixel_coordinates_agree():
    width, height = 1024, 768
    box = (0.3, 0.0, 0.5, 1.0)
    pixels = (box[0] * width, box[1] * height, box[2] * width, box[3] * height)
    zone = [(x * width, y * height) for x, y in SQUARE]
    assert attribute(box, ZONES) == "A"
    assert attribute(pixels, {"A": zone}) == "A"


@pytest.mark.parametrize(
    "polygon",
    [
        [(0, 0), (1, 1)],  # too few corners
        [(0, 0), (0.5, 0.5), (1, 1)],  # flat
        [(0, 0), (1, 1), (1, 0), (0, 1)],  # bow tie
    ],
)
def test_invalid_polygons(polygon):
    assert not is_valid_polygon(polygon)


def test_a_polygon_too_small_to_contain_anything_catches_no_bike():
    assert attribute((0.3, 0.6, 0.5, 0.8), {"A": [(0, 0), (1, 1)]}) is None


def test_valid_polygon():
    assert is_valid_polygon(SQUARE)


def test_overlap_of_crossing_polygons_is_reported():
    other = [(0.5, 0.6), (0.9, 0.6), (0.9, 0.8), (0.5, 0.8)]
    assert polygons_overlap(SQUARE, other)
    assert overlapping_zones({"A": SQUARE, "B": other, "C": [(0.7, 0), (0.8, 0), (0.8, 0.1)]}) == [("A", "B")]


def test_overlap_of_a_polygon_inside_another_is_reported():
    assert polygons_overlap(SQUARE, [(0.3, 0.6), (0.4, 0.6), (0.4, 0.7), (0.3, 0.7)])


def test_overlap_of_identical_polygons_is_reported():
    assert polygons_overlap(SQUARE, list(SQUARE))


def test_neighbours_sharing_an_edge_do_not_overlap():
    assert not polygons_overlap(SQUARE, [(0.6, 0.5), (0.9, 0.5), (0.9, 0.9), (0.6, 0.9)])
