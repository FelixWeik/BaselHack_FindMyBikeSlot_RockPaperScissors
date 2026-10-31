// Find my Bike Slot – camera node firmware (Seeed XIAO ESP32S3 Sense).
//
// Captures a JPEG every CAPTURE_INTERVAL_MS and POSTs it to the vision service.
// Frames only live in the camera frame buffer and are never stored on the device.

#include <Arduino.h>
#include <ArduinoOTA.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiMulti.h>
#include <esp_camera.h>
#include <esp_task_wdt.h>

#include "camera_pins.h"
#include "secrets.h"  // before config.h: it may override per-person defaults
#include "config.h"

const int LED_PIN = 21;  // user LED, active low

IPAddress visionIp;               // resolved after WiFi is up
int failures = 0;                 // consecutive capture/upload failures
unsigned long wifiLostSince = 0;  // 0 while connected
WiFiMulti wifiMulti;

struct WifiNetwork {
  const char *ssid;
  const char *password;
};
#ifndef WIFI_NETWORKS  // older secrets.h with a single network
#define WIFI_NETWORKS {{WIFI_SSID, WIFI_PASSWORD}}
#endif
const WifiNetwork WIFI_LIST[] = WIFI_NETWORKS;

// ---------- Status LED ----------
// short flash  = frame delivered
// steady on    = connecting to WiFi, or the last upload failed

void ledOn() { digitalWrite(LED_PIN, LOW); }
void ledOff() { digitalWrite(LED_PIN, HIGH); }
void ledFlash() {
  ledOn();
  delay(40);
  ledOff();
}

// ---------- Restart & watchdog ----------

void restart(const char *reason) {
  Serial.printf("RESTART: %s\n", reason);
  Serial.flush();
  delay(500);
  ESP.restart();
}

// Logged at boot so field failures (brownouts, hangs) can be diagnosed from the serial log.
const char *resetReasonText() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:  return "power on";
    case ESP_RST_SW:       return "software restart";
    case ESP_RST_PANIC:    return "crash";
    case ESP_RST_TASK_WDT:
    case ESP_RST_INT_WDT:
    case ESP_RST_WDT:      return "watchdog (main loop hung)";
    case ESP_RST_BROWNOUT: return "brownout (weak power supply or cable?)";
    default:               return "other (upload or RESET button)";
  }
}

void watchdogStart() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t cfg = {
      .timeout_ms = WATCHDOG_TIMEOUT_S * 1000, .idle_core_mask = 0, .trigger_panic = true};
  esp_task_wdt_reconfigure(&cfg);
#else
  esp_task_wdt_init(WATCHDOG_TIMEOUT_S, true);
#endif
  esp_task_wdt_add(NULL);
}

void watchdogFeed() { esp_task_wdt_reset(); }

// ---------- Camera ----------

bool cameraInit() {
  camera_config_t config = {};
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
  config.xclk_freq_hz = 20000000;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;

  config.pixel_format = PIXFORMAT_JPEG;  // sensor encodes JPEG in hardware
  config.frame_size = FRAME_SIZE;
  config.jpeg_quality = JPEG_QUALITY;
  config.fb_count = 2;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.grab_mode = CAMERA_GRAB_LATEST;  // never send a stale frame

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed, error 0x%x\n", err);
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  s->set_vflip(s, CAMERA_VFLIP);
  s->set_hmirror(s, CAMERA_HMIRROR);
  // The rack is shot against bright windows: let the DSP-assisted auto exposure lift the dark
  // foreground and allow more gain instead of exposing for the sky.
  s->set_exposure_ctrl(s, 1);
  s->set_aec2(s, 1);
  s->set_ae_level(s, 1);
  s->set_gain_ctrl(s, 1);
  s->set_gainceiling(s, GAINCEILING_8X);
  s->set_whitebal(s, 1);
  s->set_awb_gain(s, 1);
  s->set_lenc(s, 1);  // lens shading correction, removes the dark corners
  if (s->id.PID == OV3660_PID) {
    // OV3660 defaults are dark and oversaturated; values from the Espressif CameraWebServer example.
    s->set_brightness(s, 1);
    s->set_saturation(s, -2);
  }
  Serial.printf("Camera ready: sensor PID 0x%x (0x26 = OV2640, 0x3660 = OV3660, 0x5640 = OV5640)\n",
                s->id.PID);
  return true;
}

// ---------- WiFi ----------

const char *wifiStatusText(wl_status_t s) {
  switch (s) {
    case WL_CONNECTED:       return "connected";
    case WL_NO_SSID_AVAIL:   return "network not found (weak signal? antenna attached?)";
    case WL_CONNECT_FAILED:  return "connection rejected (wrong password?)";
    case WL_CONNECTION_LOST: return "connection lost";
    case WL_DISCONNECTED:    return "disconnected";
    case WL_IDLE_STATUS:     return "idle";
    default:                 return "unknown";
  }
}

// Scans and joins the strongest known network, so the same firmware works in the office WiFi and
// on a phone hotspot without reflashing.
bool wifiConnect() {
  static bool listAdded = false;
  if (!listAdded) {
    for (const WifiNetwork &n : WIFI_LIST) wifiMulti.addAP(n.ssid, n.password);
    listAdded = true;
  }
  Serial.printf("Connecting to the strongest of %u known networks ...\n", sizeof(WIFI_LIST) / sizeof(WIFI_LIST[0]));
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);  // modem sleep adds latency and causes dropped uploads
  WiFi.setAutoReconnect(true);

  unsigned long start = millis();
  ledOn();
  while (wifiMulti.run(5000) != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) {
    watchdogFeed();  // each run() scans and blocks for up to 5 s
  }
  ledOff();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("WiFi failed: %s\n", wifiStatusText(WiFi.status()));
    return false;
  }
  Serial.printf("WiFi connected to '%s': IP %s, gateway %s, RSSI %d dBm\n", WiFi.SSID().c_str(),
                WiFi.localIP().toString().c_str(), WiFi.gatewayIP().toString().c_str(), WiFi.RSSI());
  return true;
}

// Reconnects if needed; restarts the board if WiFi stays down for WIFI_RESTART_AFTER_MS.
bool wifiEnsure() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiLostSince = 0;
    return true;
  }
  if (wifiLostSince == 0) wifiLostSince = millis();
  Serial.printf("WiFi down (%s) for %lu s\n", wifiStatusText(WiFi.status()), (millis() - wifiLostSince) / 1000);
  if (wifiConnect()) {
    wifiLostSince = 0;
    return true;
  }
  if (millis() - wifiLostSince > WIFI_RESTART_AFTER_MS) restart("WiFi unavailable for too long");
  return false;
}

// ---------- Upload ----------

// One TCP connection is kept open across frames (HTTP/1.1 keep-alive). A fresh connection per
// frame costs a TCP handshake and slow-start every time, which dominates upload latency on WiFi.
WiFiClient visionClient;
HTTPClient http;

// Drops the kept-alive connection so the next frame reconnects (after errors or an IP change).
void visionDisconnect() {
  http.end();
  visionClient.stop();
}

// Prefer mDNS so the vision host can change IP; fall back to the static IP from config.h.
void resolveVision() {
  static bool mdnsStarted = false;
  if (!mdnsStarted) mdnsStarted = MDNS.begin(DEVICE_ID);
  IPAddress previous = visionIp;
  IPAddress ip = MDNS.queryHost(VISION_HOSTNAME, 3000);
  if (ip != IPAddress(0, 0, 0, 0)) {
    visionIp = ip;
    Serial.printf("Resolved %s.local -> %s\n", VISION_HOSTNAME, ip.toString().c_str());
  } else {
    visionIp.fromString(VISION_FALLBACK_IP);
    Serial.printf("%s.local not found, using fallback IP %s\n", VISION_HOSTNAME, VISION_FALLBACK_IP);
  }
  if (visionIp != previous) visionDisconnect();
}

// Returns the HTTP status code (200 = ok, negative = transport error).
int sendFrame(camera_fb_t *fb, bool *reused) {
  *reused = visionClient.connected();
  http.setReuse(true);
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.begin(visionClient, visionIp.toString(), VISION_PORT, VISION_PATH);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-RSSI", String(WiFi.RSSI()));
  http.addHeader("X-Uptime-S", String(millis() / 1000));
  int code = http.POST(fb->buf, fb->len);  // stream straight from the frame buffer, no copy
  if (code > 0) http.getString();          // drain the body, otherwise the connection can't be reused
  http.end();                              // keeps the socket open if the server allowed keep-alive
  if (code < 0) visionClient.stop();       // a broken socket must not be reused
  return code;
}

// A restart is the most reliable way to recover camera, WiFi stack and heap at once.
void countFailure() {
  failures++;
  ledOn();
  if (failures >= MAX_CONSECUTIVE_FAILURES) restart("too many consecutive failures");
}

// ---------- OTA updates ----------

bool otaStarted = false;
bool otaRunning = false;

// Listens for password-protected firmware updates on port 3232.
void otaSetup() {
  ArduinoOTA.setHostname(DEVICE_ID);
  ArduinoOTA.setPassword(OTA_PASSWORD);
  ArduinoOTA.setMdnsEnabled(false);  // mDNS is already started in resolveVision()
  ArduinoOTA.onStart([]() {
    Serial.println("OTA: receiving firmware ...");
    otaRunning = true;
    esp_task_wdt_delete(NULL);  // an upload takes longer than the watchdog timeout
    ledOn();
  });
  ArduinoOTA.onEnd([]() { Serial.println("\nOTA: done, restarting"); });
  ArduinoOTA.onProgress([](unsigned int done, unsigned int total) {
    static int lastPct = -1;
    int pct = done * 100 / total;
    if (pct / 10 != lastPct / 10) Serial.printf("OTA: %d %%\n", pct);
    lastPct = pct;
  });
  ArduinoOTA.onError([](ota_error_t err) {
    Serial.printf("OTA error %u (0 = auth failed)\n", err);
    // Only an update in progress needs a restart (the watchdog is off then). A wrong password is
    // just logged, otherwise anyone on the network could reboot the camera.
    if (otaRunning) restart("OTA aborted, previous firmware still active");
  });
  ArduinoOTA.begin();
  otaStarted = true;
  Serial.printf("OTA ready: 'pio run -e xiao_s3_ota -t upload' to %s\n", WiFi.localIP().toString().c_str());
}

// ---------- Main ----------

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  ledOff();
  delay(2000);  // give the serial monitor time to attach
  Serial.printf("\n=== Camera '%s' booting (reset reason: %s) ===\n", DEVICE_ID, resetReasonText());
  watchdogStart();

  if (!cameraInit()) {
    ledOn();
    delay(10000);  // keep the error visible in the serial log
    restart("camera init failed - check the camera module");
  }
  if (wifiConnect()) resolveVision();
}

void loop() {
  watchdogFeed();
  unsigned long cycleStart = millis();

  if (wifiEnsure()) {
    if (visionIp == IPAddress(0, 0, 0, 0)) resolveVision();  // WiFi was not up during setup()
    if (!otaStarted) otaSetup();

    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("Capture failed");
      countFailure();
    } else {
      bool reused = false;
      int code = sendFrame(fb, &reused);
      size_t len = fb->len;
      esp_camera_fb_return(fb);  // return the buffer immediately so the driver can refill it
      Serial.printf("Frame: %u bytes -> HTTP %d (%lu ms, %s) | RSSI %d dBm | consecutive failures: %d\n", len,
                    code, millis() - cycleStart, reused ? "reused" : "new conn", WiFi.RSSI(),
                    code == 200 ? 0 : failures + 1);
      if (code == 200) {
        failures = 0;
        ledFlash();
      } else {
        countFailure();
      }
    }
  }

  // Wait for the rest of the interval so the capture rate stays constant regardless of upload time.
  while (millis() - cycleStart < CAPTURE_INTERVAL_MS) {
    watchdogFeed();
    if (otaStarted) ArduinoOTA.handle();
    delay(20);
  }
}
