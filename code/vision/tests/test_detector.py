"""The model's and Deface's real code paths are exercised by hand (see README); here, what needs no model."""

import pytest

pytest.importorskip("PIL")


def test_dark_images_are_recognized():
    from PIL import Image

    from app.detector import is_too_dark

    assert is_too_dark(Image.new("RGB", (64, 48), (5, 5, 5)), 18)
    assert not is_too_dark(Image.new("RGB", (64, 48), (120, 120, 120)), 18)


def test_a_detector_that_is_still_loading_says_so():
    from app.detector import ModelNotReady, YoloDetector

    detector = YoloDetector("x.pt", ("bicycle",), 0.25, 640, 18)
    assert not detector.ready
    with pytest.raises(ModelNotReady):
        detector.detect(b"")
