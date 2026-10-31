"""Analyses frames one at a time, on one thread, so a slow model never holds up a camera's HTTP request.

Each camera has a mailbox holding its latest frame only: while the model is busy a newer frame replaces the waiting
one, and nothing queues up. Cameras take turns, so a fast one can't starve the others.
"""

import logging
import threading
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from .detector import Detector, ModelNotReady, TooDark

log = logging.getLogger("uvicorn.error")

SendObservation = Callable[[dict], None]


@dataclass(frozen=True)
class Pending:
    jpeg: bytes
    rssi: int | None
    uptime_s: int | None


class FrameWorker:
    def __init__(self, detector: Detector, send: SendObservation):
        self.detector = detector
        self.send = send
        self._mailboxes: OrderedDict[str, Pending] = OrderedDict()
        self._wake = threading.Condition()
        self._stopping = False
        self._thread: threading.Thread | None = None

    def submit(self, device_id: str, frame: Pending) -> None:
        with self._wake:
            self._mailboxes[device_id] = frame  # replacing keeps the camera's turn
            self._wake.notify()

    def _take(self, block: bool) -> tuple[str, Pending] | None:
        with self._wake:
            while block and not self._mailboxes and not self._stopping:
                self._wake.wait()
            return self._mailboxes.popitem(last=False) if self._mailboxes else None

    def process(self, device_id: str, frame: Pending) -> None:
        bikes = []
        try:
            bikes = self.detector.detect(frame.jpeg)
            status = "ok"
        except ModelNotReady:
            status = "not_ready"
        except TooDark:
            status = "dark"
        except Exception as err:
            # Only the error's type: a message could quote the input.
            log.error("Detection failed for %s: %s", device_id, type(err).__name__)
            status = "failed"
        self.send(
            {
                "device_id": device_id,
                "ts": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "status": status,
                "bikes": [{"bbox": list(b.bbox), "conf": b.conf} for b in bikes],
                "rssi": frame.rssi,
                "uptime_s": frame.uptime_s,
            }
        )

    def step(self) -> bool:
        """Handles one waiting frame, if any. For tests; the service runs `_run`."""
        taken = self._take(block=False)
        if taken:
            self.process(*taken)
        return taken is not None

    def _run(self) -> None:
        while True:
            taken = self._take(block=True)
            if taken is None:
                return
            device_id, frame = taken
            self.process(device_id, frame)
            del frame, taken

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="frame-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        with self._wake:
            self._stopping = True
            self._mailboxes.clear()
            self._wake.notify_all()
        if self._thread:
            self._thread.join(timeout=5)
