import re
import time
import threading
import serial
import serial.tools.list_ports
import database


class HardwareSerialManager:
    """Thread-safe manager for real-time USB Serial hardware communication with ESP32."""

    def __init__(self):
        self._lock = threading.Lock()
        
        # Real-time sensor readings from hardware (None until received)
        self.zone1_val = None
        self.zone2_val = None
        self.zone1_time = None
        self.zone2_time = None
        self.zone1_unlogged = False
        self.zone2_unlogged = False
        self.last_data_time = None
        self.last_successful_reading_time = None
        self.stale_timeout_sec = 3.5  # Stale if no packet within 3.5s (ESP32 sends at 2Hz)
        
        # State tracking for genuine transition events only
        self.prev_zone1_status = None
        self.prev_zone2_status = None
        self.prev_system_status = None
        
        # Serial connection configuration
        self.serial_port = None
        self.baud_rate = 9600
        self.is_serial_connected = False
        self.serial_instance = None
        self.serial_error = None
        
        # Thread control
        self.serial_thread = None
        self.running = True
        
        # Auto-detect and attempt to connect to ESP32 on startup if available
        self.auto_connect_startup()

    def auto_connect_startup(self):
        """Attempts to auto-connect to any detected Silicon Labs, CH340, or USB Serial port."""
        ports = self.list_ports()
        for p in ports:
            desc = p["description"].lower()
            hwid = p["hwid"].lower()
            if any(k in desc or k in hwid for k in ["cp210", "ch340", "ch341", "usb-serial", "ftdi", "esp32", "uart"]):
                print(f"[*] Detected potential ESP32 device on {p['port']} ({p['description']}). Attempting connection...")
                self.connect_serial(p["port"], 9600)
                break

    def list_ports(self):
        """Returns a list of available serial COM ports on the system."""
        ports = []
        for port in serial.tools.list_ports.comports():
            ports.append({
                "port": port.device,
                "description": port.description,
                "hwid": port.hwid
            })
        return ports

    def connect_serial(self, port_name: str, baud_rate: int = 9600) -> bool:
        """Connects to a specific serial COM port with a dedicated background reading thread."""
        with self._lock:
            self._disconnect_serial_locked()
            
            self.serial_port = port_name
            self.baud_rate = baud_rate
            self.serial_error = None
            
            try:
                self.serial_instance = serial.Serial(
                    port=port_name,
                    baudrate=baud_rate,
                    timeout=1.0
                )
                self.is_serial_connected = True
                
                # Start daemon reading thread
                self.serial_thread = threading.Thread(target=self._serial_worker, daemon=True)
                self.serial_thread.start()
                
                database.log_event(
                    zone="System",
                    event_type="HARDWARE_CONNECTED",
                    message=f"ESP32 connected successfully on {port_name} at {baud_rate} baud",
                    severity="SUCCESS"
                )
                print(f"[SERIAL] Connected to ESP32 on {port_name} @ {baud_rate} baud")
                return True
            except Exception as e:
                self.is_serial_connected = False
                self.serial_error = str(e)
                print(f"[SERIAL ERROR] Failed to connect to {port_name}: {e}")
                database.log_event(
                    zone="System",
                    event_type="CONNECTION_ERROR",
                    message=f"Failed to connect to {port_name}: {str(e)}",
                    severity="DANGER"
                )
                return False

    def disconnect_serial(self):
        """Closes the active serial connection."""
        with self._lock:
            self._disconnect_serial_locked()
            self.zone1_val = None
            self.zone2_val = None
            self.zone1_time = None
            self.zone2_time = None
            self.zone1_unlogged = False
            self.zone2_unlogged = False
            self.last_data_time = None
            
            database.log_event(
                zone="System",
                event_type="HARDWARE_DISCONNECTED",
                message="ESP32 serial connection closed by user",
                severity="INFO"
            )

    def _disconnect_serial_locked(self):
        """Internal helper to close serial port while holding lock."""
        self.is_serial_connected = False
        if self.serial_instance:
            try:
                self.serial_instance.close()
            except Exception:
                pass
            self.serial_instance = None

    def _serial_worker(self):
        """Background thread continuously reading real lines from ESP32."""
        buffer = ""
        z1_regex = re.compile(r"^gas1_val\s*:\s*(\d+)", re.IGNORECASE)
        z2_regex = re.compile(r"^gas2_val\s*:\s*(\d+)", re.IGNORECASE)
        
        while self.running and self.is_serial_connected and self.serial_instance:
            try:
                if self.serial_instance.in_waiting > 0:
                    raw_chunk = self.serial_instance.read(self.serial_instance.in_waiting).decode("utf-8", errors="replace")
                    buffer += raw_chunk
                    
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line:
                            continue
                        
                        # Parse gas1_val and gas2_val from real hardware lines
                        m1 = z1_regex.search(line)
                        m2 = z2_regex.search(line)
                        
                        if m1:
                            val1 = float(m1.group(1))
                            self._update_real_reading(zone1_val=val1)
                        elif m2:
                            val2 = float(m2.group(1))
                            self._update_real_reading(zone2_val=val2)
                        else:
                            # Safely ignore any extra or unlabeled lines (e.g. extra prints)
                            pass
                else:
                    time.sleep(0.02)
            except Exception as e:
                with self._lock:
                    self.serial_error = str(e)
                    self.is_serial_connected = False
                    self.zone1_val = None
                    self.zone2_val = None
                    self.zone1_time = None
                    self.zone2_time = None
                    self.zone1_unlogged = False
                    self.zone2_unlogged = False
                    self.last_data_time = None
                print(f"[SERIAL] Lost connection: {e}")
                database.log_event(
                    zone="System",
                    event_type="HARDWARE_DISCONNECTED",
                    message=f"ESP32 serial link lost: {str(e)}",
                    severity="WARNING"
                )
                break

    def _update_real_reading(self, zone1_val: float = None, zone2_val: float = None):
        """Updates internal values with genuine sensor readings and triggers state evaluation."""
        now = time.time()
        with self._lock:
            if zone1_val is not None:
                self.zone1_val = zone1_val
                self.zone1_time = now
                self.zone1_unlogged = True
            if zone2_val is not None:
                self.zone2_val = zone2_val
                self.zone2_time = now
                self.zone2_unlogged = True
                
            self.last_data_time = now
            self.last_successful_reading_time = now

        # Only evaluate and log when at least one valid reading has been received
        self.evaluate_and_log()

    def evaluate_and_log(self):
        """Evaluates thresholds based purely on real hardware data."""
        threshold = database.get_threshold()
        now = time.time()
        
        with self._lock:
            z1 = self.zone1_val
            z2 = self.zone2_val
            z1_time = self.zone1_time
            z2_time = self.zone2_time
            last_time = self.last_data_time
            is_connected = self.is_serial_connected
            
        z1_stale = (z1_time is None) or ((now - z1_time) > self.stale_timeout_sec)
        z2_stale = (z2_time is None) or ((now - z2_time) > self.stale_timeout_sec)
        is_stale = (last_time is None) or ((now - last_time) > self.stale_timeout_sec) or z1_stale or z2_stale
        
        # Determine statuses based on strict hardware presence
        if not is_connected or is_stale or z1 is None or z2 is None:
            z1_status = "UNAVAILABLE"
            z2_status = "UNAVAILABLE"
            sys_status = "DISCONNECTED" if not is_connected else "STALE"
        else:
            # Consistent threshold logic: > threshold is leak, <= threshold is safe
            z1_status = "LEAK" if z1 > threshold else "SAFE"
            z2_status = "LEAK" if z2 > threshold else "SAFE"
            
            if z1_status == "LEAK" or z2_status == "LEAK":
                sys_status = "LEAK"
            else:
                sys_status = "SAFE"

        # Save exactly one record per complete pair of fresh readings
        should_log = False
        with self._lock:
            if (
                is_connected
                and not is_stale
                and z1 is not None
                and z2 is not None
                and self.zone1_unlogged
                and self.zone2_unlogged
            ):
                should_log = True
                self.zone1_unlogged = False
                self.zone2_unlogged = False

        if should_log:
            database.log_reading(
                zone1_val=z1,
                zone2_val=z2,
                zone1_status=z1_status,
                zone2_status=z2_status,
                system_status=sys_status,
                source="HARDWARE"
            )

        # Detect genuine state transitions only (no fake alerts)
        with self._lock:
            if is_connected and not is_stale and z1 is not None:
                if self.prev_zone1_status != z1_status:
                    if z1_status == "LEAK":
                        database.log_event(
                            zone="Zone 1",
                            event_type="LEAK_DETECTED",
                            reading_value=z1,
                            threshold_value=threshold,
                            message=f"Possible petrol/gas vapour leak detected in Zone 1 (Sensor reading: {z1:.0f} > Threshold: {threshold:.0f})",
                            severity="DANGER"
                        )
                    elif z1_status == "SAFE" and self.prev_zone1_status == "LEAK":
                        database.log_event(
                            zone="Zone 1",
                            event_type="RETURNED_SAFE",
                            reading_value=z1,
                            threshold_value=threshold,
                            message=f"Zone 1 concentration normalized to safe level ({z1:.0f} <= {threshold:.0f})",
                            severity="SUCCESS"
                        )
                    self.prev_zone1_status = z1_status

            if is_connected and not is_stale and z2 is not None:
                if self.prev_zone2_status != z2_status:
                    if z2_status == "LEAK":
                        database.log_event(
                            zone="Zone 2",
                            event_type="LEAK_DETECTED",
                            reading_value=z2,
                            threshold_value=threshold,
                            message=f"Possible petrol/gas vapour leak detected in Zone 2 (Sensor reading: {z2:.0f} > Threshold: {threshold:.0f})",
                            severity="DANGER"
                        )
                    elif z2_status == "SAFE" and self.prev_zone2_status == "LEAK":
                        database.log_event(
                            zone="Zone 2",
                            event_type="RETURNED_SAFE",
                            reading_value=z2,
                            threshold_value=threshold,
                            message=f"Zone 2 concentration normalized to safe level ({z2:.0f} <= {threshold:.0f})",
                            severity="SUCCESS"
                        )
                    self.prev_zone2_status = z2_status

            self.prev_system_status = sys_status

    def get_current_state(self) -> dict:
        """Returns the real-time telemetry snapshot without any simulated or substituted values."""
        threshold = database.get_threshold()
        now = time.time()
        
        with self._lock:
            z1 = self.zone1_val
            z2 = self.zone2_val
            z1_time = self.zone1_time
            z2_time = self.zone2_time
            last_time = self.last_data_time
            last_successful = self.last_successful_reading_time
            is_connected = self.is_serial_connected
            serial_port = self.serial_port
            serial_err = self.serial_error
            
        time_since_data = (now - last_time) if last_time else None
        z1_stale = (z1_time is None) or ((now - z1_time) > self.stale_timeout_sec)
        z2_stale = (z2_time is None) or ((now - z2_time) > self.stale_timeout_sec)
        is_stale = (last_time is None) or (time_since_data is not None and time_since_data > self.stale_timeout_sec) or z1_stale or z2_stale
        
        # State calculation strictly reflecting hardware
        if not is_connected:
            z1_status = "UNAVAILABLE"
            z2_status = "UNAVAILABLE"
            sys_status = "DISCONNECTED"
            sys_msg = "ESP32 HARDWARE DISCONNECTED"
            sys_severity = "UNAVAILABLE"
        elif is_stale or z1 is None or z2 is None:
            z1_status = "UNAVAILABLE"
            z2_status = "UNAVAILABLE"
            sys_status = "WAITING"
            sys_msg = "WAITING FOR ESP32 DATA" if last_time is None else "SENSOR DATA UNAVAILABLE (STALE)"
            sys_severity = "UNAVAILABLE"
        elif z1 > threshold or z2 > threshold:
            z1_status = "LEAK" if z1 > threshold else "SAFE"
            z2_status = "LEAK" if z2 > threshold else "SAFE"
            sys_status = "LEAK"
            
            leak_zones = []
            if z1 > threshold:
                leak_zones.append("ZONE 1")
            if z2 > threshold:
                leak_zones.append("ZONE 2")
            sys_msg = f"WARNING: POSSIBLE LEAK DETECTED ({' & '.join(leak_zones)})"
            sys_severity = "DANGER"
        else:
            z1_status = "SAFE"
            z2_status = "SAFE"
            sys_status = "SAFE"
            sys_msg = "ALL ZONES SAFE"
            sys_severity = "SUCCESS"

        last_time_str = (
            time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(last_successful))
            if last_successful
            else "No data received"
        )
        
        return {
            "threshold": threshold,
            "timestamp": now,
            "last_data_time": last_time_str,
            "seconds_since_last_data": round(time_since_data, 1) if time_since_data is not None else None,
            "is_stale": is_stale,
            "serial": {
                "is_connected": is_connected,
                "port": serial_port,
                "error": serial_err
            },
            "zone1": {
                "name": database.get_setting("zone1_name", "Zone 1 - Storage Tank"),
                "value": round(z1, 1) if z1 is not None and not is_stale else None,
                "raw_value": z1 if not is_stale else None,
                "percentage": round((z1 / 4095.0) * 100, 1) if z1 is not None and not is_stale else 0,
                "status": z1_status,
                "is_leak": (z1_status == "LEAK"),
                "is_safe": (z1_status == "SAFE"),
                "is_unavailable": (z1_status == "UNAVAILABLE")
            },
            "zone2": {
                "name": database.get_setting("zone2_name", "Zone 2 - Dispensing Unit"),
                "value": round(z2, 1) if z2 is not None and not is_stale else None,
                "raw_value": z2 if not is_stale else None,
                "percentage": round((z2 / 4095.0) * 100, 1) if z2 is not None and not is_stale else 0,
                "status": z2_status,
                "is_leak": (z2_status == "LEAK"),
                "is_safe": (z2_status == "SAFE"),
                "is_unavailable": (z2_status == "UNAVAILABLE")
            },
            "system": {
                "status": sys_status,
                "message": sys_msg,
                "severity": sys_severity,
                "is_leak": (sys_status == "LEAK"),
                "is_safe": (sys_status == "SAFE"),
                "is_disconnected": (sys_status == "DISCONNECTED"),
                "is_waiting": (sys_status == "WAITING"),
                "is_stale": is_stale
            }
        }


# Global singleton instance
state_manager = HardwareSerialManager()
