import io

from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.main import MAX_FRAME_BYTES, create_app
from demo.demo_cameras import FRAME_SIZE, Camera, frame_at, load_cameras


class CountingDetector:
    def __init__(self):
        self.seen = []

    def detect(self, jpeg):
        self.seen.append(jpeg)
        return []


def test_every_simulated_camera_has_a_unique_id_and_sends_frames_a_camera_could_send():
    cameras = load_cameras()
    assert len({camera.device_id for camera in cameras}) == len(cameras) == 7
    for camera in cameras:
        assert camera.device_id.startswith("sim-")
        for jpeg in camera.frames:
            assert len(jpeg) <= MAX_FRAME_BYTES
            width, height = Image.open(io.BytesIO(jpeg)).size
            assert width <= FRAME_SIZE[0] and height <= FRAME_SIZE[1]


def test_only_the_shelter_moves_through_scenes():
    frames = {camera.device_id: camera.frames for camera in load_cameras()}
    assert len(frames.pop("sim-abri")) == 7
    assert all(len(scenes) == 1 for scenes in frames.values())


def test_scenes_are_held_then_loop():
    camera = Camera("sim-x", (b"a", b"b"))
    assert [frame_at(camera, t, hold_s=10) for t in (0, 9.9, 10, 19.9, 20)] == [b"a", b"a", b"b", b"b", b"a"]


def test_simulated_frames_go_through_the_same_route_and_detector_as_a_camera():
    detector = CountingDetector()
    sent = []
    app = create_app(Settings(), detector, sent.append, object())
    camera = load_cameras()[0]
    answer = TestClient(app).post(
        "/api/v1/frames",
        content=camera.frames[0],
        headers={"Content-Type": "image/jpeg", "X-Device-Id": camera.device_id},
    )
    assert answer.status_code == 200
    assert app.state.worker.step()
    assert detector.seen == [camera.frames[0]]
    assert sent[0]["device_id"] == "sim-abri"
