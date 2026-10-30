"""Automatische Tests: uv run pytest"""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(tmp_path / "test.db"))  # eigene Wegwerf-Datenbank


def example(device_id="cam-memox-nord"):
    return {
        "device_id": device_id,
        "ts": "2026-10-31T10:15:02Z",
        "slots": [
            {"slot_id": "s1", "state": "occupied", "conf": 0.92},
            {"slot_id": "s2", "state": "free", "conf": 0.88},
            {"slot_id": "s3", "state": "unknown", "conf": 0.0},
        ],
    }


def test_healthz(client):
    assert client.get("/healthz").json() == {"status": "ok"}


def test_post_observation_is_stored(client):
    r = client.post("/api/v1/observations", json=example())
    assert r.status_code == 201
    assert r.json() | {"id": 0} == {"id": 0, "device_id": "cam-memox-nord", "free": 1, "occupied": 1, "unknown": 1}

    latest = client.get("/api/v1/observations/latest").json()
    assert len(latest) == 1
    assert latest[0]["ts"] == "2026-10-31T10:15:02Z"
    assert latest[0]["slots"][0] == {"slot_id": "s1", "state": "occupied", "conf": 0.92}


def test_latest_is_per_device(client):
    client.post("/api/v1/observations", json=example("cam-a"))
    second = example("cam-a")
    second["slots"][0]["state"] = "free"
    client.post("/api/v1/observations", json=second)
    client.post("/api/v1/observations", json=example("cam-b"))

    latest = {o["device_id"]: o for o in client.get("/api/v1/observations/latest").json()}
    assert set(latest) == {"cam-a", "cam-b"}
    assert latest["cam-a"]["slots"][0]["state"] == "free"  # die neuere Nachricht gewinnt


@pytest.mark.parametrize(
    "change",
    [
        lambda o: o["slots"][0].update(state="vielleicht"),  # unbekannter Zustand
        lambda o: o["slots"][0].update(conf=5),  # conf außerhalb 0..1
        lambda o: o.update(slots=[]),  # keine Stellplätze
        lambda o: o.pop("device_id"),  # Pflichtfeld fehlt
    ],
)
def test_invalid_observation_rejected(client, change):
    obs = example()
    change(obs)
    assert client.post("/api/v1/observations", json=obs).status_code == 422
    assert client.get("/api/v1/observations/latest").json() == []  # nichts gespeichert
