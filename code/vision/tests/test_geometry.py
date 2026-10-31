import pytest

from app.debounce import Debouncer
from app.geometry import Box, area, clip_to_rect, footprint_overlap
from app.slots import Slot, SlotResult, evaluate

SQUARE = [(0, 0), (10, 0), (10, 10), (0, 10)]


def test_area():
    assert area(SQUARE) == 100
    assert area(list(reversed(SQUARE))) == 100


def test_clip_partial_and_disjoint():
    assert area(clip_to_rect(SQUARE, 5, 5, 20, 20)) == 25
    assert clip_to_rect(SQUARE, 20, 20, 30, 30) == []


def test_footprint_uses_bottom_of_box():
    slot = [(0, 70), (100, 70), (100, 100), (0, 100)]  # strip on the ground
    bike = Box(0, 0, 100, 100, conf=0.9)  # footprint = y 70..100
    assert footprint_overlap(bike, slot) == pytest.approx(1.0)
    above = [(0, 0), (100, 0), (100, 60), (0, 60)]  # only touches the upper part of the box
    assert footprint_overlap(bike, above) == 0


def test_evaluate_occupied_and_free():
    slots = [
        Slot(slot_id="s1", polygon=[(0, 70), (100, 70), (100, 100), (0, 100)]),
        Slot(slot_id="s2", polygon=[(200, 70), (300, 70), (300, 100), (200, 100)]),
    ]
    result = {r.slot_id: r for r in evaluate([Box(0, 0, 100, 100, conf=0.8)], slots, occupied_overlap=0.3)}
    assert result["s1"].state == "occupied" and result["s1"].conf == 0.8
    assert result["s2"].state == "free" and result["s2"].conf == 1.0


def test_debounce_needs_consecutive_frames():
    d = Debouncer(frames=3)
    free = [SlotResult(slot_id="s1", state="free", conf=0.9)]
    occ = [SlotResult(slot_id="s1", state="occupied", conf=0.8)]
    assert d.update("cam", free)[0].state == "free"
    assert d.update("cam", occ)[0].state == "free"
    assert d.update("cam", free)[0].state == "free"  # streak broken
    assert d.update("cam", occ)[0].state == "free"
    assert d.update("cam", occ)[0].state == "free"
    assert d.update("cam", occ)[0].state == "occupied"
