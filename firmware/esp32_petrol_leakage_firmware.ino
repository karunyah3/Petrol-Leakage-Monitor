/*
  ====================================================================================
  PROJECT: TWO-ZONE PETROL LEAKAGE DETECTION AND MONITORING SYSTEM USING ESP32
  FILE   : esp32_petrol_leakage_firmware.ino
  ====================================================================================
  Description:
    Integrated real-time dual-zone petrol/flammable vapour monitoring firmware.
    - Zone 1 Gas Sensor: GPIO 34 (ADC1_CH6)
    - Zone 2 Gas Sensor: GPIO 35 (ADC1_CH7)
    - Zone 1 Green LED (Safe): GPIO 33
    - Zone 1 Red LED (Alert) : GPIO 26
    - Zone 2 Green LED (Safe): GPIO 25
    - Zone 2 Red LED (Alert) : GPIO 27
    - Physical Buzzer Alert  : GPIO 5
    - 16x2 I2C LCD Display   : Address 0x27 (SDA: GPIO 21, SCL: GPIO 22)
    - Serial Baud Rate       : 9600 Baud

  Threshold Rules:
    - Reading > 1000  : POSSIBLE LEAK DETECTED (Red LED ON, Green LED OFF)
    - Reading <= 1000 : NO LEAK DETECTED (Green LED ON, Red LED OFF)
    - Buzzer activates if Zone 1 > 1000 OR Zone 2 > 1000
  ====================================================================================
*/

#include <Wire.h>
#include <LiquidCrystal_I2C.h>

#define buz 5

// Gas Sensor Analog Input Pins
const int gas1_pin = 34;
const int gas2_pin = 35;

int gas1_val = 0;
int gas2_val = 0;

// LED Status Pins
const int g1 = 33; // Zone 1 Green (Safe)
const int r1 = 26; // Zone 1 Red (Leak)
const int g2 = 25; // Zone 2 Green (Safe)
const int r2 = 27; // Zone 2 Red (Leak)

// 16x2 I2C LCD (Default I2C Address 0x27)
LiquidCrystal_I2C lcd(0x27, 16, 2);

// Threshold constant
const int THRESHOLD = 1000;

void setup()
{
  // Initialize Serial communication at 9600 baud for Python Flask backend
  Serial.begin(9600);

  // Initialize LCD
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("PETROL LEAKAGE");
  lcd.setCursor(0, 1);
  lcd.print("SYSTEM STARTING");

  // Configure Pin Modes
  pinMode(buz, OUTPUT);
  pinMode(gas1_pin, INPUT);
  pinMode(gas2_pin, INPUT);

  pinMode(g1, OUTPUT);
  pinMode(g2, OUTPUT);
  pinMode(r1, OUTPUT);
  pinMode(r2, OUTPUT);

  // Initial Safe State
  digitalWrite(g1, HIGH);
  digitalWrite(g2, HIGH);
  digitalWrite(r1, LOW);
  digitalWrite(r2, LOW);
  digitalWrite(buz, LOW);

  delay(1500);
  lcd.clear();
}

void loop()
{
  // Read real analog values from sensors (12-bit ADC: 0 to 4095)
  gas1_val = analogRead(gas1_pin);
  gas2_val = analogRead(gas2_pin);

  // Send formatted telemetry to Python Flask backend over USB Serial
  Serial.print("gas1_val:");
  Serial.println(gas1_val);

  Serial.print("gas2_val:");
  Serial.println(gas2_val);

  // Update 16x2 LCD Display Header
  lcd.setCursor(0, 0);
  lcd.print("Zone1 - Zone2   ");

  // Zone 1 Threshold Evaluation & Physical Actuation
  if (gas1_val > THRESHOLD)
  {
    lcd.setCursor(0, 1);
    lcd.print("Leak   ");
    digitalWrite(r1, HIGH);
    digitalWrite(g1, LOW);
  }
  else
  {
    lcd.setCursor(0, 1);
    lcd.print("No Leak");
    digitalWrite(g1, HIGH);
    digitalWrite(r1, LOW);
  }

  // Zone 2 Threshold Evaluation & Physical Actuation
  if (gas2_val > THRESHOLD)
  {
    lcd.setCursor(8, 1);
    lcd.print("Leak   ");
    digitalWrite(r2, HIGH);
    digitalWrite(g2, LOW);
  }
  else
  {
    lcd.setCursor(8, 1);
    lcd.print("No Leak");
    digitalWrite(g2, HIGH);
    digitalWrite(r2, LOW);
  }

  // Physical Buzzer Control: Activate if either zone exceeds threshold
  if (gas1_val > THRESHOLD || gas2_val > THRESHOLD)
  {
    digitalWrite(buz, HIGH);
  }
  else
  {
    digitalWrite(buz, LOW);
  }

  // Telemetry transmission interval (500 ms = 2 Hz)
  delay(500);
}
