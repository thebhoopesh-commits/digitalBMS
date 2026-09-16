/*
 * DigitalBMS sensor node - ESP32 + BME680 (or DHT22) -> Raspberry Pi gateway.
 * ---------------------------------------------------------------------------
 * Role in the architecture (hardware_architecture.md section 5):
 *   "Temperature & Humidity (DHT22 / BME680)" sensor node, UDP/HTTP to the Pi HAL.
 *
 * Two modes, both supported simultaneously:
 *   A. PUSH  (default, recommended): every PUSH_INTERVAL_MS the node POSTs JSON
 *      to  http://<PI_HOST>:<PI_PORT>/api/sensors/ingest
 *   B. POLL  (set SERVE_HTTP 1): the node also runs a tiny HTTP server answering
 *      GET /sensors, so the Pi can poll it (SENSOR_POLL_URL) instead.
 *
 * Local failsafe (per the hardware doc's "Edge Heartbeat Watchdog"):
 *   if POSTs fail FAIL_SAFE_AFTER_MS in a row, the node drives LOCAL_MODE_PIN
 *   (a relay/contactor or the local thermostat enable line) HIGH so the room
 *   does not depend on the Pi being alive.
 *
 * Wiring
 *   BME680 (I2C):  SDA=21, SCL=22, VCC=3V3, GND
 *   DHT22:         DATA=4 (10k pull-up to 3V3)
 *   LOCAL_MODE_PIN: 5 (relay signal, active HIGH)
 *
 * Libraries (Arduino IDE / PlatformIO):
 *   - Adafruit BME680 Library + Adafruit Unified Sensor   (SENSOR_TYPE_BME680)
 *   - DHT sensor library + Adafruit Unified Sensor        (SENSOR_TYPE_DHT22)
 *   - No library needed for SENSOR_TYPE_MOCK (pipeline bring-up before wiring)
 *   - ESP32 core only for WiFi / WebServer / HTTPClient
 */

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <time.h>

// ----------------------------------------------------------------------------
// 1. CONFIGURATION - edit these
// ----------------------------------------------------------------------------
#define WIFI_SSID        "your-wifi"
#define WIFI_PASSWORD    "your-password"

#define PI_HOST          "192.168.1.10"   // Raspberry Pi running the FastAPI backend
#define PI_PORT          8000
#define INGEST_PATH      "/api/sensors/ingest"
#define INGEST_TOKEN     "change-me"      // must match SENSOR_INGEST_TOKEN on the Pi

#define DEVICE_ID        "esp32-02"       // must match SENSOR_DEVICE_ZONES on the Pi
#define ZONE_ID          "open_office"    // or lobby / conference_room / server_room

#define PUSH_INTERVAL_MS 5000UL           // 5 s (hardware doc suggests 5-30 s)
#define SERVE_HTTP       1                // 1 = also answer GET /sensors (poll mode)
#define USE_NTP          1                // 1 = stamp samples with real epoch seconds

#define FAIL_SAFE_AFTER_MS 60000UL        // 60 s without a successful POST -> local mode
#define LOCAL_MODE_PIN   5

// Choose ONE sensor type
#define SENSOR_TYPE_MOCK   0
#define SENSOR_TYPE_DHT22  1
#define SENSOR_TYPE_BME680 2
#define SENSOR_TYPE        SENSOR_TYPE_BME680

// ----------------------------------------------------------------------------
// 2. SENSOR DRIVERS
// ----------------------------------------------------------------------------
#if SENSOR_TYPE == SENSOR_TYPE_DHT22
  #include <DHT.h>
  #define DHT_PIN 4
  #define DHT_TYPE DHT22
  DHT dht(DHT_PIN, DHT_TYPE);
#elif SENSOR_TYPE == SENSOR_TYPE_BME680
  #include <Wire.h>
  #include <Adafruit_Sensor.h>
  #include <Adafruit_BME680.h>
  Adafruit_BME680 bme;   // I2C, default address 0x77
#endif

struct Sample {
  bool     ok;
  float    temperature_c;
  float    humidity_pct;
  uint32_t gas_kohm;      // BME680 only (0 when unavailable)
};

Sample readSensor() {
  Sample s = {false, NAN, NAN, 0};

#if SENSOR_TYPE == SENSOR_TYPE_DHT22
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t) && !isnan(h)) { s.ok = true; s.temperature_c = t; s.humidity_pct = h; }

#elif SENSOR_TYPE == SENSOR_TYPE_BME680
  if (bme.performReading()) {
    s.ok            = true;
    s.temperature_c = bme.temperature;
    s.humidity_pct  = bme.humidity;
    s.gas_kohm      = (uint32_t)(bme.gas_resistance / 1000.0);
  }

#else
  // Deterministic pseudo-values so the whole data path can be tested before the
  // sensor is wired: 21.0-24.9 C and 40-59 %RH, slowly drifting.
  static uint32_t tick = 0;
  tick++;
  s.ok            = true;
  s.temperature_c = 21.0f + (float)(tick % 40) / 10.0f;
  s.humidity_pct  = 40.0f + (float)(tick % 20);
#endif
  return s;
}

// ----------------------------------------------------------------------------
// 3. TRANSPORT: JSON payload, HTTP push, optional poll server
// ----------------------------------------------------------------------------
WebServer server(80);
unsigned long lastPushMs       = 0;
unsigned long lastSuccessMs    = 0;
bool          localFallback    = false;
uint32_t      consecutiveFails = 0;

String buildPayload() {
  Sample s = readSensor();
  if (!s.ok) {
    return String("{\"device_id\":\"") + DEVICE_ID + "\",\"zone\":\"" + ZONE_ID +
           "\",\"error\":\"sensor_read_failed\"}";
  }
  // epoch seconds (NTP) so the Pi can compute staleness; 0 -> Pi stamps it
  time_t now = time(nullptr);
  uint32_t stamp = (now > 1600000000) ? (uint32_t)now : 0;
  String payload = String("{\"device_id\":\"") + DEVICE_ID +
                   "\",\"zone\":\"" + ZONE_ID + "\"," +
                   "\"captured_at\":" + String(stamp) + "," +
                   "\"temperature\":" + String(s.temperature_c, 2) + ",\"unit\":\"C\"," +
                   "\"humidity\":" + String(s.humidity_pct, 1) + "\"";
  if (s.gas_kohm > 0) payload += String(",\"gas_kohm\":") + String(s.gas_kohm);
  payload += "}";
  return payload;
}

bool pushToPi(const String &payload) {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String url = String("http://") + PI_HOST + ":" + PI_PORT + INGEST_PATH;
  http.begin(url);
  http.setTimeout(3000);
  http.addHeader("Content-Type", "application/json");
  if (strlen(INGEST_TOKEN) > 0) http.addHeader("X-Sensor-Token", INGEST_TOKEN);

  int code = http.POST(payload);
  http.end();

  bool ok = (code >= 200 && code < 300);
  Serial.printf("[push] HTTP %d %s\n", code, ok ? "ok" : "FAILED");
  return ok;
}

void handleSensorGet() {
  // Poll mode: the Pi GETs this and ingests it through the same contract.
  server.send(200, "application/json", buildPayload());
}

void handleRoot() {
  server.send(200, "text/plain",
              String("DigitalBMS sensor node ") + DEVICE_ID + " zone=" + ZONE_ID);
}

// ----------------------------------------------------------------------------
// 4. WIFI + NTP + FAILSAFE SUPERVISION
// ----------------------------------------------------------------------------
void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("[wifi] connecting to %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000UL) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] connected: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("[wifi] connect timeout; will retry");
  }
}

void syncClock() {
#if USE_NTP
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  Serial.println("[ntp] requested time sync");
#endif
}

void updateFailsafe() {
  bool healthy = (consecutiveFails == 0) || (millis() - lastSuccessMs < FAIL_SAFE_AFTER_MS);
  if (!healthy && !localFallback) {
    localFallback = true;
    digitalWrite(LOCAL_MODE_PIN, HIGH);
    Serial.println("[failsafe] Pi unreachable -> LOCAL STANDALONE MODE ON");
  } else if (healthy && localFallback) {
    localFallback = false;
    digitalWrite(LOCAL_MODE_PIN, LOW);
    Serial.println("[failsafe] Pi reachable -> supervised mode restored");
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(LOCAL_MODE_PIN, OUTPUT);
  digitalWrite(LOCAL_MODE_PIN, LOW);

#if SENSOR_TYPE == SENSOR_TYPE_DHT22
  dht.begin();
#elif SENSOR_TYPE == SENSOR_TYPE_BME680
  Wire.begin(21, 22);
  if (!bme.begin(0x77)) {
    Serial.println("[sensor] BME680 not found at 0x77 - check wiring");
  } else {
    bme.setTemperatureOversampling(BME680_OS_8X);
    bme.setHumidityOversampling(BME680_OS_2X);
    bme.setPressureOversampling(BME680_OS_4X);
    bme.setIIRFilterSize(BME680_FILTER_SIZE_3);
    bme.setGasHeater(320, 150);   // 320 C for 150 ms
  }
#endif

  connectWifi();
  syncClock();

#if SERVE_HTTP
  server.on("/", handleRoot);
  server.on("/sensors", handleSensorGet);
  server.begin();
  Serial.println("[http] poll endpoint ready: GET /sensors");
#endif

  lastSuccessMs = millis();
  lastPushMs    = millis() - PUSH_INTERVAL_MS;   // push immediately on first loop
}

void loop() {
  unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED) connectWifi();

#if SERVE_HTTP
  server.handleClient();
#endif

  if (now - lastPushMs >= PUSH_INTERVAL_MS) {
    lastPushMs = now;
    String payload = buildPayload();
    Serial.println(payload);
    if (pushToPi(payload)) {
      consecutiveFails = 0;
      lastSuccessMs    = now;
    } else {
      consecutiveFails++;
      Serial.printf("[push] consecutive failures: %u\n", consecutiveFails);
    }
  }

  updateFailsafe();
  delay(10);
}