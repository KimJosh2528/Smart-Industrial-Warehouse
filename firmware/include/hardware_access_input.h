#pragma once

#include "access_workflow.h"
#include "keypad.h"
#include "rfid.h"

class HardwareAccessInputSource final : public AccessInputSource {
 public:
  HardwareAccessInputSource(RfidManager& rfidManager, RfidReaderInterface& rfidReader,
                            KeypadManager& keypadManager, KeypadReaderInterface& keypadReader,
                            const char* areaId)
      : rfidManager_(rfidManager), rfidReader_(rfidReader), keypadManager_(keypadManager),
        keypadReader_(keypadReader), areaId_(areaId) {}

  bool begin() {
    const bool rfidReady = rfidManager_.begin(rfidReader_);
    const bool keypadReady = keypadManager_.begin(keypadReader_);
    return rfidReady || keypadReady;
  }

  bool poll(AccessInputEvent& event) override {
    event = {};
    if (areaId_ == nullptr || areaId_[0] == '\0') return false;

    RfidScan scan;
    if (rfidManager_.poll(rfidReader_, scan)) {
      event.kind = AccessWorkflowKind::Staff;
      event.method = AccessInputMethod::Rfid;
      event.areaId = areaId_;
      event.credentialHash = scan.credentialHash;
      return true;
    }

    KeypadSubmission submission;
    const KeypadEvent keypadEvent = keypadManager_.poll(keypadReader_, submission);
    if (keypadEvent != KeypadEvent::Submitted) return false;
    event.kind = FIRMWARE_CONFIG.truckPinSerialTestMode
        ? AccessWorkflowKind::Truck
        : AccessWorkflowKind::Staff;
    event.method = AccessInputMethod::Keypad;
    event.areaId = FIRMWARE_CONFIG.truckPinSerialTestMode
        ? FIRMWARE_CONFIG.truckPinSerialTestAreaId
        : areaId_;
    event.credentialHash = submission.credentialHash;
    return true;
  }

 private:
  RfidManager& rfidManager_;
  RfidReaderInterface& rfidReader_;
  KeypadManager& keypadManager_;
  KeypadReaderInterface& keypadReader_;
  const char* areaId_;
};
