import json
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.db import Store
from app.heatmap import NO_INFORMATION, build_heatmap
from app.main import create_app
from app.parkings import Parking

WEEK = {d: [{"start": "06:00", "end": "22:00"}] for d in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")}


def parking(slots=None, regions=None) -> dict:
    return {
        "config": {
            "version": 1,
            "id": "p1",
            "name": "Test parking",
            "totalSlots": 2,
            "geometry": {
                "regions": regions
                or [
                    {"id": "A", "boundary": [{"x": 0, "y": 0}, {"x": 4, "y": 0}, {"x": 4, "y": 2}, {"x": 0, "y": 2}]},
                    {"id": "B", "boundary": [{"x": 6, "y": 0}, {"x": 8, "y": 0}, {"x": 8, "y": 2}, {"x": 6, "y": 2}]},
                ]
            },
            "slotSize": {"widthMeters": 0.7, "lengthMeters": 2},
            "schedule": {"timezone": "Europe/Zurich", "weekly": WEEK},
        },
        "slots": slots
        if slots is not None
        else [
            {"deviceId": "cam", "slotId": "s1", "region": "A", "x": 1, "y": 1},
            {"deviceId": "cam", "slotId": "s2", "region": "A", "x": 3, "y": 1},
        ],
    }


def cells(heatmap: dict) -> list[float]:
    return [v for row in heatmap["heatmap"]["probabilities"] for v in row]


def region_cells(heatmap: dict, x_min: float, x_max: float) -> list[float]:
    h = heatmap["heatmap"]
    ox, cs = h["origin"]["x"], h["cellSizeMeters"]
    return [v for row in h["probabilities"] for i, v in enumerate(row) if x_min < ox + i * cs < x_max]


def test_all_free_is_one_and_all_occupied_is_zero():
    p = Parking.model_validate(parking())
    free = build_heatmap(p, {("cam", "s1"): "free", ("cam", "s2"): "free"})
    full = build_heatmap(p, {("cam", "s1"): "occupied", ("cam", "s2"): "occupied"})
    assert set(region_cells(free, 0, 4)) == {1.0}
    assert set(region_cells(full, 0, 4)) == {0.0}


def test_region_without_information_is_neutral_and_outside_is_zero():
    hm = build_heatmap(Parking.model_validate(parking()), {("cam", "s1"): "free"})
    assert set(region_cells(hm, 6, 8)) == {NO_INFORMATION}  # region B has no slots
    assert set(region_cells(hm, 4, 6)) == {0.0}  # gap between regions


def test_cells_near_a_free_slot_score_higher():
    hm = build_heatmap(Parking.model_validate(parking()), {("cam", "s1"): "free", ("cam", "s2"): "occupied"})
    row = hm["heatmap"]["probabilities"][1]
    assert row[1] > 0.5 > row[6]  # x=0.75 is near s1 (free), x=3.25 near s2 (occupied)


def test_unknown_slots_are_ignored():
    p = Parking.model_validate(parking())
    hm = build_heatmap(p, {("cam", "s1"): "unknown", ("cam", "s2"): "free"})
    assert set(region_cells(hm, 0, 4)) == {1.0}


def test_heatmap_matches_frontend_schema():
    hm = build_heatmap(Parking.model_validate(parking()), {})
    assert hm["version"] == 1
    assert hm["geometry"]["regions"][0]["boundary"][0] == {"x": 0.0, "y": 0.0}
    assert hm["heatmap"]["origin"] == {"x": 0.25, "y": 0.25}
    assert len(hm["heatmap"]["probabilities"]) == 4  # 2 m / 0.5 m
    assert len(hm["heatmap"]["probabilities"][0]) == 16  # 8 m / 0.5 m


@pytest.mark.parametrize(
    "broken",
    [
        parking(slots=[{"deviceId": "cam", "slotId": "s1", "region": "Z", "x": 1, "y": 1}]),  # unknown region
        parking(slots=[{"deviceId": "cam", "slotId": "s1", "region": "A", "x": 1, "y": 1}] * 2),  # duplicate
        {**parking(), "config": {**parking()["config"], "schedule": {"timezone": "UTC", "weekly": {}}}},
    ],
)
def test_invalid_parking_config_rejected(broken):
    with pytest.raises(ValidationError):
        Parking.model_validate(broken)


@pytest.fixture
def client(tmp_path):
    (tmp_path / "parkings").mkdir()
    (tmp_path / "parkings" / "p1.json").write_text(json.dumps(parking()))
    return TestClient(create_app(tmp_path / "test.db", tmp_path / "parkings", stale_after_s=60))


def observe(client, s1="free", s2="occupied"):
    body = {
        "device_id": "cam",
        "ts": "2026-10-31T10:00:00Z",
        "slots": [{"slot_id": "s1", "state": s1, "conf": 0.9}, {"slot_id": "s2", "state": s2, "conf": 0.9}],
    }
    assert client.post("/api/v1/observations", json=body).status_code == 201


def test_parkings_endpoint_uses_camel_case(client):
    configs = client.get("/api/parkings").json()
    assert [c["id"] for c in configs] == ["p1"]
    assert configs[0]["totalSlots"] == 2 and configs[0]["slotSize"]["widthMeters"] == 0.7


def test_admin_fields_round_trip():
    raw = parking()
    raw["config"]["geometry"]["regions"][0] |= {"name": "North", "cameraIds": ["cam"], "slotCount": 2}
    raw["config"]["cameras"] = [
        {"id": "cam", "name": "Cam", "position": {"x": 2, "y": 3}, "headingDeg": 270, "rangeMeters": 4}
    ]
    p = Parking.model_validate(raw)
    config = p.config.model_dump(by_alias=True, exclude_none=True)
    assert config["cameras"][0]["headingDeg"] == 270
    region = build_heatmap(p, {})["geometry"]["regions"][0]
    assert region["name"] == "North" and region["cameraIds"] == ["cam"] and region["slotCount"] == 2


def test_parkings_endpoint_always_lists_cameras(client):
    assert client.get("/api/parkings").json()[0]["cameras"] == []


def test_heatmap_endpoint_reflects_latest_observation(client):
    observe(client, "free", "free")
    assert set(region_cells(client.get("/api/parkings/p1/heatmap").json(), 0, 4)) == {1.0}
    observe(client, "occupied", "occupied")
    assert set(region_cells(client.get("/api/parkings/p1/heatmap").json(), 0, 4)) == {0.0}
    assert client.get("/api/parkings/nope/heatmap").status_code == 404


def test_offline_camera_becomes_unknown(client, tmp_path):
    observe(client, "occupied", "occupied")
    store = Store(tmp_path / "test.db")
    assert store.current_slot_states(60) != {}
    later = datetime.now(UTC) + timedelta(seconds=120)
    assert store.current_slot_states(60, now=later) == {}


def test_shipped_parking_configs_are_valid():
    client = TestClient(create_app(":memory:"))
    configs = client.get("/api/parkings").json()
    assert configs, "code/backend/parkings/ should contain at least one parking"
    for config in configs:
        r = client.get(f"/api/parkings/{config['id']}/heatmap")
        assert r.status_code == 200
        assert cells(r.json())
