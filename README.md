# TWO-ZONE PETROL LEAKAGE DETECTION AND MONITORING SYSTEM USING ESP32

[![Flask](https://img.shields.io/badge/Backend-Flask%203.x-00b4d8?style=flat-square)](https://flask.palletsprojects.com/)
[![ESP32](https://img.shields.io/badge/Hardware-ESP32%20Microcontroller-ff6b6b?style=flat-square)](https://espressif.com/)
[![SQLite](https://img.shields.io/badge/Database-SQLite%203-00ff9d?style=flat-square)](https://sqlite.org/)
[![Chart.js](https://img.shields.io/badge/RealTime%20Graph-Chart.js-ff9f43?style=flat-square)](https://www.chartjs.org/)

An industrial-grade IoT web application and embedded firmware solution for real-time dual-zone petrol / flammable vapour leakage monitoring, physical actuator alarming, and historical event logging.

---

## 1. Project Overview & Prototype Context

In industrial chemical storage facilities, fuel distribution pipelines, and petrol stations, early detection of flammable hydrocarbon vapours is critical for preventing catastrophic fire hazards and environmental contamination. 

This prototype monitors two distinct physical zones independently:
- **Zone 1:** Storage Tank / Supply Line Area (Analog Gas Sensor on **GPIO 34**)
- **Zone 2:** Dispensing Unit / Pipeline Valve Area (Analog Gas Sensor on **GPIO 35**)

> **Laboratory Testing Substance Note:**  
> **Isopropyl alcohol (IPA)** is utilized as a safe laboratory test substance to demonstrate the gas/vapour sensor response in this educational prototype. Gas sensors (such as MQ series sensors) respond to volatile organic compounds and alcohol vapours. Unless formally calibrated in a gas test chamber with certified reference standards, sensor outputs reflect relative concentration levels (ADC counts 0–4095) rather than specific compound-exclusive identifiers.

---

## 2. Hardware Pin Connections & Circuit Table

| Component | Pin / Channel | ESP32 GPIO | Description / Role |
| :--- | :--- | :--- | :--- |
| **Gas Sensor 1** | Analog Out (AO) | **GPIO 34** (ADC1_CH6) | Zone 1 continuous vapour concentration (`gas1_val`) |
| **Gas Sensor 2** | Analog Out (AO) | **GPIO 35** (ADC1_CH7) | Zone 2 continuous vapour concentration (`gas2_val`) |
| **Green LED 1** | Anode (+) | **GPIO 33** (`g1`) | Zone 1 Normal / Safe visual indicator |
| **Green LED 2** | Anode (+) | **GPIO 25** (`g2`) | Zone 2 Normal / Safe visual indicator |
| **Red LED 1** | Anode (+) | **GPIO 26** (`r1`) | Zone 1 Hazard / Leak detected visual alert |
| **Red LED 2** | Anode (+) | **GPIO 27** (`r2`) | Zone 2 Hazard / Leak detected visual alert |
| **Alert Buzzer** | Positive (+) | **GPIO 5** (`buz`) | Physical audible siren activated during any active leak |
| **16×2 I2C LCD** | SDA | **GPIO 21** | I2C Data Line for local physical display (Address `0x27`) |
| **16×2 I2C LCD** | SCL | **GPIO 22** | I2C Clock Line for local physical display |
| **Power Supply** | 5V / GND | **VIN / GND** | 5V DC power for sensors, LCD, and ESP32 |

---

## 3. Threshold Logic & Physical Actuation

The original code had an evaluation gap (`> 1000` and `<= 999`). This has been unified consistently across firmware and software:

- **Reading > 1000:** `POSSIBLE LEAK DETECTED`
  - Red LED turns **ON** (`HIGH`)
  - Green LED turns **OFF** (`LOW`)
  - Physical Buzzer on **GPIO 5** turns **ON** (`HIGH`)
  - 16×2 LCD displays: `Leak   `
  - Web dashboard card turns **RED**
- **Reading <= 1000:** `NO LEAK DETECTED`
  - Green LED turns **ON** (`HIGH`)
  - Red LED turns **OFF** (`LOW`)
  - Physical Buzzer turns **OFF** (`LOW`) (when both zones <= 1000)
  - 16×2 LCD displays: `No Leak`
  - Web dashboard card turns **GREEN**
- **No data / Stale (> 3.5s):** `SENSOR DATA UNAVAILABLE`
  - Web dashboard card turns **GREY**

---

## 4. USB Serial Communication Protocol

The ESP32 communicates with the Python Flask backend over USB Serial at **9600 baud**. Telemetry is transmitted line-by-line:

```text
gas1_val:650
gas2_val:1250
```

- **ADC Resolution:** 12-bit (`0` to `4095`)
- **Telemetry Frequency:** 2 Hz (Every 500 ms)
- **Stale Data Timeout:** 3.5 seconds. If communication drops, the dashboard immediately flags `SENSOR DATA UNAVAILABLE` (GREY).
- **Zero Mock Policy:** If the ESP32 is not connected, the dashboard displays `--` and `WAITING FOR ESP32 DATA`. It never invents fake readings or substitutes zeros.

---

## 5. Step-by-Step Hardware & Software Setup

### Step 1: Upload Firmware to ESP32
1. Connect your ESP32 to your PC using a micro-USB / USB-C data cable.
2. Open the **Arduino IDE**.
3. Open the integrated sketch:
   [firmware/esp32_petrol_leakage_firmware.ino](file:///c:/Users/karuk/OneDrive/ドキュメント/Petrol-Leakage-Monitor/firmware/esp32_petrol_leakage_firmware.ino)
4. Ensure the `LiquidCrystal_I2C` library is installed:
   - Go to **Sketch > Include Library > Manage Libraries...**
   - Search for `LiquidCrystal_I2C` by Frank de Brabander and click **Install**.
5. Select your board and COM port:
   - **Tools > Board > ESP32 Arduino > ESP32 Dev Module**
   - **Tools > Port > COMx** (e.g., `COM3` or `COM4`)
6. Click **Upload** (arrow icon) and wait until it finishes: `Done uploading`.

### Step 2: How to Identify your ESP32 COM Port in Windows
1. Press `Windows Key + X` and select **Device Manager**.
2. Expand the **Ports (COM & LPT)** section.
3. Look for an entry such as:
   - `Silicon Labs CP210x USB to UART Bridge (COM3)`
   - or `USB-SERIAL CH340 (COM4)`
4. Note the port number (e.g., `COM3`).

### Step 3: Run the Web Dashboard
Open **Windows PowerShell** in your project directory:

```powershell
# 1. Navigate to your project folder
cd "c:\Users\karuk\OneDrive\ドキュメント\Petrol-Leakage-Monitor"

# 2. Install dependencies (Flask & pyserial)
pip install -r requirements.txt

# 3. (Optional) Run automated unit & integration tests
python test_system.py

# 4. Start the Flask IoT server
python app.py
```

Open your web browser and go to: **[http://127.0.0.1:5000](http://127.0.0.1:5000)**

### Step 4: Connect the Dashboard to your ESP32
1. In the dashboard header or on the **ESP32 USB Serial Connection** card, click **Select COM Port**.
2. Select your port (e.g., `COM3`) from the dropdown.
3. Click **Connect ESP32**.
4. The status pill will switch to `Connected (COM3)`, and live sensor readings from GPIO 34 and GPIO 35 will begin streaming immediately!

---

## 6. How to Verify Readings Match Arduino Serial Monitor

> [!IMPORTANT]
> **Windows COM Port Rule:** A serial port can only be opened by **one program at a time**.
> If the Arduino IDE Serial Monitor is open, Python will receive `Access is denied (PermissionError)`.

To verify your readings:
1. **Verification Test with Serial Monitor:**
   - In Arduino IDE, open **Tools > Serial Monitor** (set baud rate to **9600**).
   - Verify you see:
     ```text
     gas1_val:XXX
     gas2_val:YYY
     ```
   - Test response by exposing Sensor 1 or Sensor 2 to a drop of Isopropyl Alcohol on a cotton swab and watch the values rise.
2. **Switching to the Web Dashboard:**
   - **Close** the Arduino Serial Monitor window.
   - On the web dashboard at `http://127.0.0.1:5000`, select your COM port and click **Connect ESP32**.
   - Compare: the values displayed under **Zone 1** and **Zone 2** will match the values you saw in the Serial Monitor in real time.

---

## 7. AI Incident Safety Advisor & HAZMAT Response (OpenAI)

The dashboard includes an intelligent **AI Incident Safety Advisor** designed to provide immediate HAZMAT emergency mitigation protocols when hazardous vapor leaks are detected.

- **Engine:** Powered by OpenAI (`gpt-4o-mini`) via `.env` configuration.
- **Fail-Safe Offline Mode:** If the OpenAI API key is unavailable or rate-limited/uncredited, the system automatically falls back to certified industrial NFPA/OSHA rule-based emergency safety protocols without crashing.
- **Features:**
  - Real-time hazard severity calculation (`CRITICAL`, `HIGH`, `ELEVATED`, `SAFE`).
  - Hydrocarbon flammability & vapor cloud explosion risk analysis.
  - Prioritized emergency containment checklist with interactive task checkmarks.
  - Safe perimeter evacuation radius and required PPE standards (respirators, antistatic suits).
  - Accessible via the **AI Safety Advisor** header button or the pulsing **AI Response Plan** button inside active leak alarm banners.

---

## 8. Project Files Summary

```
Petrol-Leakage-Monitor/
├── .env                                     # API secrets (OpenAI API key - gitignored)
├── .env.example                             # Configuration template
├── ai_advisor.py                            # OpenAI & certified HAZMAT emergency protocol engine
├── app.py                                   # Flask web server, auth & REST endpoints
├── database.py                              # SQLite manager (petrol_monitor.db)
├── reset_admin.py                           # CLI utility to reset admin credentials
├── serial_reader.py                         # Background USB Serial reader daemon
├── requirements.txt                         # Dependencies: Flask, pyserial, openai, python-dotenv
├── run.bat                                  # Windows 1-click launcher
├── test_system.py                           # Hardware & API unit test suite
├── test_ai_advisor.py                       # AI advisor unit and integration test suite
├── firmware/
│   ├── esp32_petrol_leakage_firmware.ino    # Integrated firmware (exact pins, fixed threshold)
│   └── petrol_leakage_esp32.ino             # Reference firmware
├── static/
│   ├── css/style.css                        # Industrial IoT Dark Navy CSS + AI advisor styles
│   └── js/
│       ├── chart_handler.js                 # Real-time streaming Chart.js
│       └── dashboard.js                     # Live telemetry, event & AI advisor controller
└── templates/
    ├── index.html                           # Modern responsive dashboard & AI modal
    ├── login.html                           # User authentication screen
    └── setup.html                           # First-time admin creation screen
```
