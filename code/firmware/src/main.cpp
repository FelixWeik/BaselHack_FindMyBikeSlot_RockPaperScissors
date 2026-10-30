#include <Arduino.h>

const int LED_PIN = 21;   // gelbe User-LED am XIAO, leuchtet bei LOW

// Gibt aus, was das Board über sich selbst weiß.
void boardCheck() {
  Serial.println("=== Board-Check ===");
  Serial.printf("Chip:   %s, Revision %d, %d Kerne, %d MHz\n",
                ESP.getChipModel(), ESP.getChipRevision(), ESP.getChipCores(), ESP.getCpuFreqMHz());
  Serial.printf("Flash:  %d MB\n", ESP.getFlashChipSize() / (1024 * 1024));
  Serial.printf("RAM:    %d KB frei\n", ESP.getFreeHeap() / 1024);
  Serial.printf("PSRAM:  %d KB (gefunden: %s)\n", ESP.getPsramSize() / 1024, psramFound() ? "ja" : "nein");
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  boardCheck();
  digitalWrite(LED_PIN, LOW);    // kurz aufblinken = "ich lebe noch"
  delay(100);
  digitalWrite(LED_PIN, HIGH);
  delay(4900);                   // alle 5 Sekunden
}
