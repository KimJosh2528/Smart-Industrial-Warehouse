#pragma once

#include "buzzer.h"
#include "lcd.h"
#include "servo_controller.h"

class LocalFeedbackController {
 public:
  LocalFeedbackController(BuzzerController& buzzer, LcdController& lcd)
      : buzzer_(buzzer), lcd_(lcd) {}

  void begin() {
    buzzer_.begin();
    lcd_.begin();
    lcd_.show("SYSTEM READY");
  }

  void activateEmergency() {
    emergencyActive_ = true;
    buzzer_.emergency();
    lcd_.show("EMERGENCY ACTIVE", "UNLOCK REQUESTED");
  }

  bool handleAccessResponse(DoorAccessController& doors, const String& areaId,
                            const ApiResponse& response) {
    const AccessDecision decision = classifyAccessResponse(response);
    const bool actuatorAccepted = doors.handleAccessResponse(areaId, response);
    if (emergencyActive_) return actuatorAccepted;
    if (decision == AccessDecision::Authorized) {
      buzzer_.success();
      lcd_.show("ACCESS GRANTED");
      return actuatorAccepted;
    }
    if (decision == AccessDecision::Denied) {
      buzzer_.denied();
      lcd_.show("ACCESS DENIED");
      return false;
    }
    buzzer_.error();
    lcd_.show(decision == AccessDecision::AuthenticationFailure ? "AUTH ERROR" : "NETWORK ERROR");
    return false;
  }

  void handleSensorResponse(const ApiResponse& response) {
    if (emergencyActive_) return;
    if (response.body.indexOf("\"environmental_state\":\"NORMAL\"") >= 0) {
      lcd_.show("SAFETY: NORMAL");
    } else if (response.body.indexOf("\"environmental_state\":\"WARNING\"") >= 0) {
      lcd_.show("SAFETY: WARNING");
    } else if (response.body.indexOf("\"environmental_state\":\"DANGER\"") >= 0) {
      lcd_.show("SAFETY: DANGER");
    }
  }

  void maintain() {
    buzzer_.maintain();
  }

 private:
  BuzzerController& buzzer_;
  LcdController& lcd_;
  bool emergencyActive_ = false;
};
