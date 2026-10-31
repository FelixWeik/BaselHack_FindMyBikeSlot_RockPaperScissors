import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.geometry import Box
from app.main import create_app

JPEG = b"\xff\xd8" + b"\x00" * 100 + b"\xff\xd9"
HEADERS = {"Content-Type": "image/jpeg", "X-Device-Id": "cam-test", "X-RSSI": "-55", "X-Uptime-S": "12"}
SLOTS = {
    "device_id": "cam-test",
    "slots": [
        {"slot_id": "s1", "polygon": [[0, 70], [100, 70], [100, 100], [0, 100]]},
        {"slot_id": "s2", "polygon": [[200, 70], [300, 70], [300, 100], [200, 100]]},
    ],
}


class FakeDetector:
    def __init__(self, boxes=None, fail=False):
        self.boxes = boxes or []
        self.fail = fail

    def detect(self, jpeg):
        if self.fail:
            raise RuntimeError("model crashed")
        return self.boxes


@pytest.fixture
def make_client(tmp_path):
    def make(detector=None, record=False):
        sent = []
        settings = Settings(
            slots_dir=tmp_path / "slots", record_dir=tmp_path / "rec" if record else None, debounce_frames=1
        )
        app = create_app(settings, detector or FakeDetector(), sent.append)
        return TestClient(app), sent, tmp_path

    return make


def test_frame_without_slots_is_accepted_but_not_forwarded(make_client):
    client, sent, _ = make_client()
    r = client.post("/api/v1/frames", content=JPEG, headers=HEADERS)
    assert r.status_code == 200
    assert sent == []
    assert client.get("/api/v1/devices/cam-test/frame.jpg").content == JPEG


def test_slot_states_are_forwarded_to_backend(make_client):
    client, sent, _ = make_client(FakeDetector([Box(0, 0, 100, 100, conf=0.9)]))
    assert client.put("/api/v1/devices/cam-test/slots", json=SLOTS).status_code == 200
    client.post("/api/v1/frames", content=JPEG, headers=HEADERS)
    assert len(sent) == 1
    obs = sent[0]
    assert obs["device_id"] == "cam-test"
    assert {s["slot_id"]: s["state"] for s in obs["slots"]} == {"s1": "occupied", "s2": "free"}


def test_detector_failure_reports_unknown(make_client):
    client, sent, _ = make_client(FakeDetector(fail=True))
    client.put("/api/v1/devices/cam-test/slots", json=SLOTS)
    assert client.post("/api/v1/frames", content=JPEG, headers=HEADERS).status_code == 200
    assert {s["state"] for s in sent[0]["slots"]} == {"unknown"}


@pytest.mark.parametrize(
    ("body", "headers", "status"),
    [
        (b"not a jpeg", HEADERS, 400),
        (b"", HEADERS, 400),
        (JPEG, {**HEADERS, "X-Device-Id": "../etc"}, 400),
        (JPEG, {"Content-Type": "image/jpeg"}, 400),
    ],
)
def test_invalid_frames_rejected(make_client, body, headers, status):
    client, _, _ = make_client()
    assert client.post("/api/v1/frames", content=body, headers=headers).status_code == status


def test_frames_not_written_to_disk_by_default(make_client):
    client, _, tmp = make_client()
    client.post("/api/v1/frames", content=JPEG, headers=HEADERS)
    assert not (tmp / "rec").exists()


def test_recording_is_opt_in_and_throttled(make_client):
    client, _, tmp = make_client(record=True)
    for _ in range(3):
        client.post("/api/v1/frames", content=JPEG, headers=HEADERS)
    assert len(list((tmp / "rec" / "cam-test").glob("*.jpg"))) == 1


def test_slot_config_validation(make_client):
    client, _, _ = make_client()
    dup = {"device_id": "cam-test", "slots": [SLOTS["slots"][0], SLOTS["slots"][0]]}
    assert client.put("/api/v1/devices/cam-test/slots", json=dup).status_code == 400
    assert client.put("/api/v1/devices/other/slots", json=SLOTS).status_code == 400
    assert client.get("/api/v1/devices/cam-test/slots").json()["slots"] == []
