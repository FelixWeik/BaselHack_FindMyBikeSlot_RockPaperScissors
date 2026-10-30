# Schnittstellen – Find my Bike Slot

> Gemeinsamer Vertrag zwischen Kamera, Auswertung, Backend und Frontend.
> Änderungen nur nach Absprache im Team – sonst passen die Teile nicht mehr zusammen.

```
Kamera ──(1) JPEG──▶ Auswertung :8001 ──(2) JSON──▶ Backend :8000 ──(3) Heatmap──▶ Frontend
```

Zeitangaben immer ISO 8601 in UTC, z. B. `2026-10-31T10:15:02Z`.

## (1) Kamera → Auswertung ✅ umgesetzt (`code/firmware`)

```
POST http://<auswertung>:8001/api/v1/frames
Content-Type: image/jpeg
X-Device-Id: cam-memox-nord      eindeutiger Name der Kamera
X-RSSI: -55                      WLAN-Signal in dBm
X-Uptime-S: 1234                 Sekunden seit Start der Kamera
Body: JPEG 640x480, alle 2 s
```

Antwort `200` = angekommen. Alles andere zählt die Kamera als Fehler.
**Privacy:** Das Bild wird nur im Arbeitsspeicher verarbeitet und danach verworfen – nie gespeichert.

## (2) Auswertung → Backend ✅ umgesetzt (`code/backend`)

```
POST http://<backend>:8000/api/v1/observations
Content-Type: application/json
```

```json
{
  "device_id": "cam-memox-nord",
  "ts": "2026-10-31T10:15:02Z",
  "slots": [
    {"slot_id": "s1", "state": "occupied", "conf": 0.92},
    {"slot_id": "s2", "state": "free",     "conf": 0.88},
    {"slot_id": "s3", "state": "unknown",  "conf": 0.0}
  ]
}
```

| Feld | Bedeutung |
|---|---|
| `device_id` | Kamera, von der das Foto kam (aus `X-Device-Id`) |
| `ts` | Zeitpunkt der Auswertung |
| `slots[].slot_id` | Stellplatz-Name, pro Kamera eindeutig |
| `slots[].state` | `free`, `occupied` oder `unknown` (z. B. Person verdeckt, Bild zu dunkel) |
| `slots[].conf` | Sicherheit der Auswertung, 0..1 |

Antwort `201`: `{"id": 1, "device_id": "cam-memox-nord", "free": 1, "occupied": 1, "unknown": 1}`
Ungültige Nachricht → `422` mit Erklärung, was falsch ist.

Kontrolle: `GET /api/v1/observations/latest` liefert die neueste Nachricht pro Kamera.

## (3) Backend → Frontend ⏳ geplant

Format: `ParkingHeatmap` aus `code/types/parkingHeatmap.ts`. Das Backend kennt die Position jedes
Stellplatzes auf dem Lageplan (in Metern) und rechnet die Zustände in das Wahrscheinlichkeits-Raster um.
