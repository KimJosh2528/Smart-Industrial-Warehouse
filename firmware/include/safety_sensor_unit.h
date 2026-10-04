#pragma once

#include "dht22.h"
#include "smoke_sensor.h"

struct CombinedSafetySensorReading {
  Dht22Reading dht22;
  SmokeSensorReading smoke;
};

// The DHT22 cadence defines one coherent Safety Sensor Unit sampling cycle.
// Smoke is attempted only during that cycle; it never runs an independent
// loop and unavailable smoke hardware cannot block DHT22 operation.
class SafetySensorUnit {
 public:
  SafetySensorUnit(Dht22Sensor& dht22, SmokeSensor& smoke)
      : dht22_(dht22), smoke_(smoke) {}

  void begin() {
    dht22_.begin();
    smoke_.begin();
  }

  bool readIfDue(CombinedSafetySensorReading& reading) {
    Dht22Reading dht22Reading;
    if (!dht22_.readIfDue(dht22Reading)) return false;

    reading.dht22 = dht22Reading;
    reading.smoke = smoke_.sampleForCycle();
    return true;
  }

 private:
  Dht22Sensor& dht22_;
  SmokeSensor& smoke_;
};
