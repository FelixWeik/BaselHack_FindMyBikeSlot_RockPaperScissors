import io
import sys
import types

from PIL import Image

from app.anonymizer import DefaceAnonymizer


def jpeg(color=(200, 200, 200)) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (32, 32), color).save(output, "JPEG")
    return output.getvalue()


def test_deface_anonymizer_uses_blur_not_solid(monkeypatch):
    calls = {}

    class FakeCenterFace:
        def __init__(self, *args, **kwargs):
            pass

        def __call__(self, frame, threshold):
            calls["threshold"] = threshold
            return [[4, 4, 20, 20, 0.9]], None

    def fake_anonymize_frame(faces, frame, **kwargs):
        calls["replacewith"] = kwargs["replacewith"]
        calls["faces"] = faces

    deface = types.ModuleType("deface")
    deface.__path__ = []
    centerface = types.ModuleType("deface.centerface")
    centerface.CenterFace = FakeCenterFace
    face_ops = types.ModuleType("deface.deface")
    face_ops.anonymize_frame = fake_anonymize_frame
    fake_numpy = types.ModuleType("numpy")
    fake_numpy.array = lambda image: image
    monkeypatch.setitem(sys.modules, "deface", deface)
    monkeypatch.setitem(sys.modules, "deface.centerface", centerface)
    monkeypatch.setitem(sys.modules, "deface.deface", face_ops)
    monkeypatch.setitem(sys.modules, "numpy", fake_numpy)
    monkeypatch.setattr(Image, "fromarray", lambda frame: types.SimpleNamespace(save=lambda output, fmt, quality: output.write(b"\xff\xd8\xff\xd9")))

    out = DefaceAnonymizer().anonymize(jpeg())

    assert out.startswith(b"\xff\xd8")
    assert calls["replacewith"] == "blur"
    assert calls["threshold"] > 0
