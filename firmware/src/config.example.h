// Copy this file to config.h and fill in your values. config.h is git-ignored (it holds secrets).
#pragma once

// ---- Network ----
#define WIFI_SSID   "YourCampusWiFi"
#define WIFI_PASS   "YourWiFiPassword"
// Development on a LAN: "http://192.168.1.10:3000/api".  Production: "https://rooms.mmu.ac.ug/api"
#define API_BASE    "http://192.168.1.10:3000/api"

// ---- Identity (create the room in the dashboard's "Rooms setup" tab to get the key) ----
#define ROOM_CODE   "LH-101"
#define DEVICE_KEY  "paste-the-48-character-device-key-here"

// ---- HTTPS ----
// 1 = skip certificate checking (OK on a private test network ONLY). 0 = verify with ROOT_CA below.
#define USE_INSECURE_TLS 1
[[maybe_unused]] static const char ROOT_CA[] = R"EOF(
-----BEGIN CERTIFICATE-----
(paste the root CA of your server's certificate here when USE_INSECURE_TLS is 0)
-----END CERTIFICATE-----
)EOF";

// ---- Time ----
#define TZ_OFFSET_SEC 10800          // East Africa Time = UTC+3 (the server overrides this on sync)

// ---- LCD: your parts list has 16x2; the proposal specifies 20x4. Set whichever you have. ----
#define LCD_ADDR 0x27                // try 0x3F if the screen stays blank
#define LCD_COLS 16
#define LCD_ROWS 2

// ---- Pins (ESP32 DevKit v1) ----
#define PIN_RFID_SS   5
#define PIN_RFID_RST  27
#define PIN_SCK       18
#define PIN_MISO      19
#define PIN_MOSI      23
#define PIN_SDA       21             // shared by the LCD and the DS3231
#define PIN_SCL       22
#define PIN_BUZZER    25
#define PIN_LED_R     32
#define PIN_LED_G     33
#define PIN_LED_B     14

// ---- Timing ----
#define HEARTBEAT_MS     30000UL     // the server shows "Status unverified" after 90 s of silence
#define SWIPE_TIMEOUT_MS 2500        // keep the terminal result under the 3 s target (NFR1)
#define RESULT_HOLD_MS   3000
#define DEBOUNCE_MS      3000
#define QUEUE_MAX        500         // offline events kept in flash
#define QUEUE_BATCH      10          // events uploaded per heartbeat cycle
