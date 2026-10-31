import logging
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.detector import Detection, ModelNotReady, TooDark
from app.main import create_app

JPEG = b"\xff\xd8" + b"\x00" * 100 + b"\xff\xd9"
HEADERS = {"Content-Type": "image/jpeg", "X-Device-Id": "cam-test", "X-RSSI": "-55", "X-Uptime-S": "12"}
BIKE = Detection((0.1, 0.2, 0.3, 0.4), 0.9)


class FakeDetector:
    def __init__(self, bikes=None, error=None):
        self.bikes = bikes or []
        self.error = error

    def detect(self, _jpeg):
        if self.error:
            raise self.error
        return self.bikes


class FakeAnonymizer:
    def __init__(self, fail=False):
        self.fail = fail
        self.seen = []

    def anonymize(self, jpeg):
        self.seen.append(jpeg)
        if self.fail:
            raise RuntimeError("no model")
        return b"\xff\xd8masked\xff\xd9"


@pytest.fixture
def make_client(tmp_path):
    def make(detector=None, anonymizer=None, record=False, capture_timeout_s=2.0):
        sent = []
        settings = Settings(record_dir=tmp_path / "rec" if record else None, capture_timeout_s=capture_timeout_s)
        app = create_app(settings, detector or FakeDetector(), sent.append, anonymizer or FakeAnonymizer())
        return TestClient(app), sent, app.state.worker

    return make


def post(client, body=JPEG, headers=HEADERS):
    return client.post("/api/v1/frames", content=body, headers=headers)


def test_frame_reports_normalized_boxes_even_for_an_uncalibrated_camera(make_client):
    client, sent, worker = make_client(FakeDetector([BIKE]))
    assert post(client).json() == {"ok": True}
    assert sent == []  # answered before analysing
    assert worker.step()
    assert sent[0]["device_id"] == "cam-test"
    assert sent[0]["status"] == "ok"
    assert sent[0]["bikes"] == [{"bbox": [0.1, 0.2, 0.3, 0.4], "conf": 0.9}]
    assert (sent[0]["rssi"], sent[0]["uptime_s"]) == (-55, 12)


def test_an_empty_scene_is_a_measurement(make_client):
    client, sent, worker = make_client(FakeDetector([]))
    post(client)
    worker.step()
    assert (sent[0]["status"], sent[0]["bikes"]) == ("ok", [])


@pytest.mark.parametrize(
    ("error", "status"), [(RuntimeError("x"), "failed"), (ModelNotReady("x"), "not_ready"), (TooDark(), "dark")]
)
def test_a_frame_that_was_not_analysed_is_not_an_empty_scene(make_client, error, status):
    client, sent, worker = make_client(FakeDetector(error=error))
    assert post(client).status_code == 200
    worker.step()
    assert (sent[0]["status"], sent[0]["bikes"]) == (status, [])


def test_only_the_latest_frame_of_a_camera_is_analysed(make_client):
    seen = []

    class Recording(FakeDetector):
        def detect(self, jpeg):
            seen.append(jpeg)
            return []

    client, _, worker = make_client(Recording())
    newest = b"\xff\xd8new\xff\xd9"
    post(client)
    post(client, newest)
    assert worker.step()
    assert not worker.step()
    assert seen == [newest]


def test_cameras_take_turns(make_client):
    client, sent, worker = make_client()
    for device in ("a", "b", "a"):
        post(client, headers=HEADERS | {"X-Device-Id": device})
    worker.step()
    worker.step()
    assert [s["device_id"] for s in sent] == ["a", "b"]
    assert not worker.step()


@pytest.mark.parametrize(
    ("body", "headers", "code"),
    [
        (JPEG, {"Content-Type": "image/jpeg"}, 400),
        (JPEG, HEADERS | {"X-Device-Id": "../evil"}, 400),
        (b"", HEADERS, 400),
        (b"not a jpeg", HEADERS, 400),
        (b"\xff\xd8truncated", HEADERS, 400),
        (b"\xff\xd8" + b"\x00" * (2 * 1024 * 1024) + b"\xff\xd9", HEADERS, 413),
    ],
)
def test_bad_frames_are_refused(make_client, body, headers, code):
    client, _, worker = make_client()
    assert post(client, body, headers).status_code == code
    assert not worker.step()


def capture_with_frame(client, app_waiting, frame=JPEG):
    """Asks for a capture, then lets the camera's next frame arrive."""
    answer = {}

    def ask():
        answer["response"] = client.post("/api/v1/devices/cam-test/calibration-capture")

    thread = threading.Thread(target=ask)
    thread.start()
    deadline = time.monotonic() + 2
    while not app_waiting and time.monotonic() < deadline:
        time.sleep(0.01)
    post(client, frame)
    thread.join()
    return answer["response"]


def test_capture_masks_the_next_frame_and_is_not_cached(make_client):
    anonymizer = FakeAnonymizer()
    client, _, _ = make_client(anonymizer=anonymizer)
    post(client, b"\xff\xd8old\xff\xd9")  # an earlier frame is not kept for later
    raw = b"\xff\xd8raw\xff\xd9"
    response = capture_with_frame(client, client.app.state.waiting, raw)
    assert response.status_code == 200
    assert anonymizer.seen == [raw]
    assert response.content == b"\xff\xd8masked\xff\xd9"
    assert raw not in response.content
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["content-type"] == "image/jpeg"


def test_failed_anonymization_sends_no_image(make_client, caplog):
    client, _, _ = make_client(anonymizer=FakeAnonymizer(fail=True))
    raw = b"\xff\xd8secret-raw-bytes\xff\xd9"
    with caplog.at_level(logging.DEBUG):
        response = capture_with_frame(client, client.app.state.waiting, raw)
    assert response.status_code == 503
    assert b"secret-raw-bytes" not in response.content
    assert response.headers["content-type"] == "application/json"
    assert "secret-raw-bytes" not in caplog.text


def test_capture_of_a_silent_camera_times_out(make_client):
    client, _, _ = make_client(capture_timeout_s=0.05)
    assert client.post("/api/v1/devices/cam-test/calibration-capture").status_code == 504
    assert client.app.state.waiting == {}


def test_capture_refuses_a_bad_device_id(make_client):
    client, _, _ = make_client()
    assert client.post("/api/v1/devices/bad!id/calibration-capture").status_code == 400


def test_no_route_serves_a_raw_frame(make_client):
    client, _, _ = make_client()
    paths = {route.path for route in client.app.routes}
    assert not any("frame.jpg" in path or "snapshot" in path or "detections" in path for path in paths)
    assert client.get("/").status_code == 404


def test_nothing_is_written_without_record_dir(make_client, tmp_path):
    client, _, worker = make_client()
    post(client)
    worker.step()
    assert not list(tmp_path.rglob("*.jpg"))


def test_frames_are_not_retained_after_analysis(make_client):
    client, _, worker = make_client()
    post(client)
    worker.step()
    assert not worker._mailboxes


def test_recording_is_opt_in(make_client, tmp_path):
    client, _, _ = make_client(record=True)
    post(client)
    assert len(list((tmp_path / "rec" / "cam-test").glob("*.jpg"))) == 1


def test_logs_carry_no_image_bytes(make_client, caplog):
    client, _, worker = make_client(FakeDetector(error=RuntimeError("boom")))
    raw = b"\xff\xd8secret-raw-bytes\xff\xd9"
    with caplog.at_level(logging.DEBUG):
        post(client, raw)
        worker.step()
    assert "secret-raw-bytes" not in caplog.text


def test_the_worker_thread_analyses_frames_in_the_background(make_client):
    client, sent, _ = make_client(FakeDetector([BIKE]))
    with client:
        post(client)
        deadline = time.monotonic() + 2
        while not sent and time.monotonic() < deadline:
            time.sleep(0.01)
    assert sent[0]["status"] == "ok"
