#pragma once

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

#include "config.h"
#include "device_auth.h"
#include "time_manager.h"
#include "wifi_manager.h"

extern const uint8_t rootca_crt_bundle_start[]
    asm("_binary_data_cert_x509_crt_bundle_bin_start");

enum class ApiResult {
  Ok,
  HttpError,
  NetworkError,
  NotConfigured,
  TimeUnavailable,
};

enum class AccessDecision {
  Authorized,
  Denied,
  AuthenticationFailure,
  NetworkFailure,
  ServerFailure,
  InvalidResponse,
};
using RfidAccessDecision = AccessDecision;

struct ApiResponse {
  ApiResult result = ApiResult::NetworkError;
  int statusCode = -1;
  String body;
  String error;
};

inline AccessDecision classifyAccessResponse(const ApiResponse& response) {
  if (response.result == ApiResult::NetworkError || response.result == ApiResult::TimeUnavailable ||
      response.result == ApiResult::NotConfigured) return AccessDecision::NetworkFailure;
  if (response.statusCode == 401) return AccessDecision::AuthenticationFailure;
  if (response.statusCode >= 500) return AccessDecision::ServerFailure;
  if (response.statusCode == 200 && response.body.indexOf("\"status\":\"authorized\"") >= 0) {
    return AccessDecision::Authorized;
  }
  if (response.statusCode == 200 && response.body.indexOf("\"status\":\"denied\"") >= 0) {
    return AccessDecision::Denied;
  }
  return AccessDecision::InvalidResponse;
}

inline AccessDecision classifyRfidAccess(const ApiResponse& response) {
  return classifyAccessResponse(response);
}

class ApiClient {
 public:
  ApiClient(const FirmwareConfig& config, const WifiManager& wifi,
            const TimeManager& clock)
      : config_(config), wifi_(wifi), clock_(clock) {}

  ApiResponse heartbeat(const String& rawBody = "{}") {
    return request("POST", "/heartbeat", rawBody);
  }

  ApiResponse getDeviceConfig() { return request("GET", "/device-config", ""); }

  ApiResponse submitAccessEvent(const String& rawBody) {
    return request("POST", "/access-event", rawBody);
  }

  ApiResponse submitTruckRfidAccess(const String& areaId, const String& credentialHash) {
    const String rawBody = String("{\"area_id\":\"") + areaId +
        "\",\"credential_type\":\"truck_rfid\",\"credential_hash\":\"" +
        credentialHash + "\"}";
    Serial.println("[TRUCK-RFID] Sending access event.");
    return request("POST", "/access-event", rawBody);
  }

  // Truck PIN uses the truck-scoped credential contract.
  ApiResponse submitTruckPinAccess(const String& areaId, const String& credentialHash) {
    const String rawBody = String("{\"area_id\":\"") + areaId +
        "\",\"credential_type\":\"truck_pin\",\"credential_hash\":\"" +
        credentialHash + "\"}";
    Serial.println("[TRUCK-PIN] Sending access event.");
    return request("POST", "/access-event", rawBody);
  }

  ApiResponse submitTruckPlateImage(const uint8_t* jpegBytes, size_t jpegLength) {
    return requestBytes("POST", "/truck-plate", jpegBytes, jpegLength, "image/jpeg");
  }

  // Future face-result boundary. Recognition remains outside this firmware.
  ApiResponse submitFaceAccessResult(const String& rawBody) {
    return request("POST", "/access-event", rawBody);
  }

  ApiResponse submitSensorReading(const String& rawBody) {
    return request("POST", "/sensor-reading", rawBody);
  }

  ApiResponse submitDht22Reading(float temperatureC, float humidityPct) {
    return submitSafetySensorReading(temperatureC, humidityPct, false, 0.0f);
  }

  ApiResponse submitSafetySensorReading(float temperatureC, float humidityPct,
                                        bool hasSmokeValue, float smokeValue) {
    String rawBody = String("{\"temperature_c\":") + String(temperatureC, 2) +
        ",\"humidity_pct\":" + String(humidityPct, 2);
    if (hasSmokeValue) rawBody += String(",\"smoke_value\":") + String(smokeValue, 2);
    rawBody += "}";
    Serial.println("[DHT22] Sending sensor reading.");
    return request("POST", "/sensor-reading", rawBody);
  }

  ApiResponse submitSafetyEvent(const String& rawBody) {
    return request("POST", "/safety-event", rawBody);
  }

  ApiResponse updateAreaStatus(const String& rawBody) {
    return request("POST", "/area-status", rawBody);
  }

  ApiResponse submitStaffRfidAccess(const String& areaId, const String& credentialHash) {
    const String rawBody = String("{\"area_id\":\"") + areaId +
        "\",\"credential_type\":\"staff_rfid\",\"credential_hash\":\"" + credentialHash + "\"}";
    Serial.println("[RFID] Sending access event.");
    return request("POST", "/access-event", rawBody);
  }

  ApiResponse submitStaffPinAccess(const String& areaId, const String& credentialHash) {
    const String rawBody = String("{\"area_id\":\"") + areaId +
        "\",\"credential_type\":\"staff_pin\",\"credential_hash\":\"" + credentialHash + "\"}";
    Serial.println("[KEYPAD] Sending access event.");
    return request("POST", "/access-event", rawBody);
  }

 private:
  ApiResponse request(const char* method, const char* path, const String& rawBody) {
    return requestBytes(method, path,
                        reinterpret_cast<const uint8_t*>(rawBody.c_str()),
                        rawBody.length(), "application/json");
  }

  ApiResponse requestBytes(const char* method, const char* path,
                           const uint8_t* rawBody, size_t rawBodyLength,
                           const char* contentType) {
    ApiResponse response;
    Serial.print("[API] ");
    Serial.print(method);
    Serial.print(" ");
    Serial.println(path);

    if (!wifi_.connected()) {
      response.result = ApiResult::NetworkError;
      response.error = "wifi_unavailable";
      Serial.println("[API] Wi-Fi unavailable.");
      return response;
    }

    if (config_.functionBaseUrl == nullptr || config_.functionBaseUrl[0] == '\0' ||
        String(config_.functionBaseUrl).indexOf("<project-ref>") >= 0 ||
        config_.tlsCaCertificatePem == nullptr || config_.tlsCaCertificatePem[0] == '\0' ||
        config_.deviceUid == nullptr || config_.deviceUid[0] == '\0') {
      response.result = ApiResult::NotConfigured;
      response.error = "api_url_or_tls_ca_not_configured";
      Serial.println("[API] URL/TLS configuration is not ready.");
      return response;
    }

    if (!clock_.available()) {
      response.result = ApiResult::TimeUnavailable;
      response.error = "ntp_unavailable";
      Serial.println("[API] Request blocked: synchronized time unavailable.");
      return response;
    }

    const uint32_t timestamp = clock_.unixTimestamp();
    String signature;
    String signingReason;
    if (!signer_.signRequest(timestamp, rawBody, rawBodyLength, signature, signingReason,
                             config_.deviceSecret)) {
      response.result = ApiResult::NotConfigured;
      response.error = signingReason;
      Serial.println("[API] Request not sent: device authentication is not configured.");
      return response;
    }

    WiFiClientSecure client;
    Serial.printf("[TLS] CA bundle symbol=%p\n",
                  static_cast<const void*>(rootca_crt_bundle_start));
    client.setCACertBundle(rootca_crt_bundle_start);
    client.setTimeout(config_.requestTimeoutMs / 1000);

    HTTPClient http;
    const String url = String(config_.functionBaseUrl) + path;
    Serial.print("[API] URL: ");
    Serial.println(url);
    if (!http.begin(client, url)) {
      response.error = "http_begin_failed";
      return response;
    }

    http.setTimeout(config_.requestTimeoutMs);
    http.addHeader("Content-Type", contentType);
    http.addHeader("X-Device-UID", config_.deviceUid);
    http.addHeader("X-Timestamp", String(timestamp));
    http.addHeader("X-Signature", signature);

    if (strcmp(method, "GET") == 0) response.statusCode = http.GET();
    else response.statusCode = http.POST(const_cast<uint8_t*>(rawBody), rawBodyLength);
    if (response.statusCode >= 0) response.body = http.getString();
    response.error = http.errorToString(response.statusCode);
    http.end();

    if (response.statusCode >= 200 && response.statusCode < 300) {
      response.result = ApiResult::Ok;
    } else {
      response.result = ApiResult::HttpError;
    }

    Serial.print("[API] HTTP status: ");
    Serial.println(response.statusCode);
    return response;
  }

  const FirmwareConfig& config_;
  const WifiManager& wifi_;
  const TimeManager& clock_;
  RequestSigner signer_;
};
