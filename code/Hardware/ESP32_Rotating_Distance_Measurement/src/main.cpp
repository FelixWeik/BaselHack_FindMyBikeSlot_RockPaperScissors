#include <Arduino.h>
#include <Wire.h>
#include <VL53L1X.h>

#define ENABLE_ULTRASONIC_SENSOR 0

constexpr uint8_t ENABLE_PIN = 4;
constexpr uint8_t DIRECTION_PIN = 16;
constexpr uint8_t STEP_PIN = 17;

constexpr uint32_t STEPS_PER_REVOLUTION = 6400;
constexpr uint32_t STEPS_PER_60_DEGREES = STEPS_PER_REVOLUTION / 6;
constexpr uint32_t STEPS_PER_170_DEGREES =
  (STEPS_PER_REVOLUTION * 170UL) / 360UL;
constexpr uint8_t ULTRASONIC_TRIG_PIN = 5;
constexpr uint8_t ULTRASONIC_ECHO_PIN = 18;

VL53L1X sensor;

struct Measurement {
  int tofMillimeters;
  int ultrasonicCentimeters;
};

Measurement measureDistances();
bool measure170Degrees(bool direction);
bool moveStepsAt1000StepsPerSecond(uint32_t steps, bool direction);
void moveBack170DegreesAt1000StepsPerSecond(bool direction);
bool pollResetCommand();
void returnToRoutineStart();

int32_t currentPositionSteps = 0;
bool resetRequested = false;

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("Starting up...");
  delay(500);

  // ESP32 default I2C pins: SDA = GPIO21, SCL = GPIO22.
  Wire.begin(21, 22);
  Wire.setClock(400000);

  sensor.setTimeout(500);
  if (!sensor.init()) {
    Serial.println("VL53L1X not detected. Check VIN, GND, SDA, and SCL.");
    while (true) {
      delay(1000);
    }
  }

  sensor.setDistanceMode(VL53L1X::Long);
  sensor.setROISize(4, 4);
  sensor.setMeasurementTimingBudget(50000);
  sensor.startContinuous(100);

  pinMode(ENABLE_PIN, OUTPUT);
  pinMode(DIRECTION_PIN, OUTPUT);
  pinMode(STEP_PIN, OUTPUT);
#if ENABLE_ULTRASONIC_SENSOR
  pinMode(ULTRASONIC_TRIG_PIN, OUTPUT);
  pinMode(ULTRASONIC_ECHO_PIN, INPUT);
#endif

  digitalWrite(ENABLE_PIN, LOW); // Enable: common active-low driver input.
  digitalWrite(STEP_PIN, LOW);
#if ENABLE_ULTRASONIC_SENSOR
  digitalWrite(ULTRASONIC_TRIG_PIN, LOW);
#endif

  Serial.println("Moving to the scan starting side");
  moveStepsAt1000StepsPerSecond(STEPS_PER_170_DEGREES / 2, false);
}

void loop() {
  if (pollResetCommand()) {
    returnToRoutineStart();
    Serial.println("Reset complete; restarting routine");
  }

  Serial.println("Moving 170 degrees forward");
  if (!measure170Degrees(true)) {
    returnToRoutineStart();
    return;
  }

  Serial.println("Returning 170 degrees at 1000 steps per second");
  if (!moveStepsAt1000StepsPerSecond(STEPS_PER_170_DEGREES, false)) {
    returnToRoutineStart();
  }
}

bool pollResetCommand() {
  static uint8_t commandProgress = 0;

  while (Serial.available() > 0) {
    const char character = static_cast<char>(Serial.read());
    if (commandProgress == 0 && character == 'r') {
      commandProgress = 1;
    } else if (commandProgress == 1 && character == 's') {
      commandProgress = 2;
    } else if (commandProgress == 2 && character == 't') {
      commandProgress = 0;
      resetRequested = true;
    } else {
      commandProgress = character == 'r' ? 1 : 0;
    }
  }

  const bool wasRequested = resetRequested;
  resetRequested = false;
  return wasRequested;
}

void returnToRoutineStart() {
  const bool direction = currentPositionSteps < 0;
  const uint32_t steps = static_cast<uint32_t>(direction
                                                  ? -currentPositionSteps
                                                  : currentPositionSteps);
  if (steps > 0) {
    digitalWrite(DIRECTION_PIN, direction ? HIGH : LOW);
    delayMicroseconds(10);

    constexpr uint32_t STEP_PERIOD_MICROSECONDS = 1000;
    for (uint32_t step = 0; step < steps; ++step) {
      digitalWrite(STEP_PIN, HIGH);
      delayMicroseconds(2);
      digitalWrite(STEP_PIN, LOW);
      while (micros() % STEP_PERIOD_MICROSECONDS != 0) {
        // Keep the return motion at approximately 1000 steps per second.
        break;
      }
    }
  }
  currentPositionSteps = 0;
}

Measurement measureDistances() {
  Measurement result;

  result.tofMillimeters = static_cast<int>(sensor.read());

#if ENABLE_ULTRASONIC_SENSOR
  digitalWrite(ULTRASONIC_TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(ULTRASONIC_TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(ULTRASONIC_TRIG_PIN, LOW);

  const unsigned long echoDuration =
      pulseIn(ULTRASONIC_ECHO_PIN, HIGH, 30000UL);
  result.ultrasonicCentimeters = echoDuration > 0
                                     ? static_cast<int>(echoDuration / 58UL)
                                     : -1;
#else
  result.ultrasonicCentimeters = 0;
#endif

  return result;
}

bool measure170Degrees(bool direction) {
  digitalWrite(DIRECTION_PIN, direction ? HIGH : LOW);
  delayMicroseconds(10); // Direction setup time.

  for (uint32_t step = 0; step < STEPS_PER_170_DEGREES; ++step) {
    if (pollResetCommand()) {
      return false;
    }
    digitalWrite(STEP_PIN, HIGH);
    delayMicroseconds(2);
    digitalWrite(STEP_PIN, LOW);
    currentPositionSteps += direction ? 1 : -1;

    // The next step is not issued until both sensors have been read. This
    // makes the rotation rate depend on measurement time rather than a fixed
    // step-rate constant.
    const Measurement measurement = measureDistances();
    Serial.print("Step ");
    Serial.print(step + 1);
    Serial.print(": VL53L1X = ");
    Serial.print(measurement.tofMillimeters);
    Serial.print(" mm, Ultrasonic = ");
    if (measurement.ultrasonicCentimeters >= 0) {
      Serial.print(measurement.ultrasonicCentimeters);
      Serial.println(" cm");
    } else {
      Serial.println("no echo");
    }
  }
  return true;
}

void moveBack170DegreesAt1000StepsPerSecond(bool direction) {
  moveStepsAt1000StepsPerSecond(STEPS_PER_170_DEGREES, direction);
}

bool moveStepsAt1000StepsPerSecond(uint32_t steps, bool direction) {
  digitalWrite(DIRECTION_PIN, direction ? HIGH : LOW);
  delayMicroseconds(10); // Direction setup time.

  constexpr uint32_t STEP_PERIOD_MICROSECONDS = 1000;
  for (uint32_t step = 0; step < steps; ++step) {
    if (pollResetCommand()) {
      return false;
    }
    const uint32_t stepStart = micros();
    digitalWrite(STEP_PIN, HIGH);
    delayMicroseconds(2);
    digitalWrite(STEP_PIN, LOW);
    currentPositionSteps += direction ? 1 : -1;

    while (micros() - stepStart < STEP_PERIOD_MICROSECONDS) {
      if (pollResetCommand()) {
        return false;
      }
    }
  }
  return true;
}