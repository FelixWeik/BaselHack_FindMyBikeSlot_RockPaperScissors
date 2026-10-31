"""Masks the faces of a calibration capture, in memory. Any `anonymize(jpeg) -> jpeg` object can be plugged in.

Deface can miss a face: the result is safer than the raw frame, not a guarantee.
"""

import io
import threading
from typing import Protocol

MASK_MARGIN = 1.3  # how much larger than the detected face the mask is
FACE_THRESHOLD = 0.2  # deliberately low: masking a bit of wall is better than showing a face


class Anonymizer(Protocol):
    def anonymize(self, jpeg: bytes) -> bytes: ...


class DefaceAnonymizer:
    """CenterFace through Deface's Python functions, without its CLI: nothing is ever written to disk."""

    def __init__(self) -> None:
        self._face_detector = None
        self._lock = threading.Lock()

    def anonymize(self, jpeg: bytes) -> bytes:
        import numpy as np
        from deface.centerface import CenterFace  # heavy imports, only when needed
        from deface.deface import anonymize_frame
        from PIL import Image

        frame = np.array(Image.open(io.BytesIO(jpeg)).convert("RGB"))
        with self._lock:
            if self._face_detector is None:
                self._face_detector = CenterFace(in_shape=None, backend="auto")
            faces, _ = self._face_detector(frame, threshold=FACE_THRESHOLD)
        anonymize_frame(
            faces,
            frame,
            mask_scale=MASK_MARGIN,
            replacewith="blur",
            ellipse=True,
            draw_scores=False,
            replaceimg=None,
            mosaicsize=20,
        )
        output = io.BytesIO()
        Image.fromarray(frame).save(output, "JPEG", quality=85)
        return output.getvalue()
