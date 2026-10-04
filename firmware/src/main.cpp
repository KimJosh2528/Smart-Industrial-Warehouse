#include <Arduino.h>

#include "api_client.h"
#include "access_lockdown.h"
#include "access_workflow.h"
#include "buzzer.h"
#include "camera.h"
#include "capture_range.h"
#include "config.h"
#include "dht22.h"
#include "emergency_coordinator.h"
#include "face_recognition.h"
#include "hardware_access_input.h"
#include "i2c_lcd.h"
#include "matrix_keypad_reader.h"
#include "mfrc522_reader.h"
#include "keypad.h"
#include "rfid.h"
#include "safety_sensor_unit.h"
#include "smoke_sensor.h"
#include "shift_register.h"
#include "status_displays.h"
#include "servo_controller.h"
#include "lcd.h"
#include "local_feedback.h"
#include "plate_workflow.h"
#include "time_manager.h"
#include "wifi_manager.h"

WifiManager wifi(FIRMWARE_CONFIG);
TimeManager clockManager(FIRMWARE_CONFIG);
ApiClient api(FIRMWARE_CONFIG, wifi, clockManager);
Dht22Config dht22Config{FIRMWARE_CONFIG.dht22DataPin, FIRMWARE_CONFIG.dht22ReadIntervalMs};
Dht22Sensor dht22(dht22Config);
SmokeSensorConfig smokeConfig{FIRMWARE_CONFIG.smokeSensorSignalPin,
                              FIRMWARE_CONFIG.smokeSensorReadIntervalMs};
SmokeSensor smokeSensor(smokeConfig);
SafetySensorUnit safetySensorUnit(dht22, smokeSensor);
GpioServoDriver servoDrivers[3] = {
    GpioServoDriver(0), GpioServoDriver(1), GpioServoDriver(2)};
ServoDoorLock servoDoors[3] = {
    ServoDoorLock(FIRMWARE_CONFIG.servoSlots[0], servoDrivers[0]),
    ServoDoorLock(FIRMWARE_CONFIG.servoSlots[1], servoDrivers[1]),
    ServoDoorLock(FIRMWARE_CONFIG.servoSlots[2], servoDrivers[2]),
};
ServoAreaMapper servoMapper(FIRMWARE_CONFIG.servoSlots, 3);
DoorAccessController doorAccess(servoMapper, servoDoors, 3);
ShiftRegisterOutput shiftOutputs(FIRMWARE_CONFIG.shiftRegisterHardware);
ShiftRegisterBuzzerDriver buzzerDriver(shiftOutputs, 6);
BuzzerController buzzer(FIRMWARE_CONFIG.buzzerSignalPin, buzzerDriver);
I2cLcdDriver lcdDriver(FIRMWARE_CONFIG.lcdHardware);
LcdController lcd(lcdDriver);
StatusDisplays statusDisplays(lcd);
LocalFeedbackController localFeedback(buzzer, lcd);
SecurityIndicators securityIndicators(shiftOutputs);
EmergencyCoordinator emergencyCoordinator(doorAccess, localFeedback);
UnassignedCameraDriver cameraDriver;
CameraCaptureController camera;
UnassignedServerOcr serverOcr;
VisualCaptureRangeProvider visualCaptureRange;
UnassignedFaceRecognition faceRecognition;
AuthenticationFallbackController accessWorkflow;
RfidManager rfidManager;
Mfrc522Reader rfidReader(FIRMWARE_CONFIG.rfidHardware);
KeypadInputConfig keypadInputConfig{
    FIRMWARE_CONFIG.keypadMinimumPinLength,
    FIRMWARE_CONFIG.keypadMaximumPinLength,
    FIRMWARE_CONFIG.keypadInputTimeoutMs,
    FIRMWARE_CONFIG.keypadConfirmKey,
    FIRMWARE_CONFIG.keypadClearKey,
    FIRMWARE_CONFIG.keypadCancelKey};
KeypadManager keypadManager(keypadInputConfig);
// TEMPORARY: serial keypad test injection — restore the line below when physical keypad is available
// MatrixKeypadReader keypadReader(FIRMWARE_CONFIG.keypadHardware);
SerialKeypadReader keypadReader;
// END TEMPORARY
HardwareAccessInputSource accessInputSource(
    rfidManager, rfidReader, keypadManager, keypadReader, FIRMWARE_CONFIG.rfidDemoAreaId);
AccessLockdownManager accessLockdown(
    FIRMWARE_CONFIG.lockdownFailureThreshold,
    FIRMWARE_CONFIG.lockdownFirstStageMs,
    FIRMWARE_CONFIG.lockdownSecondStageMs);

void serviceWiFi() {
  wifi.maintain();
}

void serviceNtp() {
  clockManager.maintain(wifi.connected());

  static bool postNtpHeartbeatAttempted = false;
  if (!postNtpHeartbeatAttempted && clockManager.available()) {
    postNtpHeartbeatAttempted = true;
    api.heartbeat("{}");
  }
}

void serviceCamera() {
  // Camera capture is provider-driven; no hardware or recognition is assumed.
  (void)visualCaptureRange;
  (void)faceRecognition;
}

void serviceAccess() {
  const uint32_t now = millis();
  accessWorkflow.service(now);

  AccessInputEvent event;
  if (!accessInputSource.poll(event)) return;
  if (event.areaId.length() == 0 || emergencyCoordinator.active()) return;
  if (accessLockdown.isLockedDown(event.areaId, now)) {
    statusDisplays.lockdown();
    return;
  }

  if (!accessWorkflow.active()) {
    if (!accessWorkflow.start(event.kind, event.areaId, now,
                              FIRMWARE_CONFIG.keypadInputTimeoutMs,
                              accessLockdown, emergencyCoordinator.active())) {
      return;
    }
    accessWorkflow.service(now);
  }

  if (event.method != AccessInputMethod::Camera &&
      accessWorkflow.state() == AccessWorkflowState::CameraAuthentication) {
    accessWorkflow.submitCameraOutcome(AuthenticationOutcome::Unavailable, now, 0);
  }
  if (event.method == AccessInputMethod::Keypad &&
      accessWorkflow.state() == AccessWorkflowState::RfidAuthentication) {
    accessWorkflow.submitRfidOutcome(AuthenticationOutcome::Unavailable, now, 0);
  }

  if (event.method == AccessInputMethod::Camera &&
      accessWorkflow.state() == AccessWorkflowState::CameraAuthentication) {
    ApiResponse response;
    if (event.kind == AccessWorkflowKind::Truck && event.frame.bytes != nullptr &&
        event.frame.length > 0) {
      response = api.submitTruckPlateImage(event.frame.bytes, event.frame.length);
    } else {
      accessWorkflow.submitCameraOutcome(AuthenticationOutcome::Unavailable, now, 0);
      return;
    }
    const AccessDecision decision = classifyAccessResponse(response);
    if (decision == AccessDecision::Authorized) {
      if (event.kind == AccessWorkflowKind::Truck) {
        localFeedback.handleAccessResponse(doorAccess, event.areaId, response);
      } else {
        localFeedback.handleAccessResponse(doorAccess, event.areaId, response);
      }
      if (event.kind == AccessWorkflowKind::Truck) statusDisplays.truckGranted();
      else statusDisplays.staffGranted();
      if (event.kind == AccessWorkflowKind::Truck) securityIndicators.truckGranted();
      else securityIndicators.staffGranted();
      accessWorkflow.submitCameraOutcome(AuthenticationOutcome::Authorized, now, 0);
      accessLockdown.recordSuccess(event.areaId);
      accessWorkflow.reset();
    } else {
      if (event.kind == AccessWorkflowKind::Truck) {
        statusDisplays.truckDenied();
        securityIndicators.truckDenied();
      } else {
        statusDisplays.staffDenied();
        securityIndicators.staffDenied();
      }
      accessWorkflow.submitCameraOutcome(
          decision == AccessDecision::Denied || decision == AccessDecision::AuthenticationFailure
              ? AuthenticationOutcome::Failed
              : AuthenticationOutcome::Unavailable,
          now, 0);
    }
    return;
  }

  if (event.method == AccessInputMethod::Rfid &&
      accessWorkflow.state() == AccessWorkflowState::RfidAuthentication) {
    ApiResponse response;
    if (event.kind == AccessWorkflowKind::Truck) {
      response = api.submitTruckRfidAccess(event.areaId, event.credentialHash);
    } else {
      response = api.submitStaffRfidAccess(event.areaId, event.credentialHash);
    }
    const AccessDecision decision = classifyAccessResponse(response);
    if (decision == AccessDecision::Authorized) {
      if (event.kind == AccessWorkflowKind::Truck) {
        doorAccess.handleManualTruckAccessResponse(
            event.areaId, response, FIRMWARE_CONFIG.truckManualAuthRelockDelayMs);
      } else {
        localFeedback.handleAccessResponse(doorAccess, event.areaId, response);
      }
      if (event.kind == AccessWorkflowKind::Truck) {
        statusDisplays.truckGranted();
        securityIndicators.truckGranted();
      } else {
        statusDisplays.staffGranted();
        securityIndicators.staffGranted();
      }
      accessWorkflow.submitRfidOutcome(AuthenticationOutcome::Authorized, now, 0);
      accessLockdown.recordSuccess(event.areaId);
      accessWorkflow.reset();
    } else {
      if (event.kind == AccessWorkflowKind::Truck) {
        statusDisplays.truckDenied();
        securityIndicators.truckDenied();
      } else {
        statusDisplays.staffDenied();
        securityIndicators.staffDenied();
      }
      accessWorkflow.submitRfidOutcome(
          decision == AccessDecision::Denied || decision == AccessDecision::AuthenticationFailure
              ? AuthenticationOutcome::Failed
              : AuthenticationOutcome::Unavailable,
          now, 0);
    }
    return;
  }

  if (event.method == AccessInputMethod::Keypad &&
      accessWorkflow.state() == AccessWorkflowState::KeypadAuthentication) {
    const ApiResponse response = event.kind == AccessWorkflowKind::Truck
        ? api.submitTruckPinAccess(event.areaId, event.credentialHash)
        : api.submitStaffPinAccess(event.areaId, event.credentialHash);
    const AccessDecision decision = classifyAccessResponse(response);
    if (decision == AccessDecision::Authorized) {
      localFeedback.handleAccessResponse(doorAccess, event.areaId, response);
      if (event.kind == AccessWorkflowKind::Truck) {
        statusDisplays.truckGranted();
        securityIndicators.truckGranted();
      } else {
        statusDisplays.staffGranted();
        securityIndicators.staffGranted();
      }
      accessWorkflow.submitKeypadOutcome(AuthenticationOutcome::Authorized, now);
      accessLockdown.recordSuccess(event.areaId);
      accessWorkflow.reset();
    } else {
      if (event.kind == AccessWorkflowKind::Truck) {
        statusDisplays.truckDenied();
        securityIndicators.truckDenied();
      } else {
        statusDisplays.staffDenied();
        securityIndicators.staffDenied();
      }
      accessWorkflow.submitKeypadOutcome(
          decision == AccessDecision::Denied || decision == AccessDecision::AuthenticationFailure
              ? AuthenticationOutcome::Failed
              : AuthenticationOutcome::Unavailable,
          now);
    }
  }
}

void serviceRfid() {
  // Physical readers are not assigned yet. The backend request boundaries are
  // ready, but no local credential allowlist or reader driver is introduced.
}

void serviceKeypad() {
  // Physical keypad input remains provider-driven and non-blocking.
}

void serviceSafety() {
  CombinedSafetySensorReading reading;
  if (!safetySensorUnit.readIfDue(reading)) return;
  const bool smokeAvailable = reading.smoke.status == SmokeSensorStatus::Valid;
  const ApiResponse sensorResponse = api.submitSafetySensorReading(
      reading.dht22.temperatureC,
      reading.dht22.humidityPct,
      smokeAvailable,
      reading.smoke.smokeValue);
  emergencyCoordinator.handleSensorResponse(sensorResponse);
  localFeedback.handleSensorResponse(sensorResponse);
  if (emergencyCoordinator.active()) {
    securityIndicators.emergency(true);
    statusDisplays.emergency();
  } else if (sensorResponse.body.indexOf("\"environmental_state\":\"WARNING\"") >= 0) {
    statusDisplays.safetyWarning();
    securityIndicators.emergency(false);
  } else if (sensorResponse.body.indexOf("\"environmental_state\":\"NORMAL\"") >= 0) {
    statusDisplays.safetyNormal();
    securityIndicators.emergency(false);
  }
}

void serviceDoors() {
  doorAccess.maintain();
}

void serviceFeedback() {
  localFeedback.maintain();
  statusDisplays.maintain(millis());
  securityIndicators.maintain(millis());
}

void serviceCloudEvents() {
  // Access and safety submissions are initiated by their workflow services.
}

void setup() {
  Serial.begin(115200);
  delay(250);
  Serial.println("[BOOT] Smart Industrial Warehouse firmware foundation");
  Serial.println("[BOOT] Phase 10 Safety Sensor Unit foundation.");

  wifi.begin();
  if (wifi.connected()) clockManager.beginSynchronization();
  safetySensorUnit.begin();
  shiftOutputs.begin();
  accessInputSource.begin();
  for (ServoDoorLock& door : servoDoors) door.begin();
  statusDisplays.begin();
  localFeedback.begin();
  if (FIRMWARE_CONFIG.camera.enabled) camera.begin(cameraDriver);

  Serial.println("[TEST] Heartbeat foundation check");
  const ApiResponse result = api.heartbeat("{}");
  if (result.result != ApiResult::Ok) Serial.println("[TEST] Heartbeat was not accepted.");
}

void loop() {
  serviceWiFi();
  serviceNtp();
  serviceCamera();
  serviceAccess();
  serviceRfid();
  serviceKeypad();
  serviceSafety();
  serviceDoors();
  serviceFeedback();
  serviceCloudEvents();
  yield();
}
