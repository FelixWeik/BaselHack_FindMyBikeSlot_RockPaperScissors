"""Admin API tests. Run with: uv run pytest"""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path / "test.db"))  # throwaway database per test


def parking(parking_id="parking-1", name="Parking 1"):
    day = [{"start": "06:00", "end": "20:00"}]
    return {
        "version": 1,
        "id": parking_id,
        "name": name,
        "totalSlots": 3,
        "geometry": {
            "regions": [
                {
                    "id": "cam-1-1",
                    "name": "Aisle 1",
                    "slotCount": 3,
                    "cameraIds": ["cam-1"],
                    "boundary": [{"x": 2, "y": 2}, {"x": 6, "y": 2}, {"x": 6, "y": 4}, {"x": 2, "y": 4}],
                    "imagePolygon": [
                        {"x": 0.1, "y": 0.5},
                        {"x": 0.4, "y": 0.5},
                        {"x": 0.4, "y": 0.8},
                        {"x": 0.1, "y": 0.9},
                    ],
                }
            ]
        },
        "slotSize": {"widthMeters": 0.7, "lengthMeters": 2},
        "schedule": {
            "timezone": "Europe/Zurich",
            "weekly": dict.fromkeys(("mon", "tue", "wed", "thu", "fri", "sat", "sun"), day),
        },
        "cameras": [{"id": "cam-1", "name": "Camera 1", "calibratedAt": "2026-10-31T10:15:02Z"}],
    }


def test_starts_without_parkings(client):
    assert client.get("/api/v1/parkings").json() == []


def test_put_then_get_round_trips(client):
    assert client.put("/api/v1/parkings/parking-1", json=parking()).status_code == 200
    saved = client.get("/api/v1/parkings").json()
    assert len(saved) == 1
    assert saved[0]["geometry"]["regions"][0]["imagePolygon"][3] == {"x": 0.1, "y": 0.9}
    assert saved[0]["cameras"][0]["id"] == "cam-1"
    assert "position" not in saved[0]["cameras"][0]


def test_put_replaces_and_keeps_order(client):
    client.put("/api/v1/parkings/parking-1", json=parking())
    client.put("/api/v1/parkings/parking-2", json=parking("parking-2", "Parking 2"))
    client.put("/api/v1/parkings/parking-1", json=parking(name="Renamed"))
    assert [p["name"] for p in client.get("/api/v1/parkings").json()] == ["Renamed", "Parking 2"]


def test_saved_parkings_survive_a_restart(tmp_path):
    TestClient(create_app(tmp_path / "test.db")).put("/api/v1/parkings/parking-1", json=parking())
    assert len(TestClient(create_app(tmp_path / "test.db")).get("/api/v1/parkings").json()) == 1


def test_delete(client):
    client.put("/api/v1/parkings/parking-1", json=parking())
    assert client.delete("/api/v1/parkings/parking-1").status_code == 204
    assert client.get("/api/v1/parkings").json() == []
    assert client.delete("/api/v1/parkings/parking-1").status_code == 404


def test_refuses_mismatched_id(client):
    assert client.put("/api/v1/parkings/other", json=parking()).status_code == 422


@pytest.mark.parametrize(
    "change",
    [
        lambda p: p["geometry"]["regions"][0]["imagePolygon"][0].update(x=1.5),
        lambda p: p["geometry"]["regions"][0].update(boundary=[{"x": 0, "y": 0}]),
        lambda p: p["geometry"]["regions"][0].update(slotCount=-1),
        lambda p: p["schedule"]["weekly"]["mon"][0].update(start="25:00"),
        lambda p: p.update(unknownField=1),
    ],
)
def test_refuses_invalid_config(client, change):
    body = parking()
    change(body)
    assert client.put("/api/v1/parkings/parking-1", json=body).status_code == 422


def test_devices_come_from_observations(client):
    assert client.get("/api/v1/devices").json() == []
    observation = {
        "device_id": "cam-1",
        "ts": "2026-10-31T10:15:02Z",
        "slots": [{"slot_id": "s1", "state": "free", "conf": 0.9}],
    }
    client.post("/api/v1/observations", json=observation)
    client.post("/api/v1/observations", json=observation | {"ts": "2026-10-31T10:20:00Z"})
    assert client.get("/api/v1/devices").json() == [
        {"id": "cam-1", "name": "cam-1", "kind": "camera", "lastSeen": "2026-10-31T10:20:00Z"}
    ]


def test_browser_frontend_may_call_the_api(client):
    r = client.options(
        "/api/v1/parkings/parking-1",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "*"
