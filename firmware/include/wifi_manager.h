#pragma once

#include <Arduino.h>
#include <WiFi.h>

#include "config.h"

class WifiManager {
 public:
  explicit WifiManager(const FirmwareConfig& config) : config_(config) {}

  void begin() {
    WiFi.mode(WIFI_STA);
    nextAttemptMs_ = 0;
    connectionAttemptActive_ = false;
    connectIfDue(true);
  }

  void maintain() { connectIfDue(false); }

  bool connected() const { return WiFi.status() == WL_CONNECTED; }

 private:
  void connectIfDue(bool immediate) {
    if (connected()) {
      if (connectionAttemptActive_) {
        connectionAttemptActive_ = false;
        reportConnected();
      }
      return;
    }

    const uint32_t now = millis();
    if (connectionAttemptActive_) {
      const wl_status_t status = WiFi.status();
      if (!statusObservedDuringAttempt_ || status != lastAttemptStatus_) {
        printStatusDiagnostic(status);
        lastAttemptStatus_ = status;
        statusObservedDuringAttempt_ = true;
      }
      if (static_cast<int32_t>(now - connectionDeadlineMs_) < 0) return;

      connectionAttemptActive_ = false;
      Serial.println("[WIFI] Connection unavailable; retry scheduled.");
      printStatusDiagnostic(WiFi.status());
      nextAttemptMs_ = now + config_.wifiRetryIntervalMs;
      return;
    }

    if (!immediate && static_cast<int32_t>(now - nextAttemptMs_) < 0) return;

    Serial.println("[WIFI] Attempting connection...");
    if (!config_.wifiSsid || config_.wifiSsid[0] == '\0') {
      Serial.println("[WIFI] Wi-Fi credentials are not configured.");
      nextAttemptMs_ = now + config_.wifiRetryIntervalMs;
      return;
    }

    WiFi.begin(config_.wifiSsid, config_.wifiPassword);
    connectionAttemptActive_ = true;
    statusObservedDuringAttempt_ = false;
    connectionDeadlineMs_ = now + 5000;
  }

  void reportConnected() {
    Serial.print("[WIFI] Connected. IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("[DNS DIAG] Gateway: ");
    Serial.println(WiFi.gatewayIP());
    Serial.print("[DNS DIAG] DNS0: ");
    Serial.println(WiFi.dnsIP(0));
    Serial.print("[DNS DIAG] DNS1: ");
    Serial.println(WiFi.dnsIP(1));
    IPAddress resolvedIp;
    const int dnsResult = WiFi.hostByName("odavmzgciaoahebanpmy.supabase.co", resolvedIp);
    Serial.print("[DNS DIAG] hostByName success: ");
    Serial.println(dnsResult == 1 ? "yes" : "no");
    if (dnsResult == 1) {
      Serial.print("[DNS DIAG] Resolved IP: ");
      Serial.println(resolvedIp);
    } else {
      Serial.print("[DNS DIAG] hostByName result: ");
      Serial.println(dnsResult);
    }
    Serial.print("[WIFI] RSSI: ");
    Serial.println(WiFi.RSSI());
  }

  void printStatusDiagnostic(wl_status_t status) {
    Serial.print("[WIFI-DIAG] STATUS=");
    Serial.print(static_cast<int>(status));
    Serial.print(" CLASS=");
    switch (status) {
      case WL_CONNECTED:
        Serial.println("WL_CONNECTED");
        break;
      case WL_NO_SSID_AVAIL:
        Serial.println("WL_NO_SSID_AVAIL");
        break;
      case WL_CONNECT_FAILED:
        Serial.println("WL_CONNECT_FAILED");
        break;
      case WL_CONNECTION_LOST:
        Serial.println("WL_CONNECTION_LOST");
        break;
      case WL_DISCONNECTED:
        Serial.println("WL_DISCONNECTED");
        break;
      case WL_IDLE_STATUS:
        Serial.println("WL_IDLE_STATUS");
        break;
      default:
        Serial.println("UNKNOWN");
        break;
    }
  }

  const FirmwareConfig& config_;
  uint32_t nextAttemptMs_ = 0;
  uint32_t connectionDeadlineMs_ = 0;
  bool connectionAttemptActive_ = false;
  bool statusObservedDuringAttempt_ = false;
  wl_status_t lastAttemptStatus_ = WL_IDLE_STATUS;
};
