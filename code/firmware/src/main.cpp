// Find my Bike Slot – Kamera-Firmware (Seeed XIAO ESP32S3 Sense)
// Macht alle 2 s ein Foto und schickt es per HTTP an den Auswerte-Rechner.
// Das Foto liegt nur kurz im Kamera-Puffer und wird nirgends gespeichert.

#include <Arduino.h>
#include <ArduinoOTA.h>      // Firmware-Updates über WLAN
#include <ESPmDNS.h>         // Rechner im Netz über ihren Namen finden (<name>.local)
#include <HTTPClient.h>      // HTTP-Anfragen senden
#include <WiFi.h>            // WLAN-Bibliothek
#include <esp_camera.h>      // Kamera-Bibliothek von Espressif
#include <esp_task_wdt.h>    // Watchdog: startet das Board neu, wenn das Programm hängt
#include "camera_pins.h"     // unsere Pin-Zuordnung
#include "config.h"          // unsere Einstellungen (Ziel-Rechner, Intervall, ...)
#include "secrets.h"         // WLAN-Name und Passwort (nicht im Repo)

const int LED_PIN = 21;      // gelbe User-LED, leuchtet bei LOW
IPAddress visionIp;          // IP des Empfängers, wird nach dem WLAN-Start ermittelt
int failures = 0;            // Fehler hintereinander (Foto oder Senden)
unsigned long wifiLostSince = 0;  // seit wann kein WLAN (0 = WLAN ist da)

// ---------- Status-LED ----------
// kurzes Blitzen      = Foto erfolgreich gesendet
// schnelles Blinken   = sucht WLAN
// Dauerlicht          = letzter Versuch ist fehlgeschlagen

void ledOn()  { digitalWrite(LED_PIN, LOW); }
void ledOff() { digitalWrite(LED_PIN, HIGH); }
void ledFlash() { ledOn(); delay(40); ledOff(); }

// ---------- Neustart & Watchdog ----------

void restart(const char *reason) {
  Serial.printf("NEUSTART: %s\n", reason);
  Serial.flush();
  delay(500);
  ESP.restart();
}

// Warum hat das Board zuletzt (neu) gestartet? Hilft bei der Fehlersuche vor Ort.
const char *resetReasonText() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:  return "Strom eingeschaltet";
    case ESP_RST_SW:       return "Neustart durch Firmware";
    case ESP_RST_PANIC:    return "Absturz";
    case ESP_RST_TASK_WDT:
    case ESP_RST_INT_WDT:
    case ESP_RST_WDT:      return "Watchdog (Programm hing)";
    case ESP_RST_BROWNOUT: return "Spannung zu niedrig (Netzteil/Kabel zu schwach?)";
    default:               return "anderer Grund (z. B. Upload oder RESET-Taste)";
  }
}

void watchdogStart() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t cfg = {
      .timeout_ms = WATCHDOG_TIMEOUT_S * 1000, .idle_core_mask = 0, .trigger_panic = true};
  esp_task_wdt_reconfigure(&cfg);
#else
  esp_task_wdt_init(WATCHDOG_TIMEOUT_S, true);  // true = bei Ablauf neu starten
#endif
  esp_task_wdt_add(NULL);                       // diese Schleife überwachen
}

// "Ich lebe noch" an den Watchdog melden. Muss öfter als alle WATCHDOG_TIMEOUT_S passieren.
void watchdogFeed() { esp_task_wdt_reset(); }

// ---------- Kamera ----------

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
  config.frame_size = FRAME_SIZE;           // Auflösung aus config.h
  config.jpeg_quality = JPEG_QUALITY;       // 0..63, kleiner = schöner, aber größer
  config.fb_count = 2;                      // 2 Bildpuffer ...
  config.fb_location = CAMERA_FB_IN_PSRAM;  // ... im 8-MB-Zusatzspeicher
  config.grab_mode = CAMERA_GRAB_LATEST;    // immer das neueste Bild liefern

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Kamera-Start fehlgeschlagen, Fehler 0x%x\n", err);
    return false;
  }

  // Bild-Einstellungen am Sensor selbst
  sensor_t *s = esp_camera_sensor_get();
  s->set_vflip(s, CAMERA_VFLIP);        // auf den Kopf stellen
  s->set_hmirror(s, CAMERA_HMIRROR);    // links/rechts spiegeln
  Serial.printf("Kamera bereit: Sensor-ID 0x%x (0x26 = OV2640, 0x3660 = OV3660, 0x5640 = OV5640)\n",
                s->id.PID);
  return true;
}

// ---------- WLAN ----------

// Übersetzt den WLAN-Status in lesbaren Text.
const char *wifiStatusText(wl_status_t s) {
  switch (s) {
    case WL_CONNECTED:       return "verbunden";
    case WL_NO_SSID_AVAIL:   return "Netz nicht gefunden (zu schwach? Antenne?)";
    case WL_CONNECT_FAILED:  return "Verbindung abgelehnt (Passwort?)";
    case WL_CONNECTION_LOST: return "Verbindung verloren";
    case WL_DISCONNECTED:    return "getrennt";
    case WL_IDLE_STATUS:     return "wartet";
    default:                 return "unbekannt";
  }
}

// Mit dem WLAN aus secrets.h verbinden. Die LED blinkt schnell, solange gesucht wird.
bool wifiConnect() {
  Serial.printf("Verbinde mit '%s' ...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);           // "Station" = Board verbindet sich mit einem WLAN
  WiFi.setSleep(false);          // Funk nicht schlafen legen = schneller und stabiler
  WiFi.setAutoReconnect(true);   // bei kurzen Abbrüchen selbst neu verbinden
  WiFi.disconnect();             // evtl. halb offene alte Verbindung aufräumen
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) {
    watchdogFeed();              // Warten ist kein Hängen
    (millis() / 250) % 2 ? ledOn() : ledOff();
    delay(50);
  }
  ledOff();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("WLAN fehlgeschlagen: %s\n", wifiStatusText(WiFi.status()));
    return false;
  }
  Serial.printf("WLAN verbunden! IP %s, Router %s, Signal %d dBm\n", WiFi.localIP().toString().c_str(),
                WiFi.gatewayIP().toString().c_str(), WiFi.RSSI());
  return true;
}

// Sorgt dafür, dass WLAN da ist. Startet das Board neu, wenn es zu lange weg ist.
bool wifiEnsure() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiLostSince = 0;
    return true;
  }
  if (wifiLostSince == 0) wifiLostSince = millis();
  Serial.printf("WLAN weg (%s), seit %lu s\n", wifiStatusText(WiFi.status()), (millis() - wifiLostSince) / 1000);
  if (wifiConnect()) {
    wifiLostSince = 0;
    return true;
  }
  if (millis() - wifiLostSince > WIFI_RESTART_AFTER_MS) restart("zu lange kein WLAN");
  return false;
}

// ---------- Senden ----------

// Empfänger finden: erst über den Namen (mDNS), sonst die feste IP aus config.h.
void resolveVision() {
  static bool mdnsStarted = false;
  if (!mdnsStarted) mdnsStarted = MDNS.begin(DEVICE_ID);
  IPAddress ip = MDNS.queryHost(VISION_HOSTNAME, 3000);  // "Wer ist tempestD.local?" (max. 3 s)
  if (ip != IPAddress(0, 0, 0, 0)) {
    visionIp = ip;
    Serial.printf("Empfaenger %s.local gefunden: %s\n", VISION_HOSTNAME, ip.toString().c_str());
  } else {
    visionIp.fromString(VISION_FALLBACK_IP);
    Serial.printf("%s.local nicht gefunden, nehme feste IP %s\n", VISION_HOSTNAME, VISION_FALLBACK_IP);
  }
}

// Ein Foto per HTTP POST verschicken. Gibt den HTTP-Code zurück (200 = ok, negativ = Netzwerkfehler).
int sendFrame(camera_fb_t *fb) {
  HTTPClient http;
  String url = "http://" + visionIp.toString() + ":" + VISION_PORT + VISION_PATH;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.begin(url);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-Device-Id", DEVICE_ID);                 // wer schickt?
  http.addHeader("X-RSSI", String(WiFi.RSSI()));            // wie gut ist das WLAN?
  http.addHeader("X-Uptime-S", String(millis() / 1000));    // seit wann läuft das Board?
  int code = http.POST(fb->buf, fb->len);                   // Bild-Bytes direkt aus dem Kamera-Puffer
  http.end();
  return code;
}

// Fehler zählen. Zu viele hintereinander → Neustart (räumt Kamera, WLAN und Speicher komplett auf).
void countFailure() {
  failures++;
  ledOn();                                  // Dauerlicht = es klemmt
  if (failures >= MAX_CONSECUTIVE_FAILURES) restart("zu viele Fehler hintereinander");
}

// ---------- Update über WLAN (OTA) ----------

bool otaStarted = false;
bool otaRunning = false;     // läuft gerade ein Update?

// Wartet auf neue Firmware übers WLAN (Port 3232). Nur mit OTA_PASSWORD aus secrets.h.
void otaSetup() {
  ArduinoOTA.setHostname(DEVICE_ID);
  ArduinoOTA.setPassword(OTA_PASSWORD);
  ArduinoOTA.setMdnsEnabled(false);       // mDNS starten wir selbst (resolveVision)
  ArduinoOTA.onStart([]() {
    Serial.println("OTA: neue Firmware kommt ...");
    otaRunning = true;
    esp_task_wdt_delete(NULL);            // Upload dauert länger als der Watchdog erlaubt
    ledOn();
  });
  ArduinoOTA.onEnd([]() { Serial.println("\nOTA: fertig, starte neu"); });
  ArduinoOTA.onProgress([](unsigned int done, unsigned int total) {
    static int lastPct = -1;
    int pct = done * 100 / total;
    if (pct / 10 != lastPct / 10) Serial.printf("OTA: %d %%\n", pct);
    lastPct = pct;
  });
  ArduinoOTA.onError([](ota_error_t err) {
    Serial.printf("OTA-Fehler %u (0=Passwort falsch)\n", err);
    // Nur ein schon begonnenes Update braucht einen Neustart (Watchdog ist dann aus).
    // Ein falsches Passwort wird nur gemeldet – sonst könnte jeder die Kamera neu starten lassen.
    if (otaRunning) restart("OTA abgebrochen, alte Firmware laeuft weiter");
  });
  ArduinoOTA.begin();
  otaStarted = true;
  Serial.printf("OTA bereit: Update mit 'pio run -e xiao_s3_ota -t upload' an %s\n",
                WiFi.localIP().toString().c_str());
}

// ---------- Programm ----------

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  ledOff();
  delay(2000);                   // Monitor Zeit zum Verbinden geben
  Serial.printf("\n=== Kamera '%s' startet (letzter Start: %s) ===\n", DEVICE_ID, resetReasonText());
  watchdogStart();

  if (!cameraInit()) {
    ledOn();
    delay(10000);                // 10 s Zeit, die Meldung zu lesen
    restart("Kamera startet nicht - Aufsatz pruefen");
  }
  if (wifiConnect()) resolveVision();
}

void loop() {
  watchdogFeed();
  unsigned long cycleStart = millis();

  if (wifiEnsure()) {
    if (visionIp == IPAddress(0, 0, 0, 0)) resolveVision();  // falls WLAN beim Start noch fehlte
    if (!otaStarted) otaSetup();

    camera_fb_t *fb = esp_camera_fb_get();   // Foto holen
    if (!fb) {
      Serial.println("Foto fehlgeschlagen");
      countFailure();
    } else {
      int code = sendFrame(fb);
      size_t len = fb->len;
      esp_camera_fb_return(fb);               // Puffer SOFORT zurückgeben
      Serial.printf("Foto: %u Bytes -> HTTP %d (%lu ms) | WLAN %d dBm | Fehler in Folge: %d\n", len, code,
                    millis() - cycleStart, WiFi.RSSI(), code == 200 ? 0 : failures + 1);
      if (code == 200) {
        failures = 0;
        ledFlash();
      } else {
        countFailure();
      }
    }
  }

  // bis zum nächsten Foto warten (Sendezeit wird abgezogen, damit der Takt stimmt)
  while (millis() - cycleStart < CAPTURE_INTERVAL_MS) {
    watchdogFeed();
    if (otaStarted) ArduinoOTA.handle();     // nachschauen, ob ein Update ansteht
    delay(20);
  }
}
