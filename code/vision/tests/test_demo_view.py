import io

from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.detector import Detection
from app.main import create_app

HEADERS = {"Content-Type": "image/jpeg", "X-Device-Id": "cam-test"}
BIKE = Detection((0.1, 0.2, 0.5, 0.9), 0.87)


def jpeg(color=(200, 200, 200)) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (320, 240), color).save(output, "JPEG")
    return output.getvalue()


class FakeDetector:
    def detect(self, _jpeg):
        return [BIKE]


class FakeAnonymizer:
    """Masks by painting the whole frame black, so the test can tell a masked frame from the raw one."""

    def __init__(self, fail=False):
        self.fail = fail

    def anonymize(self, _jpeg):
        if self.fail:
            raise RuntimeError("no model")
        return jpeg((0, 0, 0))


def client(demo_view: bool, anonymizer=None):
    app = create_app(Settings(demo_view=demo_view), FakeDetector(), lambda _obs: None, anonymizer or FakeAnonymizer())
    test_client = TestClient(app)
    test_client.post("/api/v1/frames", content=jpeg(), headers=HEADERS)
    app.state.worker.step()
    return test_client


def test_presenter_view_is_off_by_default():
    c = client(demo_view=False)
    assert c.get("/demo").status_code == 404
    assert c.get("/demo/cameras/cam-test/frame.jpg").status_code == 404


def test_presenter_view_shows_the_latest_frame_masked_with_bikes_boxed():
    c = client(demo_view=True)
    assert "Camera view" in c.get("/demo").text
    assert c.get("/demo/cameras").json()[0] | {"age_s": 0} == {"id": "cam-test", "bikes": 1, "status": "ok", "age_s": 0}

    answer = c.get("/demo/cameras/cam-test/frame.jpg")
    assert answer.status_code == 200
    assert answer.headers["cache-control"] == "no-store"
    image = Image.open(io.BytesIO(answer.content)).convert("RGB")
    assert image.getpixel((5, 5))[0] < 20  # the masked (black) frame, not the raw grey one
    left_edge = image.getpixel((int(0.1 * 320), int(0.6 * 240)))
    assert left_edge[1] > 150 > left_edge[0]  # green box outline


def test_presenter_view_sends_nothing_when_masking_fails():
    c = client(demo_view=True, anonymizer=FakeAnonymizer(fail=True))
    assert c.get("/demo/cameras/cam-test/frame.jpg").status_code == 503


def test_unknown_camera_has_no_frame():
    assert client(demo_view=True).get("/demo/cameras/nope/frame.jpg").status_code == 404
