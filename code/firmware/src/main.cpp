#include <Arduino.h>
#include <WiFi.h>            // WLAN-Bibliothek
#include <esp_camera.h>      // Kamera-Bibliothek von Espressif
#include "camera_pins.h"     // unsere Pin-Zuordnung
#include "secrets.h"         // WLAN-Name und Passwort (nicht im Repo)

const int LED_PIN = 21;      // gelbe User-LED, leuchtet bei LOW
bool cameraOk = false;

// Kamera einstellen und starten. Gibt true zurück, wenn es geklappt hat.
bool cameraInit() {
  camera_config_t config = {};          // alles erst mal auf 0
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;       // 20 MHz Takt für die Kamera
  config.ledc_channel = LEDC_CHANNEL_0; // interner Taktgeber, der XCLK erzeugt
  config.ledc_timer = LEDC_TIMER_0;

  config.pixel_format = PIXFORMAT_JPEG;     // Kamera liefert fertig komprimiertes JPEG
  config.frame_size = FRAMESIZE_QVGA;       // 320 x 240 Pixel
  config.jpeg_quality = 12;                 // 0..63, kleiner = schöner, aber größer
  config.fb_count = 2;                      // 2 Bildpuffer ...
  config.fb_location = CAMERA_FB_IN_PSRAM;  // ... im 8-MB-Zusatzspeicher
  config.grab_mode = CAMERA_GRAB_LATEST;    // immer das neueste Bild liefern

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Kamera-Start fehlgeschlagen, Fehler 0x%x\n", err);
    return false;
  }
  Serial.println("Kamera bereit");
  return true;
}

// Listet alle WLANs in Reichweite auf (nur zum Testen, braucht kein Passwort).
void wifiScan() {
  WiFi.mode(WIFI_STA);           // "Station" = Board verbindet sich mit einem WLAN (kein eigener Hotspot)
  Serial.println("=== WLAN-Scan ===");
  int n = WiFi.scanNetworks();
  for (int i = 0; i < n; i++) {
    Serial.printf("%2d  %-32s  Signal %4d dBm  Kanal %2d  %s\n", i + 1, WiFi.SSID(i).c_str(), WiFi.RSSI(i),
                  WiFi.channel(i), WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "offen" : "Passwort");
  }
  Serial.printf("%d Netze gefunden\n", n);
  WiFi.scanDelete();             // Ergebnisliste wieder freigeben
}

// Übersetzt den WLAN-Status in lesbaren Text.
const char *wifiStatusText(wl_status_t s) {
  switch (s) {
    case WL_CONNECTED:      return "verbunden";
    case WL_NO_SSID_AVAIL:  return "Netz nicht gefunden (zu schwach?)";
    case WL_CONNECT_FAILED: return "Verbindung abgelehnt (Passwort?)";
    case WL_CONNECTION_LOST:return "Verbindung verloren";
    case WL_DISCONNECTED:   return "getrennt";
    case WL_IDLE_STATUS:    return "wartet";
    default:                return "unbekannt";
  }
}

// Mit dem WLAN aus secrets.h verbinden. Wartet höchstens 20 Sekunden.
bool wifiConnect() {
  Serial.printf("Verbinde mit '%s' ...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);          // Funk nicht schlafen legen = schneller und stabiler
  WiFi.setAutoReconnect(true);   // bei Abbruch selbst neu verbinden
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    Serial.print(".");
    delay(500);
  }
  Serial.println();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("WLAN fehlgeschlagen: %s\n", wifiStatusText(WiFi.status()));
    return false;
  }
  Serial.printf("WLAN verbunden! IP %s, Router %s, Signal %d dBm\n", WiFi.localIP().toString().c_str(),
                WiFi.gatewayIP().toString().c_str(), WiFi.RSSI());
  return true;
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);   // LED aus
  delay(2000);                   // Monitor Zeit zum Verbinden geben
  cameraOk = cameraInit();
  wifiScan();
  wifiConnect();
}

void loop() {
  if (!cameraOk) {
    Serial.println("Keine Kamera - Aufsatz pruefen, dann RESET druecken");
    delay(2000);
    return;
  }

  digitalWrite(LED_PIN, LOW);               // LED an = "fotografiere"
  camera_fb_t *fb = esp_camera_fb_get();    // Foto holen
  digitalWrite(LED_PIN, HIGH);

  if (!fb) {
    Serial.println("Foto fehlgeschlagen");
  } else {
    Serial.printf("Foto: %u Bytes, %ux%u | WLAN: %s, %d dBm\n", fb->len, fb->width, fb->height,
                  wifiStatusText(WiFi.status()), WiFi.RSSI());
    esp_camera_fb_return(fb);               // Puffer SOFORT zurückgeben
  }
  delay(2000);
}
