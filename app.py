import os
import secrets
from functools import wraps
from flask import Flask, render_template, jsonify, request, Response, session, redirect, url_for, flash
from werkzeug.security import generate_password_hash, check_password_hash
import database
from serial_reader import state_manager
import ai_advisor

app = Flask(__name__)
app.config["SECRET_KEY"] = secrets.token_hex(32)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["PERMANENT_SESSION_LIFETIME"] = 86400  # 24 hours

# Initialize database tables on startup
database.init_db()


# =============================================================================
# AUTHENTICATION HELPERS
# =============================================================================

def login_required(f):
    """Decorator to protect routes that require authentication."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "user_id" not in session:
            # For API routes, return JSON error
            if request.path.startswith("/api/"):
                return jsonify({"status": "error", "message": "Authentication required"}), 401
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated_function


# =============================================================================
# AUTHENTICATION ROUTES
# =============================================================================

@app.route("/setup", methods=["GET", "POST"])
def setup():
    """First-time administrator account creation. Only available when no users exist."""
    if database.has_any_users():
        return redirect(url_for("login"))

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()
        confirm = request.form.get("confirm_password", "").strip()

        if not username or len(username) < 3:
            flash("Username must be at least 3 characters.", "error")
            return render_template("setup.html")

        if not password or len(password) < 6:
            flash("Password must be at least 6 characters.", "error")
            return render_template("setup.html")

        if password != confirm:
            flash("Passwords do not match.", "error")
            return render_template("setup.html")

        hashed = generate_password_hash(password)
        success = database.create_user(username, hashed, is_admin=1)

        if success:
            flash("Administrator account created successfully. Please log in.", "success")
            return redirect(url_for("login"))
        else:
            flash("Failed to create account. Username may already exist.", "error")
            return render_template("setup.html")

    return render_template("setup.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    """User login page."""
    if not database.has_any_users():
        return redirect(url_for("setup"))

    if "user_id" in session:
        return redirect(url_for("index"))

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()

        if not username or not password:
            flash("Please enter both username and password.", "error")
            return render_template("login.html")

        user = database.get_user(username)

        if user and check_password_hash(user["password_hash"], password):
            session.permanent = True
            session["user_id"] = user["id"]
            session["username"] = user["username"]
            return redirect(url_for("index"))
        else:
            flash("Invalid username or password.", "error")
            return render_template("login.html")

    return render_template("login.html")


@app.route("/logout")
def logout():
    """Logs out the current user."""
    session.clear()
    return redirect(url_for("login"))


# =============================================================================
# DASHBOARD ROUTES (PROTECTED)
# =============================================================================

@app.route("/")
@login_required
def index():
    """Renders the main dashboard page."""
    current_state = state_manager.get_current_state()
    return render_template("index.html", initial_state=current_state, username=session.get("username", ""))


@app.route("/api/status", methods=["GET"])
@login_required
def get_status():
    """Returns the latest real-time system status and sensor readings."""
    return jsonify(state_manager.get_current_state())


@app.route("/api/readings/recent", methods=["GET"])
@login_required
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
@login_required
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
@login_required
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
@login_required
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
@login_required
def get_serial_ports():
    """Returns detected serial COM ports."""
    ports = state_manager.list_ports()
    return jsonify({
        "status": "success",
        "ports": ports
    })


@app.route("/api/serial/connect", methods=["POST"])
@login_required
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
@login_required
def disconnect_serial_port():
    """Disconnects from current serial COM port."""
    state_manager.disconnect_serial()
    return jsonify({
        "status": "success",
        "message": "Disconnected from serial port"
    })


@app.route("/api/alarm/acknowledge", methods=["POST"])
@login_required
def acknowledge_alarm():
    """Acknowledges active alarms (silences alarm, logs event, leaves leak status intact)."""
    database.acknowledge_all_events()
    return jsonify({
        "status": "success",
        "message": "Alarm acknowledged. (Active leak conditions remain active until concentration drops below threshold)."
    })


@app.route("/api/export/csv", methods=["GET"])
@login_required
def export_csv():
    """Exports all event logs to a downloadable CSV file."""
    csv_data = database.export_events_csv_string()
    return Response(
        csv_data,
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment;filename=petrol_leak_event_logs.csv"}
    )


@app.route("/api/events/clear", methods=["POST"])
@login_required
def clear_event_logs():
    """Clears all historical event logs."""
    database.clear_events()
    return jsonify({
        "status": "success",
        "message": "Event history cleared"
    })


# =============================================================================
# AI SAFETY ADVISOR & HAZMAT EMERGENCY PROTOCOLS (OPENAI)
# =============================================================================

@app.route("/api/ai/analyze", methods=["POST", "GET"])
@login_required
def ai_analyze_leak():
    """
    Analyzes an active or selected zone leak incident using OpenAI / HAZMAT engine.
    Accepts optional JSON payload: {"zone": "Zone 1" | "Zone 2", "reading": 1250, "trend": "..."}
    """
    data = request.get_json(silent=True) or {}
    state = state_manager.get_current_state()
    threshold = state.get("threshold", database.get_threshold())

    zone_param = data.get("zone", "").strip()
    
    # Determine target zone to analyze
    if "1" in zone_param or (not zone_param and state.get("zone1_status") == "LEAK"):
        zone_name = state.get("zone1_name", "Zone 1 - Storage Tank")
        reading_val = float(data.get("reading", state.get("zone1_val", 0)))
    elif "2" in zone_param or (not zone_param and state.get("zone2_status") == "LEAK"):
        zone_name = state.get("zone2_name", "Zone 2 - Dispensing Unit")
        reading_val = float(data.get("reading", state.get("zone2_val", 0)))
    else:
        # Default to whichever zone has higher reading
        if state.get("zone2_val", 0) > state.get("zone1_val", 0):
            zone_name = state.get("zone2_name", "Zone 2 - Dispensing Unit")
            reading_val = float(data.get("reading", state.get("zone2_val", 0)))
        else:
            zone_name = state.get("zone1_name", "Zone 1 - Storage Tank")
            reading_val = float(data.get("reading", state.get("zone1_val", 0)))

    trend = data.get("trend")
    if not trend:
        # Check system status
        sys_status = state.get("system_status", "SAFE")
        trend = f"System state: {sys_status}, Reading: {reading_val:.0f} (Threshold: {threshold:.0f})"

    analysis = ai_advisor.analyze_leak_incident(
        zone_name=zone_name,
        reading_val=reading_val,
        threshold=threshold,
        recent_trend=trend
    )
    return jsonify(analysis)


@app.route("/api/ai/config", methods=["GET", "POST"])
@login_required
def ai_config():
    """Retrieves or updates OpenAI API key and model preferences."""
    if request.method == "POST":
        data = request.get_json(silent=True) or request.form
        new_key = data.get("api_key", "").strip()
        new_model = data.get("model", "").strip()

        if new_key:
            database.set_setting("openai_api_key", new_key)
            os.environ["OPENAI_API_KEY"] = new_key
        if new_model:
            database.set_setting("openai_model", new_model)
            os.environ["OPENAI_MODEL"] = new_model

        return jsonify({
            "status": "success",
            "message": "AI configuration updated successfully"
        })

    # GET: return masked key status and model
    current_key = ai_advisor.get_api_key()
    masked = f"{current_key[:8]}...{current_key[-4:]}" if len(current_key) > 12 else ("Configured" if current_key else "Not Configured")
    current_model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    return jsonify({
        "status": "success",
        "has_api_key": bool(current_key),
        "api_key_masked": masked,
        "model": current_model
    })



if __name__ == "__main__":
    print("=================================================================")
    print(" TWO-ZONE PETROL LEAKAGE DETECTION & MONITORING SYSTEM")
    print(" College Project Dashboard - Starting Server")
    print(" Open your browser at: http://127.0.0.1:5000")
    if not database.has_any_users():
        print(" FIRST RUN: Visit http://127.0.0.1:5000/setup to create admin")
    print("=================================================================")
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
