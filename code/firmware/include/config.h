// Einstellungen der Kamera – hier anpassen, nicht im Code verstreut.
#pragma once

// Name dieser Kamera. Muss pro Kamera eindeutig sein (der Server ordnet damit die Stellplätze zu).
#define DEVICE_ID "cam-memox-nord"

// Wohin die Fotos gehen.
// Zuerst wird der Rechner über seinen Namen gesucht (mDNS: <name>.local),
// klappt das nicht, wird die feste IP benutzt.
#define VISION_HOSTNAME "tempestD"        // ohne ".local"
#define VISION_FALLBACK_IP "192.168.22.2"
#define VISION_PORT 8001
#define VISION_PATH "/api/v1/frames"

// Bild
#define FRAME_SIZE FRAMESIZE_VGA   // 640x480. Alternativen: FRAMESIZE_QVGA (320x240), FRAMESIZE_SVGA (800x600)
#define JPEG_QUALITY 10            // 0..63, kleiner = schärfer, aber größere Datei
#define CAMERA_VFLIP 1             // 1 = Bild auf den Kopf stellen (je nach Montage)
#define CAMERA_HMIRROR 0           // 1 = Bild links/rechts spiegeln

// Wie oft ein Foto geschickt wird.
#define CAPTURE_INTERVAL_MS 2000
#define HTTP_TIMEOUT_MS 5000

// Robustheit: Die Kamera soll tagelang allein laufen und sich selbst wieder fangen.
#define WIFI_CONNECT_TIMEOUT_MS 20000    // so lange pro Verbindungsversuch warten
#define WIFI_RESTART_AFTER_MS 60000      // so lange ohne WLAN → Neustart
#define MAX_CONSECUTIVE_FAILURES 10      // so viele Fehler hintereinander → Neustart
#define WATCHDOG_TIMEOUT_S 30            // Programm hängt so lange → automatischer Neustart
