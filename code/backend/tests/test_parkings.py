"""Admin API tests. Run with: uv run pytest"""

import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path / "test.db"))  # throwaway database per test


def parking(parking_id="parking-1", name="Parking 1", camera_id="cam-1"):
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
                    "boundary": [{"x": 2, "y": 2}, {"x": 6, "y": 2}, {"x": 6, "y": 4}, {"x": 2, "y": 4}],
                }
            ]
        },
        "slotSize": {"widthMeters": 0.7, "lengthMeters": 2},
        "schedule": {
            "timezone": "Europe/Zurich",
            "weekly": dict.fromkeys(("mon", "tue", "wed", "thu", "fri", "sat", "sun"), day),
        },
        "cameras": [
            {
                "id": camera_id,
                "name": "Camera 1",
                "calibratedAt": "2026-10-31T10:15:02Z",
                "views": [
                    {
                        "regionId": "cam-1-1",
                        "polygon": [
                            {"x": 0.1, "y": 0.5},
                            {"x": 0.4, "y": 0.5},
                            {"x": 0.4, "y": 0.8},
                            {"x": 0.1, "y": 0.9},
                        ],
                    }
                ],
            }
        ],
    }


def test_starts_without_parkings(client):
    assert client.get("/api/v1/parkings").json() == []


def test_put_then_get_round_trips(client):
    assert client.put("/api/v1/parkings/parking-1", json=parking()).status_code == 200
    saved = client.get("/api/v1/parkings").json()
    assert len(saved) == 1
    assert saved[0]["cameras"][0]["views"][0]["polygon"][3] == {"x": 0.1, "y": 0.9}
    assert saved[0]["cameras"][0]["id"] == "cam-1"
    assert "position" not in saved[0]["cameras"][0]


def test_put_replaces_and_keeps_order(client):
    client.put("/api/v1/parkings/parking-1", json=parking())
    client.put("/api/v1/parkings/parking-2", json=parking("parking-2", "Parking 2", "cam-2"))
    client.put("/api/v1/parkings/parking-1", json=parking(name="Renamed"))
    assert [p["name"] for p in client.get("/api/v1/parkings").json()] == ["Renamed", "Parking 2"]


def test_saved_parkings_survive_a_restart(tmp_path):
    TestClient(create_app(tmp_path / "test.db")).put("/api/v1/parkings/parking-1", json=parking())
    assert len(TestClient(create_app(tmp_path / "test.db")).get("/api/v1/parkings").json()) == 1


def test_a_row_from_an_older_schema_is_skipped(tmp_path):
    client = TestClient(create_app(tmp_path / "test.db"))
    client.put("/api/v1/parkings/parking-1", json=parking())
    with sqlite3.connect(tmp_path / "test.db") as db:
        db.execute("INSERT INTO parkings VALUES ('old', '2026-01-01T00:00:00Z', ?)", (json.dumps({"id": "old"}),))
    assert [p["id"] for p in client.get("/api/v1/parkings").json()] == ["parking-1"]
    assert client.get("/api/v1/parkings/old/occupancy").status_code == 404


def test_delete(client):
    client.put("/api/v1/parkings/parking-1", json=parking())
    assert client.delete("/api/v1/parkings/parking-1").status_code == 204
    assert client.get("/api/v1/parkings").json() == []
    # Gone already, or never saved: still a success, so the admin's save queue doesn't get stuck on it.
    assert client.delete("/api/v1/parkings/parking-1").status_code == 204
    assert client.delete("/api/v1/parkings/never-saved").status_code == 204


def test_refuses_mismatched_id(client):
    assert client.put("/api/v1/parkings/other", json=parking()).status_code == 422


@pytest.mark.parametrize(
    "change",
    [
        lambda p: p["cameras"][0]["views"][0]["polygon"][0].update(x=1.5),
        lambda p: p["geometry"]["regions"][0].update(boundary=[{"x": 0, "y": 0}]),
        lambda p: p["geometry"]["regions"][0].update(slotCount=0),
        lambda p: p["geometry"]["regions"][0].pop("id"),
        lambda p: p["schedule"]["weekly"]["mon"][0].update(start="25:00"),
        lambda p: p.update(unknownField=1),
    ],
)
def test_refuses_invalid_config(client, change):
    body = parking()
    change(body)
    assert client.put("/api/v1/parkings/parking-1", json=body).status_code == 422


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


def test_a_demo_count_replaces_the_cameras_until_it_is_cleared(client):
    client.put("/api/v1/parkings/parking-1", json=parking())
    assert client.get("/api/v1/parkings/parking-1/occupancy").json()["zones"][0]["status"] == "unknown"

    pinned = client.put("/api/v1/parkings/parking-1/zones/cam-1-1/demo", json={"detected": 2})
    assert pinned.status_code == 200
    assert client.get("/api/v1/demo/overrides").json() == {"parking-1": {"cam-1-1": 2}}
    zone = client.get("/api/v1/parkings/parking-1/occupancy").json()["zones"][0]
    assert (zone["status"], zone["detected"], zone["capacity"]) == ("valid", 2, 3)
    assert zone["occupancy"] == pytest.approx(2 / 3)

    assert client.delete("/api/v1/demo/overrides").status_code == 204
    assert client.get("/api/v1/parkings/parking-1/occupancy").json()["zones"][0]["status"] == "unknown"


def test_a_demo_count_must_fit_an_existing_zone(client):
    client.put("/api/v1/parkings/parking-1", json=parking())
    assert client.put("/api/v1/parkings/parking-1/zones/cam-1-1/demo", json={"detected": 4}).status_code == 422
    assert client.put("/api/v1/parkings/parking-1/zones/cam-1-1/demo", json={"detected": -1}).status_code == 422
    assert client.put("/api/v1/parkings/parking-1/zones/nope/demo", json={"detected": 1}).status_code == 404
    assert client.put("/api/v1/parkings/nope/zones/cam-1-1/demo", json={"detected": 1}).status_code == 404


def test_cors_origins_are_trimmed(tmp_path, monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "http://a.test, http://b.test")
    client = TestClient(create_app(tmp_path / "test.db"))
    reply = client.options(
        "/api/v1/parkings", headers={"Origin": "http://b.test", "Access-Control-Request-Method": "GET"}
    )
    assert reply.headers["access-control-allow-origin"] == "http://b.test"
