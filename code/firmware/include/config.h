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

// Wie oft ein Foto geschickt wird.
#define CAPTURE_INTERVAL_MS 2000
#define HTTP_TIMEOUT_MS 5000
