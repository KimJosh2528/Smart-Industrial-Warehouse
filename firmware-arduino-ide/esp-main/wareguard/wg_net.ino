// =====================================================
// wg_net.ino - WiFi, NTP, HMAC, HTTPS heartbeat (Supabase)
// This tab is the ONLY owner of WiFi. Runs in its own task, so the
// door, fire alarm and smoke checks in loop() never wait for the network.
// =====================================================
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>
#include "mbedtls/md.h"
#include "secrets.h"
#include "ca_cert.h"

static SemaphoreHandle_t wgTsMutex = NULL;

String hmacHex(const String &key, const String &msg) {
  uint8_t out[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, (const uint8_t *)key.c_str(), key.length());
  mbedtls_md_hmac_update(&ctx, (const uint8_t *)msg.c_str(), msg.length());
  mbedtls_md_hmac_finish(&ctx, out);
  mbedtls_md_free(&ctx);
  char hex[65];
  for (int i = 0; i < 32; i++) sprintf(hex + 2 * i, "%02x", out[i]);
  return String(hex);
}

bool timeOk() { return time(nullptr) > 1700000000; }

// One timestamp source for ALL endpoints: always increasing, task-safe
static long wgNextTimestamp() {
  static long lastTs = 0;
  xSemaphoreTake(wgTsMutex, portMAX_DELAY);
  long ts = (long)time(nullptr);
  if (ts <= lastTs) ts = lastTs + 1;
  lastTs = ts;
  xSemaphoreGive(wgTsMutex);
  return ts;
}

// Auto-reconnect sa WiFi ug balik-sync sa NTP kung nawala
static void wgEnsureNetwork() {
  static unsigned long lastTry = 0;
  if (millis() - lastTry < 10000) return;
  lastTry = millis();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WIFI] lost, reconnecting");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    return;
  }
  if (!timeOk()) {
    Serial.println("[NTP] not synced, retrying");
    configTime(0, 0, "pool.ntp.org", "time.google.com");
  }
}

// Generic signed POST. Next endpoints (/sensor-reading, /access-event) reuse this.
static bool wgPostSigned(const char *path, const String &body) {
  if (!timeOk()) return false;

  String tsStr = String(wgNextTimestamp());
  String sig = hmacHex(DEVICE_SECRET, tsStr + "." + body);

  WiFiClientSecure client;
  client.setCACert(SUPABASE_CA);

  HTTPClient http;
  http.begin(client, String(FUNCTIONS_URL) + path);
  http.setConnectTimeout(5000);
  http.setTimeout(10000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-UID", DEVICE_UID);
  http.addHeader("X-Timestamp", tsStr);
  http.addHeader("X-Signature", sig);
  http.addHeader("apikey", ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + ANON_KEY);

  int code = http.POST(body);
  Serial.printf("[NET] %s HTTP %d\n", path, code);
  if (code <= 0) {
    char err[100];
    client.lastError(err, sizeof(err));
    Serial.println(String("[NET] error: ") + HTTPClient::errorToString(code) + " | " + err);
  }
  if (code > 0 && (code < 200 || code >= 300)) Serial.println(String("[NET] body: ") + http.getString());
  http.end();
  return code >= 200 && code < 300;
}

static void wgSendHeartbeat() {
  String body = String("{\"uptime_s\":") + (millis() / 1000) +
                ",\"rssi\":" + WiFi.RSSI() + ",\"fw\":\"main-s4a\"}";
  wgPostSigned("/heartbeat", body);
}

static void wgSendSensorReading() {
  if (!dhtValid) {
    Serial.println("[NET] sensor-reading skipped: DHT invalid");
    return;
  }
  String body = String("{\"temperature_c\":") + String(currentTemperature, 1) +
                ",\"humidity_pct\":" + String(currentHumidity, 1) +
                ",\"smoke_value\":" + String(smokeValue10) + "}";
  wgPostSigned("/sensor-reading", body);
}

// The network task. Lives on core 0, created once in netBegin().
static void netTask(void *arg) {
  unsigned long lastHb = 0;
  unsigned long lastSensor = 0;
  for (;;) {
    wgEnsureNetwork();
    if (WiFi.status() == WL_CONNECTED && timeOk() && verifyState == V_IDLE) {
      if (millis() - lastHb >= 15000) {
        lastHb = millis();
        wgSendHeartbeat();
      } else if (millis() - lastSensor >= 10000) {
        lastSensor = millis();
        wgSendSensorReading();
      }
    }
    vTaskDelay(500 / portTICK_PERIOD_MS);
  }
}

void netBegin() {
  wgTsMutex = xSemaphoreCreateMutex();
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);                 // does not wait, setup() continues
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  xTaskCreatePinnedToCore(netTask, "net", 12288, NULL, 1, NULL, 0);
}