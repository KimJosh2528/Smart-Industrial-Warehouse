#pragma once

#include <Arduino.h>

#include "api_client.h"
#include "camera.h"
#include "servo_controller.h"

enum class PlateRecognitionStatus {
  Unavailable,
  Failed,
  NoPlate,
  Malformed,
  Succeeded,
};

struct PlateRecognitionResult {
  PlateRecognitionStatus status = PlateRecognitionStatus::Unavailable;
  String recognizedText;
};

// Server-side OCR boundary. No provider, credentials, or local OCR parser are
// selected in Phase 16. OCR output is never an authorization decision here.
class ServerOcrInterface {
 public:
  virtual ~ServerOcrInterface() = default;
  virtual PlateRecognitionStatus recognize(const CameraFrame& frame,
                                           PlateRecognitionResult& result) = 0;
};

class UnassignedServerOcr final : public ServerOcrInterface {
 public:
  PlateRecognitionStatus recognize(const CameraFrame& frame,
                                   PlateRecognitionResult& result) override {
    (void)frame;
    result = {};
    return PlateRecognitionStatus::Unavailable;
  }
};

// Only the existing server-authorized response can enter the actuator path.
// This adapter has no plate allowlist, OCR rule, or local authorization logic.
class TruckPlateAccessAdapter {
 public:
  static bool handleServerDecision(DoorAccessController& doors, const String& areaId,
                                   const ApiResponse& response) {
    return doors.handleAccessResponse(areaId, response);
  }
};
