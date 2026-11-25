// MMU Room Terminal firmware (ESP32, Arduino framework)
//
// Flow (UC3/UC4): tap card -> POST /api/swipe -> show Authorized / Unauthorized / Signed out / Not recognised.
// If the server cannot be reached, the terminal checks its cached timetable, saves the tap to flash with an
// RTC timestamp, and uploads it when the network returns (NFR2).

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <Wire.h>
#include <MFRC522.h>
#include <LiquidCrystal_I2C.h>
#include <RTClib.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <vector>
#include <time.h>
#include "config.h"

#define FW_VERSION "1.1.0"
#define CACHE_FILE "/cache.json"
#define QUEUE_FILE "/queue.txt"
#define MIN_VALID_EPOCH 1700000000UL

// ------------------------------------------------------------------ hardware objects
MFRC522 rfid(PIN_RFID_SS, PIN_RFID_RST);
LiquidCrystal_I2C lcd(LCD_ADDR, LCD_COLS, LCD_ROWS);
RTC_DS1307 rtc;
bool rtcFound = false;

// ------------------------------------------------------------------ state
struct Slot {
  String name, course;
  uint32_t start = 0, end = 0;     // seconds since local midnight
  std::vector<String> uids;        // active card UIDs of the lecturer
};
std::vector<Slot> slots;
uint32_t cacheVersion = 0;
String cacheDate = "";
uint32_t graceSec = 900;
int32_t tzOffset = TZ_OFFSET_SEC;

bool online = false;               // result of the last server call
String occupantUid = "";           // who we believe is inside (used only for offline sign-out)
uint16_t queueLen = 0;
String lastUid = "";
unsigned long lastUidAt = 0, lastHb = 0, lastIdleDraw = 0, lastReaderCheck = 0, resultUntil = 0;
String lcdLines[4];

// ------------------------------------------------------------------ LED + buzzer
void ledInit() {
  const int pins[3] = {PIN_LED_R, PIN_LED_G, PIN_LED_B};
  for (int ch = 0; ch < 3; ch++) { 
    ledcAttach(pins[ch], 5000, 8); // New ESP32 Core 3.x API
  }
}

void setLed(uint8_t r, uint8_t g, uint8_t b) { 
  ledcWrite(PIN_LED_R, r); 
  ledcWrite(PIN_LED_G, g); 
  ledcWrite(PIN_LED_B, b); 
}

void ledIdle() { if (online) setLed(0, 0, 0); else setLed(0, 0, 40); }   // dim blue = offline
void ledGreen()  { setLed(0, 255, 0); }
void ledAmber()  { setLed(255, 90, 0); }
void ledRed()    { setLed(255, 0, 0); }

void beep(int ms) { digitalWrite(PIN_BUZZER, HIGH); delay(ms); digitalWrite(PIN_BUZZER, LOW); }
void beepOk()   { beep(150); }
void beepWarn() { beep(90); delay(90); beep(90); }
void beepFail() { beep(600); }

// ------------------------------------------------------------------ LCD
// Writes up to 4 lines; extra lines are ignored on a 16x2. Only changed rows are redrawn (no flicker).
void show(const String& a, const String& b = "", const String& c = "", const String& d = "") {
  const String in[4] = {a, b, c, d};
  for (int i = 0; i < LCD_ROWS && i < 4; i++) {
    String s = in[i];
    if (s.length() > LCD_COLS) s = s.substring(0, LCD_COLS);
    while (s.length() < LCD_COLS) s += ' ';
    if (s != lcdLines[i]) { lcd.setCursor(0, i); lcd.print(s); lcdLines[i] = s; }
  }
}

// ------------------------------------------------------------------ time
uint32_t nowUtc() {
  if (rtcFound) { uint32_t t = rtc.now().unixtime(); if (t > MIN_VALID_EPOCH) return t; }
  time_t t = time(nullptr);
  return t > (time_t)MIN_VALID_EPOCH ? (uint32_t)t : 0;
}
String hhmm(uint32_t utc) {
  if (!utc) return "--:--";
  uint32_t s = (utc + tzOffset) % 86400;
  char b[6]; snprintf(b, sizeof b, "%02u:%02u", (unsigned)(s / 3600), (unsigned)((s % 3600) / 60));
  return String(b);
}
String localDateStr(uint32_t utc) {
  time_t t = (time_t)(utc + tzOffset); struct tm tmv; gmtime_r(&t, &tmv);
  char b[11]; strftime(b, sizeof b, "%Y-%m-%d", &tmv);
  return String(b);
}
// Trust the server clock if the RTC drifted (campus networks often block NTP).
void adjustRtc(uint32_t serverTime) {
  if (!rtcFound || !serverTime) return;
  uint32_t cur = rtc.now().unixtime();
  long diff = (long)serverTime - (long)cur;
  if (cur < MIN_VALID_EPOCH || diff > 5 || diff < -5) rtc.adjust(DateTime(serverTime));
}

// ------------------------------------------------------------------ HTTP
// Returns the HTTP status, or -1 when the network/server is unreachable.
int request(const char* method, const String& path, const String& body, String& resp, uint16_t timeoutMs) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  String url = String(API_BASE) + path;
  HTTPClient http;
  WiFiClient plain;
  WiFiClientSecure secure;
  if (url.startsWith("https")) {
#if USE_INSECURE_TLS
    secure.setInsecure();
#else
    secure.setCACert(ROOT_CA);
#endif
    http.begin(secure, url);
  } else {
    http.begin(plain, url);
  }
  http.setTimeout(timeoutMs);
  http.setConnectTimeout(timeoutMs);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Room-Code", ROOM_CODE);
  http.addHeader("X-Device-Key", DEVICE_KEY);
  int code = (strcmp(method, "GET") == 0) ? http.GET() : http.POST(body);
  if (code > 0) resp = http.getString();
  http.end();
  return code;
}

// ------------------------------------------------------------------ timetable cache (FR2)
bool applyCache(const String& raw) {
  JsonDocument doc;
  if (deserializeJson(doc, raw)) return false;
  slots.clear();
  cacheVersion = doc["version"] | 0;
  cacheDate = doc["date"].as<String>();
  graceSec = doc["grace_sec"] | 900;
  tzOffset = doc["tz_offset_sec"] | TZ_OFFSET_SEC;
  for (JsonObject s : doc["slots"].as<JsonArray>()) {
    Slot sl;
    sl.name = s["name"].as<String>();
    sl.course = s["course"].as<String>();
    sl.start = s["start"] | 0;
    sl.end = s["end"] | 0;
    for (JsonVariant u : s["uids"].as<JsonArray>()) sl.uids.push_back(u.as<String>());
    slots.push_back(sl);
  }
  return true;
}

bool syncCache() {
  String resp;
  int code = request("GET", "/timetable/sync", "", resp, 4000);
  if (code != 200 || !applyCache(resp)) return false;
  File f = LittleFS.open(CACHE_FILE, FILE_WRITE);
  if (f) { f.print(resp); f.close(); }
  Serial.printf("Cache synced: v%u, %u slots\n", (unsigned)cacheVersion, (unsigned)slots.size());
  return true;
}

void loadCacheFromFlash() {
  File f = LittleFS.open(CACHE_FILE, FILE_READ);
  if (!f) return;
  String raw = f.readString();
  f.close();
  applyCache(raw);
}

// Offline check against the cache: same rule as the server (start - grace <= now <= end).
const Slot* matchCache(const String& uid, uint32_t utc) {
  if (!utc || cacheDate != localDateStr(utc)) return nullptr;
  uint32_t sod = (utc + tzOffset) % 86400;
  const Slot* best = nullptr;
  for (const Slot& s : slots) {
    bool mine = false;
    for (const String& u : s.uids) if (u == uid) { mine = true; break; }
    if (!mine) continue;
    if (sod + graceSec >= s.start && sod <= s.end && (!best || s.start > best->start)) best = &s;
  }
  return best;
}

// ------------------------------------------------------------------ store-and-forward queue (NFR2)
void queueCount() {
  queueLen = 0;
  File f = LittleFS.open(QUEUE_FILE, FILE_READ);
  if (!f) return;
  while (f.available()) { if (f.readStringUntil('\n').length() > 3) queueLen++; }
  f.close();
}

bool queueAdd(uint32_t epoch, const String& uid) {
  if (queueLen >= QUEUE_MAX) return false;
  File f = LittleFS.open(QUEUE_FILE, FILE_APPEND);
  if (!f) return false;
  f.printf("%lu,%s\n", (unsigned long)epoch, uid.c_str());
  f.close();
  queueLen++;
  return true;
}

void queueFlush() {
  if (queueLen == 0) return;
  File f = LittleFS.open(QUEUE_FILE, FILE_READ);
  if (!f) { queueLen = 0; return; }
  std::vector<String> lines;
  while (f.available()) { String l = f.readStringUntil('\n'); l.trim(); if (l.length() > 3) lines.push_back(l); }
  f.close();

  size_t i = 0;
  for (; i < lines.size() && i < QUEUE_BATCH; i++) {
    int c = lines[i].indexOf(',');
    if (c < 0) continue;                                   // corrupt line: drop it
    String body = "{\"card_uid\":\"" + lines[i].substring(c + 1) + "\",\"queued\":true,\"timestamp\":" + lines[i].substring(0, c) + "}";
    String resp;
    int code = request("POST", "/swipe", body, resp, 4000);
    bool sent = code == 200;
    bool permanent = code >= 400 && code < 500 && code != 401 && code != 403 && code != 429;  // bad data: do not retry forever
    if (!(sent || permanent)) break;                       // network/server problem: keep the rest for later
  }
  LittleFS.remove(QUEUE_FILE);
  if (i < lines.size()) {
    File w = LittleFS.open(QUEUE_FILE, FILE_WRITE);
    if (w) { for (size_t j = i; j < lines.size(); j++) w.println(lines[j]); w.close(); }
  }
  queueLen = lines.size() - i;
  Serial.printf("Queue flushed, %u left\n", (unsigned)queueLen);
}

// ------------------------------------------------------------------ results on screen (FR7)
void render(const String& result, const String& name, const String& msg, bool offline) {
  const String tag = offline ? "(saved offline)" : "";
  if (result == "AUTHORIZED") {
    ledGreen(); beepOk();
    show("AUTHORIZED", name, msg, tag);
  } else if (result == "UNAUTHORIZED") {
    ledAmber(); beepWarn();
    show("UNAUTHORIZED", name, "Not on timetable", tag);
  } else if (result == "SIGNED_OUT") {
    ledGreen(); beepOk();
    show("SIGNED OUT", name, "Room available", tag);
  } else if (result == "SAVED_OFFLINE") {
    ledAmber(); beepWarn();
    show("OFFLINE", "Tap saved", "Checked when", "back online");
  } else {                                                 // REJECTED / errors
    ledRed(); beepFail();
    show("CARD NOT", "RECOGNISED", msg, "");
  }
  resultUntil = millis() + RESULT_HOLD_MS;
}

// ------------------------------------------------------------------ handling one tap (UC3, UC4)
void handleCard(const String& uid) {
  uint32_t t = nowUtc();
  String resp;
  int code = request("POST", "/swipe", "{\"card_uid\":\"" + uid + "\"}", resp, SWIPE_TIMEOUT_MS);

  if (code == 200) {
    online = true;
    JsonDocument d;
    if (!deserializeJson(d, resp)) {
      String r = d["result"].as<String>();
      render(r, d["name"].as<String>(), d["message"].as<String>(), false);
      if (r == "AUTHORIZED" || r == "UNAUTHORIZED") occupantUid = uid;
      else if (r == "SIGNED_OUT") occupantUid = "";
      return;
    }
  }
  if (code == 401 || code == 403) {                        // wrong room code / device key
    online = true;
    ledRed(); beepFail(); show("KEY ERROR", "Check config.h", "", "");
    resultUntil = millis() + RESULT_HOLD_MS;
    return;
  }
  if (code > 0 && code < 500) {                            // 4xx: server rejected the request
    online = true;
    render("REJECTED", "", "Error " + String(code), false);
    return;
  }

  // ---- Offline path: check the cache, save the tap, upload later ----
  online = false;
  if (!t) { render("REJECTED", "", "Clock not set", false); return; }
  if (!queueAdd(t, uid)) { render("REJECTED", "", "Queue full", false); return; }

  if (uid == occupantUid) {
    occupantUid = "";
    render("SIGNED_OUT", "", "", true);
    return;
  }
  const Slot* s = matchCache(uid, t);
  if (s) { occupantUid = uid; render("AUTHORIZED", s->name, s->course, true); }
  else   { render("SAVED_OFFLINE", "", "", true); }
}

// ------------------------------------------------------------------ heartbeat (FR13) + re-sync (FR2)
void heartbeat() {
  String resp;
  // Tell the server how healthy this terminal is: taps waiting, Wi-Fi signal, uptime, firmware version.
  String hb = "{\"queue\":" + String(queueLen) + ",\"rssi\":" + String(WiFi.RSSI()) + ",\"uptime\":" + String((unsigned long)(millis() / 1000UL)) + ",\"fw\":\"" FW_VERSION "\"}";
  int code = request("POST", "/heartbeat", hb, resp, 2500);
  if (code != 200) { online = false; return; }
  online = true;
  JsonDocument d;
  if (deserializeJson(d, resp)) return;
  adjustRtc(d["server_time"] | 0);
  uint32_t t = nowUtc();
  bool stale = (uint32_t)(d["version"] | 0) != cacheVersion || (t && cacheDate != localDateStr(t));
  if (stale) syncCache();
  queueFlush();
}

// ------------------------------------------------------------------ RFID helpers
bool readerHealthy() {
  byte v = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  return v != 0x00 && v != 0xFF;
}
bool readCard(String& uid) {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return false;
  uid = "";
  for (byte i = 0; i < rfid.uid.size; i++) { char b[3]; snprintf(b, sizeof b, "%02X", rfid.uid.uidByte[i]); uid += b; }
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  return true;
}

// ------------------------------------------------------------------ idle screen
void drawIdle() {
  uint32_t t = nowUtc();
  String l0 = String(ROOM_CODE) + " " + hhmm(t);
  String l1 = online ? "Tap your card" : "OFFLINE - tap ok";
  String l2 = queueLen ? "Waiting: " + String(queueLen) : "";
  String l3 = t ? localDateStr(t) : "Time not set";
  show(l0, l1, l2, l3);
}

// ------------------------------------------------------------------ setup / loop
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
  ledInit();
  setLed(0, 0, 80);

  Wire.begin(PIN_SDA, PIN_SCL);
  lcd.init();
  lcd.backlight();
  show("MMU Room Terminal", ROOM_CODE, "Starting...", "");

  SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_RFID_SS);
  rfid.PCD_Init();
  rfid.PCD_SetAntennaGain(rfid.RxGain_max);
  if (!readerHealthy()) { show("RFID READER", "NOT FOUND", "Check wiring", ""); Serial.println("MFRC522 not responding"); delay(3000); }

  rtcFound = rtc.begin();
  if (!rtcFound) { show("RTC NOT FOUND", "Check I2C wiring", "", ""); delay(2000); }

  if (!LittleFS.begin(true)) Serial.println("LittleFS mount failed");
  loadCacheFromFlash();
  queueCount();

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  show("Connecting WiFi", WIFI_SSID, "", "");
  for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) delay(500);
  configTime(0, 0, "pool.ntp.org", "time.google.com");     // fallback time source if the RTC is blank

  heartbeat();
  lastHb = millis();
  ledIdle();
  Serial.printf("Ready. online=%d cache=%u slots queue=%u\n", online, (unsigned)slots.size(), (unsigned)queueLen);
}

void loop() {
  unsigned long ms = millis();

  String uid;
  if (readCard(uid) && !(uid == lastUid && ms - lastUidAt < DEBOUNCE_MS)) {
    lastUid = uid;
    lastUidAt = ms;
    Serial.println("Card: " + uid);
    handleCard(uid);
    return;
  }

  if (ms >= resultUntil) {
    if (resultUntil != 0) { resultUntil = 0; ledIdle(); }
    if (ms - lastIdleDraw > 1000) { drawIdle(); lastIdleDraw = ms; }
    if (ms - lastHb > HEARTBEAT_MS) { heartbeat(); lastHb = millis(); ledIdle(); }
  }

  // The MFRC522 occasionally hangs; re-initialise if it stops answering.
  if (ms - lastReaderCheck > 30000) {
    lastReaderCheck = ms;
    if (!readerHealthy()) { rfid.PCD_Init(); rfid.PCD_SetAntennaGain(rfid.RxGain_max); }
  }
}