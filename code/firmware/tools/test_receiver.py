"""Mini-Empfänger zum Testen der Kamera-Firmware.

Nimmt Fotos auf POST /api/v1/frames an (Port 8001, wie später der Vision-Service),
gibt nur Metadaten aus und verwirft das Bild sofort – es wird NICHTS gespeichert.

Start:  python3 code/firmware/tools/test_receiver.py
Nur Python-Standardbibliothek, keine Installation nötig.
"""

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8001
MAX_BYTES = 2 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/api/v1/frames":
            self.send_error(404, "unknown path")
            return
        length = int(self.headers.get("Content-Length", 0))
        if not 0 < length <= MAX_BYTES:
            self.send_error(413 if length else 400, "bad size")
            return
        body = self.rfile.read(length)  # nur im RAM
        is_jpeg = body[:2] == b"\xff\xd8" and body[-2:] == b"\xff\xd9"
        device = self.headers.get("X-Device-Id", "?")
        rssi = self.headers.get("X-RSSI", "?")
        uptime = self.headers.get("X-Uptime-S", "?")
        print(
            f"{time.strftime('%H:%M:%S')}  {device:<16} {length:>6} Bytes  "
            f"JPEG {'ok' if is_jpeg else 'KAPUTT'}  RSSI {rssi} dBm  Uptime {uptime} s  "
            f"von {self.client_address[0]}",
            flush=True,
        )
        del body  # Bild verwerfen

        reply = json.dumps({"ok": True, "bytes": length, "jpeg": is_jpeg}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(reply)))
        self.end_headers()
        self.wfile.write(reply)

    def log_message(self, *args):  # Standard-Log abschalten, wir loggen selbst
        pass


if __name__ == "__main__":
    print(f"Test-Empfänger läuft auf Port {PORT} – warte auf Fotos (Strg+C beendet)")
    try:
        ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        pass
