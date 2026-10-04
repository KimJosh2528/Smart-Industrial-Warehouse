#pragma once

#include "api_client.h"
#include "local_feedback.h"
#include "servo_controller.h"

// Prototype-only emergency coordination. It latches after a valid server
// DANGER response because no safe reset/re-arm authority exists yet.
class EmergencyCoordinator {
 public:
  EmergencyCoordinator(DoorAccessController& doors, LocalFeedbackController& feedback)
      : doors_(doors), feedback_(feedback) {}

  void handleSensorResponse(const ApiResponse& response) {
    if (emergencyActive_) return;
    if (response.result != ApiResult::Ok || response.statusCode < 200 ||
        response.statusCode >= 300) return;
    if (response.body.indexOf("\"environmental_state\":\"DANGER\"") < 0) return;

    emergencyActive_ = true;
    doors_.emergencyUnlockAll();
    feedback_.activateEmergency();
  }

  bool active() const { return emergencyActive_; }

 private:
  DoorAccessController& doors_;
  LocalFeedbackController& feedback_;
  bool emergencyActive_ = false;
};
