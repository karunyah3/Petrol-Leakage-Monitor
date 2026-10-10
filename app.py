import os
from flask import Flask, render_template, jsonify, request, Response
import database
from serial_reader import state_manager

app = Flask(__name__)
app.config["SECRET_KEY"] = "petrol-leak-monitor-secret-key-2026"

# Initialize database tables on startup
database.init_db()


@app.route("/")
def index():
    """Renders the main dashboard page."""
    current_state = state_manager.get_current_state()
    return render_template("index.html", initial_state=current_state)


@app.route("/api/status", methods=["GET"])
def get_status():
    """Returns the latest real-time system status and sensor readings."""
    return jsonify(state_manager.get_current_state())


@app.route("/api/readings/recent", methods=["GET"])
def get_recent_readings():
    """Returns recent sensor readings for graph initialization."""
    limit = request.args.get("limit", default=60, type=int)
    readings = database.get_recent_readings(limit=limit)
    return jsonify({
        "status": "success",
        "count": len(readings),
        "readings": readings
    })


@app.route("/api/events", methods=["GET"])
def get_events():
    """Returns event history logs with optional filtering."""
    limit = request.args.get("limit", default=50, type=int)
    zone_filter = request.args.get("zone", default="ALL", type=str)
    severity_filter = request.args.get("severity", default="ALL", type=str)
    
    events = database.get_events(
        limit=limit,
        zone_filter=zone_filter,
        severity_filter=severity_filter
    )
    return jsonify({
        "status": "success",
        "count": len(events),
        "events": events
    })


@app.route("/api/threshold", methods=["GET", "POST"])
def handle_threshold():
    """Gets or updates the global leak detection threshold."""
    if request.method == "POST":
        data = request.get_json(silent=True) or request.form
        try:
            new_val = float(data.get("threshold"))
            if new_val < 0 or new_val > 4095:
                return jsonify({"status": "error", "message": "Threshold must be between 0 and 4095"}), 400
            
            updated = database.set_threshold(new_val)
            state_manager.evaluate_and_log()
            return jsonify({
                "status": "success",
                "message": f"Threshold successfully updated to {updated:.0f}",
                "threshold": updated
            })
        except (ValueError, TypeError) as e:
            return jsonify({"status": "error", "message": f"Invalid threshold value: {str(e)}"}), 400

    # GET request
    return jsonify({
        "status": "success",
        "threshold": database.get_threshold()
    })


@app.route("/api/zones/rename", methods=["POST"])
def rename_zones():
    """Updates custom zone names."""
    data = request.get_json(silent=True) or request.form
    z1_name = data.get("zone1_name", "").strip()
    z2_name = data.get("zone2_name", "").strip()
    
    if z1_name:
        database.set_setting("zone1_name", z1_name)
    if z2_name:
        database.set_setting("zone2_name", z2_name)
        
    return jsonify({
        "status": "success",
        "zone1_name": database.get_setting("zone1_name"),
        "zone2_name": database.get_setting("zone2_name")
    })


@app.route("/api/serial/ports", methods=["GET"])
def get_serial_ports():
    """Returns detected serial COM ports."""
    ports = state_manager.list_ports()
    return jsonify({
        "status": "success",
        "ports": ports
    })


@app.route("/api/serial/connect", methods=["POST"])
def connect_serial_port():
    """Connects to the specified COM port."""
    data = request.get_json(silent=True) or request.form
    port = data.get("port")
    baud = int(data.get("baud_rate", 9600))
    
    if not port:
        return jsonify({"status": "error", "message": "No COM port specified"}), 400
        
    success = state_manager.connect_serial(port_name=port, baud_rate=baud)
    if success:
        return jsonify({
            "status": "success",
            "message": f"Connected to {port} at {baud} baud",
            "port": port
        })
    else:
        return jsonify({
            "status": "error",
            "message": state_manager.serial_error or "Failed to open serial port"
        }), 500


@app.route("/api/serial/disconnect", methods=["POST"])
def disconnect_serial_port():
    """Disconnects from current serial COM port."""
    state_manager.disconnect_serial()
    return jsonify({
        "status": "success",
        "message": "Disconnected from serial port"
    })





@app.route("/api/alarm/acknowledge", methods=["POST"])
def acknowledge_alarm():
    """Acknowledges active alarms (silences alarm, logs event, leaves leak status intact)."""
    database.acknowledge_all_events()
    return jsonify({
        "status": "success",
        "message": "Alarm acknowledged. (Active leak conditions remain active until concentration drops below threshold)."
    })


@app.route("/api/export/csv", methods=["GET"])
def export_csv():
    """Exports all event logs to a downloadable CSV file."""
    csv_data = database.export_events_csv_string()
    return Response(
        csv_data,
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment;filename=petrol_leak_event_logs.csv"}
    )


@app.route("/api/events/clear", methods=["POST"])
def clear_event_logs():
    """Clears all historical event logs."""
    database.clear_events()
    return jsonify({
        "status": "success",
        "message": "Event history cleared"
    })


if __name__ == "__main__":
    print("=================================================================")
    print(" TWO-ZONE PETROL LEAKAGE DETECTION & MONITORING SYSTEM")
    print(" College Project Dashboard - Starting Server")
    print(" Open your browser at: http://127.0.0.1:5000")
    print("=================================================================")
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
