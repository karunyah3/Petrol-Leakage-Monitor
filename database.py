import sqlite3
import os
import csv
import io
from datetime import datetime

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "petrol_monitor.db")


def get_db_connection():
    """Returns a connection to the SQLite database with row factory enabled."""
    conn = sqlite3.connect(DB_FILE, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initializes SQLite database tables and default settings."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Table for time-series sensor readings
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sensor_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            zone1_val REAL NOT NULL,
            zone2_val REAL NOT NULL,
            zone1_status TEXT NOT NULL,
            zone2_status TEXT NOT NULL,
            system_status TEXT NOT NULL,
            source TEXT DEFAULT 'HARDWARE'
        )
    """)

    # Index for fast time-series retrieval
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_readings_timestamp 
        ON sensor_readings(timestamp)
    """)

    # Table for alerts and event logs
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS event_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            zone TEXT NOT NULL,
            event_type TEXT NOT NULL,
            reading_value REAL,
            threshold_value REAL,
            message TEXT NOT NULL,
            severity TEXT NOT NULL,
            is_acknowledged INTEGER DEFAULT 0
        )
    """)

    # Index for events timestamp
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_events_timestamp 
        ON event_logs(timestamp)
    """)

    # Table for system configuration settings (key-value store)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("SELECT value FROM system_settings WHERE key = 'threshold'")
    if not cursor.fetchone():
        cursor.execute(
            "INSERT INTO system_settings (key, value) VALUES ('threshold', '1000')"
        )

    # Seed default zone names if not present
    cursor.execute("SELECT value FROM system_settings WHERE key = 'zone1_name'")
    if not cursor.fetchone():
        cursor.execute("INSERT INTO system_settings (key, value) VALUES ('zone1_name', 'Zone 1 - Storage Tank')")

    cursor.execute("SELECT value FROM system_settings WHERE key = 'zone2_name'")
    if not cursor.fetchone():
        cursor.execute("INSERT INTO system_settings (key, value) VALUES ('zone2_name', 'Zone 2 - Dispensing Unit')")

    conn.commit()
    conn.close()


def get_setting(key: str, default: str = "") -> str:
    """Retrieves a configuration setting value."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM system_settings WHERE key = ?", (key,))
    row = cursor.fetchone()
    conn.close()
    return row["value"] if row else default


def set_setting(key: str, value: str):
    """Sets or updates a configuration setting."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP
    """, (key, str(value)))
    conn.commit()
    conn.close()


def get_threshold() -> float:
    """Returns the currently active threshold as a float (default 1000.0)."""
    try:
        val = get_setting("threshold", "1000")
        return float(val)
    except Exception:
        return 1000.0


def set_threshold(new_threshold: float) -> float:
    """Updates threshold and records an event log entry."""
    old_threshold = get_threshold()
    new_thresh_float = float(new_threshold)
    set_setting("threshold", str(new_thresh_float))
    
    log_event(
        zone="System",
        event_type="THRESHOLD_CHANGED",
        reading_value=None,
        threshold_value=new_thresh_float,
        message=f"Threshold updated from {old_threshold:.0f} to {new_thresh_float:.0f}",
        severity="INFO"
    )
    return new_thresh_float


def log_reading(zone1_val: float, zone2_val: float, zone1_status: str, zone2_status: str, system_status: str, source: str = "HARDWARE"):
    """Inserts a new sensor reading record."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO sensor_readings (zone1_val, zone2_val, zone1_status, zone2_status, system_status, source)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (zone1_val, zone2_val, zone1_status, zone2_status, system_status, source))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[DB ERROR] Failed to log reading: {e}")


def log_event(zone: str, event_type: str, reading_value: float = None, threshold_value: float = None, message: str = "", severity: str = "INFO"):
    """Inserts an alert or event history log."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO event_logs (zone, event_type, reading_value, threshold_value, message, severity)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (zone, event_type, reading_value, threshold_value, message, severity))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[DB ERROR] Failed to log event: {e}")


def get_recent_readings(limit: int = 60):
    """Fetches recent sensor readings for graph initialization."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT timestamp, zone1_val, zone2_val, zone1_status, zone2_status, system_status, source
        FROM sensor_readings
        ORDER BY id DESC
        LIMIT ?
    """, (limit,))
    rows = cursor.fetchall()
    conn.close()
    # Reverse so oldest in the limit comes first for time-series
    readings = [dict(row) for row in reversed(rows)]
    return readings


def get_events(limit: int = 100, zone_filter: str = None, severity_filter: str = None):
    """Retrieves event logs with optional filtering."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = "SELECT id, timestamp, zone, event_type, reading_value, threshold_value, message, severity, is_acknowledged FROM event_logs"
    conditions = []
    params = []
    
    if zone_filter and zone_filter != "ALL":
        conditions.append("zone = ?")
        params.append(zone_filter)
        
    if severity_filter and severity_filter != "ALL":
        conditions.append("severity = ?")
        params.append(severity_filter)
        
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
        
    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    
    cursor.execute(query, tuple(params))
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def acknowledge_all_events():
    """Marks all active alarm events as acknowledged."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE event_logs
        SET is_acknowledged = 1
        WHERE is_acknowledged = 0
    """)
    conn.commit()
    conn.close()
    
    # Also log an acknowledgement event
    log_event(
        zone="System",
        event_type="ALARM_ACKNOWLEDGED",
        message="Active alarms acknowledged by operator",
        severity="INFO"
    )


def clear_events():
    """Clears event history except system initializations."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM event_logs")
    conn.commit()
    conn.close()
    
    log_event(
        zone="System",
        event_type="SYSTEM_EVENT",
        message="Event history cleared by operator",
        severity="INFO"
    )


def export_events_csv_string() -> str:
    """Exports all event logs to a CSV formatted string."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, timestamp, zone, event_type, reading_value, threshold_value, message, severity, is_acknowledged
        FROM event_logs
        ORDER BY id DESC
    """)
    rows = cursor.fetchall()
    conn.close()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Event ID", "Timestamp", "Zone", "Event Type", "Sensor Reading", "Threshold", "Message", "Severity", "Acknowledged"])
    
    for r in rows:
        writer.writerow([
            r["id"],
            r["timestamp"],
            r["zone"],
            r["event_type"],
            r["reading_value"] if r["reading_value"] is not None else "",
            r["threshold_value"] if r["threshold_value"] is not None else "",
            r["message"],
            r["severity"],
            "YES" if r["is_acknowledged"] else "NO"
        ])
        
    return output.getvalue()


# Automatically initialize database schema on module import
init_db()
