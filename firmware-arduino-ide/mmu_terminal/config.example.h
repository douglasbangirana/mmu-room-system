#ifndef CONFIG_H
#define CONFIG_H

// --- Wi-Fi ---
#define WIFI_SSID "YourCampusWiFi"
#define WIFI_PASS "YourWiFiPassword"

// --- Server API ---
#define API_BASE "http://192.168.1.100:3000/api" // Change to your server IP
#define ROOM_CODE "ROOM-101"
#define DEVICE_KEY "secret-device-key-123"
#define USE_INSECURE_TLS 1
#define ROOT_CA ""

// --- Hardware Pins (ESP32) ---
#define PIN_RFID_SS   5
#define PIN_RFID_RST  4
#define PIN_LED_R     25
#define PIN_LED_G     26
#define PIN_LED_B     27
#define PIN_BUZZER    32
#define PIN_SDA       21
#define PIN_SCL       22
#define PIN_SCK       18
#define PIN_MISO      19
#define PIN_MOSI      23

// --- LCD ---
#define LCD_ADDR 0x27
#define LCD_COLS 16
#define LCD_ROWS 2

// --- Settings ---
#define TZ_OFFSET_SEC 3600 // e.g., 3600 for UTC+1
#define HEARTBEAT_MS 30000
#define SWIPE_TIMEOUT_MS 4000
#define RESULT_HOLD_MS 3000
#define DEBOUNCE_MS 2000
#define QUEUE_MAX 100
#define QUEUE_BATCH 10

#endif
