"""Mini-Empfänger zum Testen der Kamera-Firmware.

Nimmt Fotos auf POST /api/v1/frames an (Port 8001, wie später der Vision-Service)
und gibt Metadaten aus. Vorschau im Browser: http://localhost:8001/

Privacy: Pro Kamera wird nur das LETZTE Foto im Arbeitsspeicher gehalten (für die Vorschau)
und beim nächsten Foto überschrieben. Nichts wird auf die Festplatte geschrieben.
Strg+C beendet das Programm, dann ist auch das letzte Foto weg.

Start:  python3 code/firmware/tools/test_receiver.py
Nur Python-Standardbibliothek, keine Installation nötig.
"""

import html
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = 8001
MAX_BYTES = 2 * 1024 * 1024

# Letztes Foto + Infos pro Kamera – nur im RAM.
latest: dict[str, dict] = {}
lock = threading.Lock()

PAGE = """<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kamera-Vorschau</title>
<style>
  body {{ font-family: system-ui, sans-serif; margin: 16px; background: #f4f5f7; color: #222; }}
  h1 {{ font-size: 1.2rem; }}
  .cams {{ display: flex; flex-wrap: wrap; gap: 16px; }}
  .cam {{ background: #fff; border-radius: 10px; padding: 12px; box-shadow: 0 1px 3px #0002; }}
  .cam img {{ display: block; width: 640px; max-width: 100%; image-rendering: pixelated; border-radius: 6px; }}
  .meta {{ font-size: .85rem; color: #555; margin-top: 6px; }}
  .old {{ color: #c0392b; font-weight: 600; }}
</style></head>
<body>
<h1>Kamera-Vorschau <small>(nur im Arbeitsspeicher, aktualisiert alle 2 s)</small></h1>
<div class="cams">{cams}</div>
<script>
  setInterval(() => {{
    for (const img of document.querySelectorAll("img[data-dev]")) {{
      img.src = "/last.jpg?device=" + encodeURIComponent(img.dataset.dev) + "&t=" + Date.now();
    }}
    fetch("/status").then(r => r.json()).then(s => {{
      for (const [dev, info] of Object.entries(s)) {{
        const el = document.getElementById("meta-" + dev);
        if (!el) {{ location.reload(); return; }}
        el.className = "meta" + (info.age_s > 10 ? " old" : "");
        el.textContent = `${{info.bytes}} Bytes · RSSI ${{info.rssi}} dBm · Uptime ${{info.uptime}} s · vor ${{info.age_s}} s`;
      }}
    }}).catch(() => {{}});
  }}, 2000);
</script>
</body></html>"""


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
        if is_jpeg:
            with lock:  # altes Foto dieser Kamera wird überschrieben
                latest[device] = {"jpeg": body, "bytes": length, "rssi": rssi, "uptime": uptime, "t": time.time()}

        self._send(200, "application/json", json.dumps({"ok": True, "bytes": length, "jpeg": is_jpeg}).encode())

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/":
            with lock:
                devices = sorted(latest)
            cams = "".join(
                f'<div class="cam"><b>{html.escape(d)}</b>'
                f'<img data-dev="{html.escape(d)}" src="/last.jpg?device={html.escape(d)}" alt="">'
                f'<div class="meta" id="meta-{html.escape(d)}">…</div></div>'
                for d in devices
            ) or "<p>Noch kein Foto empfangen – läuft die Kamera?</p>"
            self._send(200, "text/html; charset=utf-8", PAGE.format(cams=cams).encode())
        elif url.path == "/last.jpg":
            device = parse_qs(url.query).get("device", [""])[0]
            with lock:
                entry = latest.get(device)
            if entry is None:
                self.send_error(404, "no frame for this device")
                return
            self._send(200, "image/jpeg", entry["jpeg"])
        elif url.path == "/status":
            now = time.time()
            with lock:
                status = {
                    d: {"bytes": e["bytes"], "rssi": e["rssi"], "uptime": e["uptime"], "age_s": round(now - e["t"])}
                    for d, e in latest.items()
                }
            self._send(200, "application/json", json.dumps(status).encode())
        else:
            self.send_error(404)

    def _send(self, code: int, content_type: str, body: bytes):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")  # Browser soll das Bild nicht zwischenspeichern
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # Standard-Log abschalten, wir loggen selbst
        pass


if __name__ == "__main__":
    print(f"Test-Empfänger läuft auf Port {PORT} – Vorschau: http://localhost:{PORT}/  (Strg+C beendet)")
    try:
        ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        pass
