#include <Arduino.h>
#include <WiFi.h>

#include "private_config.h"

namespace {

const char* statusName(wl_status_t status) {
  switch (status) {
    case WL_CONNECTED:
      return "WL_CONNECTED";
    case WL_NO_SSID_AVAIL:
      return "WL_NO_SSID_AVAIL";
    case WL_CONNECT_FAILED:
      return "WL_CONNECT_FAILED";
    case WL_CONNECTION_LOST:
      return "WL_CONNECTION_LOST";
    case WL_DISCONNECTED:
      return "WL_DISCONNECTED";
    case WL_IDLE_STATUS:
      return "WL_IDLE_STATUS";
    default:
      return "UNKNOWN";
  }
}

void printStatus(wl_status_t status) {
  Serial.print("STATUS=");
  Serial.print(static_cast<int>(status));
  Serial.print(" CLASS=");
  Serial.println(statusName(status));
}

const char* authModeName(wifi_auth_mode_t mode) {
  switch (mode) {
    case WIFI_AUTH_OPEN:
      return "OPEN";
    case WIFI_AUTH_WEP:
      return "WEP";
    case WIFI_AUTH_WPA_PSK:
      return "WPA_PSK";
    case WIFI_AUTH_WPA2_PSK:
      return "WPA2_PSK";
    case WIFI_AUTH_WPA_WPA2_PSK:
      return "WPA_WPA2_PSK";
    case WIFI_AUTH_WPA2_ENTERPRISE:
      return "WPA2_ENTERPRISE";
    case WIFI_AUTH_WPA3_PSK:
      return "WPA3_PSK";
    case WIFI_AUTH_WPA2_WPA3_PSK:
      return "WPA2_WPA3_PSK";
    case WIFI_AUTH_WAPI_PSK:
      return "WAPI_PSK";
    default:
      return "UNKNOWN";
  }
}

void scanNetworks() {
  Serial.println("WIFI SCAN START");
  const int networkCount = WiFi.scanNetworks();
  if (networkCount < 0) {
    Serial.println("WIFI SCAN FAILED");
    return;
  }

  for (int index = 0; index < networkCount; ++index) {
    Serial.print("SCAN SSID=");
    Serial.print(WiFi.SSID(index));
    Serial.print(" RSSI=");
    Serial.print(WiFi.RSSI(index));
    Serial.print(" CHANNEL=");
    Serial.print(WiFi.channel(index));
    Serial.print(" AUTH=");
    Serial.println(authModeName(WiFi.encryptionType(index)));
  }

  WiFi.scanDelete();
  Serial.println("WIFI SCAN END");
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(250);

  WiFi.mode(WIFI_STA);
  scanNetworks();
  WiFi.begin(FIRMWARE_WIFI_SSID, FIRMWARE_WIFI_PASSWORD);

  const uint32_t deadline = millis() + 15000;
  wl_status_t lastStatus = WL_IDLE_STATUS;
  bool statusPrinted = false;

  while (millis() < deadline && WiFi.status() != WL_CONNECTED) {
    const wl_status_t status = WiFi.status();
    if (!statusPrinted || status != lastStatus) {
      printStatus(status);
      lastStatus = status;
      statusPrinted = true;
    }
    delay(100);
  }

  const wl_status_t finalStatus = WiFi.status();
  if (!statusPrinted || finalStatus != lastStatus) {
    printStatus(finalStatus);
  }

  if (finalStatus == WL_CONNECTED) {
    Serial.println("WIFI CONNECTED");
    Serial.print("IP=");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WIFI TEST FAILED");
  }
}

void loop() {}
