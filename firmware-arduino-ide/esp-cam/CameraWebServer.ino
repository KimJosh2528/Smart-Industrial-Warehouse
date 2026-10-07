#include "esp_camera.h"
#include <WiFi.h>

// Camera model: AI Thinker ESP32-CAM
#define CAMERA_MODEL_AI_THINKER
#include "camera_pins.h"

// ===== CHANGE ME =====
const char* ssid     = "LAPTOP-EEQF6QAM 2308";
const char* password = "kimjosh2528";
// =====================

void startCameraServer();

void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(true);
  Serial.println();

  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 10000000;
  config.pixel_format = PIXFORMAT_JPEG;

config.frame_size   = FRAMESIZE_VGA;
config.jpeg_quality = 15;
config.fb_count     = 2;
config.grab_mode    = CAMERA_GRAB_LATEST;
config.fb_location  = CAMERA_FB_IN_PSRAM;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x\n", err);
    return;
  }

  // Start at QVGA so face detection works smoothly
  sensor_t *s = esp_camera_sensor_get();
  s->set_framesize(s, FRAMESIZE_QVGA);
     s->set_vflip(s, 1);
   s->set_hmirror(s, 1);

  // Fixed IP so the laptop script never needs a new CAM_IP after a restart.
  // Hotspot network is 192.168.137.x. .234 is the address the CAM already used.
  IPAddress local_IP(192, 168, 137, 234);
  IPAddress gateway(192, 168, 137, 1);
  IPAddress subnet(255, 255, 255, 0);
  IPAddress dns(192, 168, 137, 1);
  if (!WiFi.config(local_IP, gateway, subnet, dns)) {
    Serial.println("Static IP config FAILED");
  }

  WiFi.begin(ssid, password);

  WiFi.setSleep(false);
  Serial.print("WiFi connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.println("WiFi connected");
  Serial.print("SSID: ");     Serial.println(WiFi.SSID());
  Serial.print("Gateway: ");  Serial.println(WiFi.gatewayIP());
  Serial.print("RSSI: ");     Serial.println(WiFi.RSSI());
  Serial.print("BSSID: ");    Serial.println(WiFi.BSSIDstr());
  Serial.print("Gateway: ");  Serial.println(WiFi.gatewayIP());

  startCameraServer();

  Serial.print("Camera Ready! Open: http://");
  Serial.println(WiFi.localIP());
  Serial.println("Type 'c' + Enter to capture a test frame.");
}

void loop() {
  if (Serial.available()) {
    char cmd = Serial.read();
    if (cmd == 'c') {
      camera_fb_t *fb = esp_camera_fb_get();
      if (!fb) {
        Serial.println("Capture failed");
      } else {
        Serial.printf("Captured: %dx%d, %u bytes\n",
                      fb->width, fb->height, (unsigned)fb->len);
        esp_camera_fb_return(fb);
      }
    }
  }
  delay(50);
}