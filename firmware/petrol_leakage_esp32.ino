/*
  ====================================================================================
  PROJECT: TWO-ZONE PETROL LEAKAGE DETECTION AND MONITORING SYSTEM USING ESP32
  ====================================================================================
  Description:
    Dual-zone gas & flammable vapour detection prototype with independent zone monitoring,
    visual status LEDs, 16x2 I2C LCD display, and USB Serial telemetry output for
    real-time web dashboard integration.

  NOTE ON PROTOTYPE TESTING:
    Isopropyl alcohol is used as a safe laboratory test substance to demonstrate the
    gas/vapour sensor response in this prototype.

  PIN ASSIGNMENTS:
    - Gas Sensor 1 (Zone 1)  : GPIO 34 (Analog In)
    - Gas Sensor 2 (Zone 2)  : GPIO 35 (Analog In)
    - Green LED 1 (Zone 1 Safe) : GPIO 33
    - Green LED 2 (Zone 2 Safe) : GPIO 25
    - Red LED 1 (Zone 1 Alert)  : GPIO 26
    - Red LED 2 (Zone 2 Alert)  : GPIO 27
    - I2C LCD 16x2 (SDA / SCL)  : GPIO 21 (SDA) / GPIO 22 (SCL)

  SERIAL OUTPUT FORMAT (9600 Baud):
    gas1_val:650
    gas2_val:1250
  ====================================================================================
*/

#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ---------------------------------------------------------
// PIN DEFINITIONS
// ---------------------------------------------------------
const int PIN_GAS_1    = 34; // Zone 1 Analog Input
const int PIN_GAS_2    = 35; // Zone 2 Analog Input

const int PIN_LED_G1   = 33; // Zone 1 Green LED (Safe)
const int PIN_LED_R1   = 26; // Zone 1 Red LED (Alert)

const int PIN_LED_G2   = 25; // Zone 2 Green LED (Safe)
const int PIN_LED_R2   = 27; // Zone 2 Red LED (Alert)

// ---------------------------------------------------------
// THRESHOLD SETTING
// ---------------------------------------------------------
// ADC range: 0 - 4095. Initial default threshold: 1000
int leakThreshold = 1000;

// Initialize 16x2 LCD with I2C address 0x27 (or 0x3F if your module uses 0x3F)
LiquidCrystal_I2C lcd(0x27, 16, 2);

// Timing variables for non-blocking serial and LCD updates
unsigned long previousMillis = 0;
const long interval = 500; // Send telemetry every 500ms (2Hz)

void setup() {
  // Initialize Serial at 9600 baud for Python Flask backend communication
  Serial.begin(9600);
  delay(200);

  // Configure output pins
  pinMode(PIN_LED_G1, OUTPUT);
  pinMode(PIN_LED_R1, OUTPUT);
  pinMode(PIN_LED_G2, OUTPUT);
  pinMode(PIN_LED_R2, OUTPUT);

  // Configure analog input pins (ESP32 ADC is 12-bit: 0 - 4095)
  pinMode(PIN_GAS_1, INPUT);
  pinMode(PIN_GAS_2, INPUT);
  analogReadResolution(12);

  // Initial LED State: Turn off all LEDs
  digitalWrite(PIN_LED_G1, LOW);
  digitalWrite(PIN_LED_R1, LOW);
  digitalWrite(PIN_LED_G2, LOW);
  digitalWrite(PIN_LED_R2, LOW);

  // Initialize I2C LCD Display
  Wire.begin(21, 22); // SDA=21, SCL=22
  lcd.init();
  lcd.backlight();
  
  // Welcome Banner
  lcd.setCursor(0, 0);
  lcd.print("TWO-ZONE PETROL");
  lcd.setCursor(0, 1);
  lcd.print("MONITOR SYSTEM");
  delay(2000);
  lcd.clear();
}

void loop() {
  // Read analog gas sensor values
  int gas1_val = analogRead(PIN_GAS_1);
  int gas2_val = analogRead(PIN_GAS_2);

  // Determine individual zone states
  bool zone1_leak = (gas1_val > leakThreshold);
  bool zone2_leak = (gas2_val > leakThreshold);

  // ---------------------------------------------------------
  // ZONE 1 INDEPENDENT ACTUATOR CONTROL
  // ---------------------------------------------------------
  if (zone1_leak) {
    digitalWrite(PIN_LED_G1, LOW);
    digitalWrite(PIN_LED_R1, HIGH); // Zone 1 Red Alert ON
  } else {
    digitalWrite(PIN_LED_G1, HIGH); // Zone 1 Green Safe ON
    digitalWrite(PIN_LED_R1, LOW);
  }

  // ---------------------------------------------------------
  // ZONE 2 INDEPENDENT ACTUATOR CONTROL
  // ---------------------------------------------------------
  if (zone2_leak) {
    digitalWrite(PIN_LED_G2, LOW);
    digitalWrite(PIN_LED_R2, HIGH); // Zone 2 Red Alert ON
  } else {
    digitalWrite(PIN_LED_G2, HIGH); // Zone 2 Green Safe ON
    digitalWrite(PIN_LED_R2, LOW);
  }

  // ---------------------------------------------------------
  // PERIODIC SERIAL TELEMETRY & LCD UPDATE
  // ---------------------------------------------------------
  unsigned long currentMillis = millis();
  if (currentMillis - previousMillis >= interval) {
    previousMillis = currentMillis;

    // Send data over USB Serial in the exact expected format
    Serial.print("gas1_val:");
    Serial.println(gas1_val);
    Serial.print("gas2_val:");
    Serial.println(gas2_val);

    // Update 16x2 LCD Display
    // Line 1: Zone 1 Status and Reading
    lcd.setCursor(0, 0);
    if (zone1_leak) {
      lcd.print("Z1:LEAK! ");
    } else {
      lcd.print("Z1:SAFE  ");
    }
    lcd.print(gas1_val);
    lcd.print("   "); // padding

    // Line 2: Zone 2 Status and Reading
    lcd.setCursor(0, 1);
    if (zone2_leak) {
      lcd.print("Z2:LEAK! ");
    } else {
      lcd.print("Z2:SAFE  ");
    }
    lcd.print(gas2_val);
    lcd.print("   "); // padding
  }

  delay(50); // Short cycle delay
}
