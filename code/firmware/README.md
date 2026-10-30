# Kamera-Firmware – Find my Bike Slot

Die Kamera macht alle 2 Sekunden ein Foto und schickt es per WLAN an den Auswerte-Rechner.
Auf der Kamera wird nichts gespeichert – das Foto liegt nur kurz im Kamera-Puffer.

```
 Kamera (dieses Projekt) ──JPEG, HTTP POST──▶ Auswerte-Rechner :8001/api/v1/frames
```

## Hardware

- **Seeed XIAO ESP32S3 Sense** (mit aufgestecktem Kamera-Aufsatz, Sensor OV3660)
- **Externe WLAN-Antenne – Pflicht!** Ohne Antenne ist das Signal so schwach (≈ −90 dBm), dass keine
  Verbindung zustande kommt. Stecker: winziger runder Goldknopf (U.FL) auf der Seite mit der
  Metallkappe, Ecke gegenüber vom USB-C. Gerade aufdrücken, bis es klickt.
- USB-C-Kabel (Daten, nicht nur Laden) bzw. später USB-Netzteil / Powerbank

## Einrichten (einmalig)

```bash
# 1. PlatformIO installieren (falls nicht vorhanden)
uv tool install platformio          # oder: pip install platformio

# 2. Linux: Recht für den USB-Port
sudo usermod -aG dialout $USER      # danach neu anmelden – oder pro Terminal: newgrp dialout

# 3. Zugangsdaten anlegen (diese Datei ist in .gitignore und landet NIE auf GitHub)
cp include/secrets.h.example include/secrets.h
#    → WLAN-Name, WLAN-Passwort und ein OTA-Passwort eintragen
```

In `include/config.h` prüfen: `DEVICE_ID` (pro Kamera eindeutig!) und `VISION_FALLBACK_IP`
(IP des Auswerte-Rechners, `ip -4 addr` auf dem Rechner).

## Flashen und zuschauen

Alle `pio`-Befehle **in diesem Ordner** (`code/firmware/`) ausführen – dort liegt `platformio.ini`.

```bash
pio run -t upload        # per USB aufs Board laden
pio device monitor       # Ausgabe ansehen (Strg+C beendet)

pio run -e xiao_s3_ota -t upload   # Update über WLAN (Kamera muss im selben Netz sein,
                                   # upload_port in platformio.ini = IP der Kamera)
```

Erwartete Ausgabe:

```
=== Kamera 'cam-memox-nord' startet (letzter Start: Strom eingeschaltet) ===
Kamera bereit: Sensor-ID 0x3660 ...
WLAN verbunden! IP 192.168.21.63, Router 192.168.20.1, Signal -52 dBm
OTA bereit: ...
Foto: 13051 Bytes -> HTTP 200 (82 ms) | WLAN -55 dBm | Fehler in Folge: 0
```

## Testen ohne echten Server

Ein Mini-Empfänger (nur Python-Standardbibliothek) nimmt die Fotos an und zeigt das jeweils letzte
im Browser – **nur im Arbeitsspeicher**, nichts wird gespeichert:

```bash
python3 tools/test_receiver.py
# Vorschau: http://localhost:8001/
```

## Was die LED bedeutet

| LED | Bedeutung |
|---|---|
| kurzes Blitzen alle 2 s | alles gut, Foto angekommen |
| schnelles Blinken | sucht WLAN |
| Dauerlicht | letzter Versuch fehlgeschlagen (Server aus? falsche IP?) |

## Was die Kamera selbst repariert

| Problem | Reaktion |
|---|---|
| Programm hängt 30 s | Watchdog startet neu |
| 10 Fotos hintereinander nicht angekommen | Neustart |
| WLAN weg | verbindet neu; nach 60 s ohne WLAN Neustart |
| Kamera startet nicht | nach 10 s Neustart |

Beim Start steht im Log, **warum** zuletzt neu gestartet wurde (z. B. „Watchdog“ oder
„Spannung zu niedrig“ → besseres Netzteil/Kabel).

## Schnittstelle zum Auswerte-Rechner

```
POST http://<rechner>:8001/api/v1/frames
Content-Type: image/jpeg
X-Device-Id: cam-memox-nord      Name der Kamera (config.h)
X-RSSI: -55                      WLAN-Signal in dBm
X-Uptime-S: 1234                 Sekunden seit Start
Body: JPEG, 640x480
```

Antwort `200` = angekommen. Alles andere zählt als Fehler.

## Einstellungen (`include/config.h`)

| Einstellung | Standard | Wofür |
|---|---|---|
| `DEVICE_ID` | `cam-memox-nord` | Name der Kamera, pro Kamera eindeutig |
| `VISION_HOSTNAME` / `VISION_FALLBACK_IP` | `tempestD` / `192.168.22.2` | Ziel-Rechner: erst per Name (`.local`), sonst feste IP |
| `FRAME_SIZE` | `FRAMESIZE_VGA` (640×480) | Auflösung |
| `JPEG_QUALITY` | `10` | 0..63, kleiner = schärfer, größer |
| `CAMERA_VFLIP` / `CAMERA_HMIRROR` | `1` / `0` | Bild drehen / spiegeln je nach Montage |
| `CAPTURE_INTERVAL_MS` | `2000` | Abstand zwischen Fotos |

## Fehlersuche

| Meldung / Symptom | Ursache | Lösung |
|---|---|---|
| `Not a PlatformIO project` | im falschen Ordner | `cd code/firmware` |
| `Could not open /dev/ttyACM0` | kein Recht auf USB-Port | `newgrp dialout` (siehe Einrichten) |
| Upload hängt | Board nicht im Flash-Modus | BOOT halten, RESET drücken, BOOT loslassen, nochmal hochladen |
| `Netz nicht gefunden` / Signal < −85 dBm | Antenne fehlt | Antenne aufstecken |
| `Verbindung abgelehnt (Passwort?)` | falsches WLAN-Passwort | gespeichertes Passwort am Laptop anzeigen: `nmcli -s -g 802-11-wireless-security.psk connection show <WLAN>` |
| `HTTP -1` | Server nicht erreichbar | Server läuft? IP in `config.h` aktuell? Die ersten 1–2 Fehler nach dem Start sind normal |
| `Kamera-Start fehlgeschlagen` | Aufsatz sitzt nicht | USB ab, Kamera-Aufsatz fest aufdrücken |
| WLAN-Name/Passwort ohne „Login-Seite“ | ESP32 kann keine Login-Portale (z. B. Eduroam) | anderes WLAN oder Handy-Hotspot (2,4 GHz!) |
