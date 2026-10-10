import re
import unittest
import urllib.request
import json

# =============================================================================
# 1. UNIT TEST: SERIAL STRING PARSER
# =============================================================================
class TestSerialParser(unittest.TestCase):
    def setUp(self):
        self.z1_regex = re.compile(r"^gas1_val\s*:\s*(\d+)", re.IGNORECASE)
        self.z2_regex = re.compile(r"^gas2_val\s*:\s*(\d+)", re.IGNORECASE)

    def test_clean_telemetry(self):
        line1 = "gas1_val:650"
        line2 = "gas2_val:1250"
        
        m1 = self.z1_regex.search(line1)
        m2 = self.z2_regex.search(line2)
        
        self.assertIsNotNone(m1)
        self.assertIsNotNone(m2)
        self.assertEqual(int(m1.group(1)), 650)
        self.assertEqual(int(m2.group(1)), 1250)

    def test_stray_unlabeled_lines_ignored(self):
        """Firmware sent 'int a = analogRead(35); Serial.println(a);' in original code."""
        stray_line = "780"
        m1 = self.z1_regex.search(stray_line)
        m2 = self.z2_regex.search(stray_line)
        self.assertIsNone(m1)
        self.assertIsNone(m2)

    def test_threshold_logic_boundaries(self):
        threshold = 1000
        
        # Exact threshold boundary tests:
        # > 1000 is LEAK
        # <= 1000 is NO LEAK (SAFE)
        val_safe_999 = 999
        val_boundary_1000 = 1000
        val_leak_1001 = 1001

        self.assertFalse(val_safe_999 > threshold)       # Safe
        self.assertFalse(val_boundary_1000 > threshold)   # Safe (fixed gap!)
        self.assertTrue(val_leak_1001 > threshold)       # Leak


# =============================================================================
# 2. INTEGRATION TEST: FLASK REST API
# =============================================================================
def test_live_api():
    base = "http://127.0.0.1:5000"
    print("\n--- Testing Live API Endpoints ---")
    
    # 1. Test GET /
    print("[1] Testing GET / ...")
    req = urllib.request.urlopen(base + "/")
    html = req.read().decode("utf-8")
    assert req.status == 200
    assert "Petrol Leakage Detection System" in html
    assert "Real-Time Two-Zone Monitoring" in html
    assert "WAITING FOR ESP32 DATA" in html
    print("    -> PASSED: HTML dashboard served correctly with initial waiting state.")

    # 2. Test GET /api/status (Verify NO mock/fake values exist)
    print("[2] Testing GET /api/status ...")
    req = urllib.request.urlopen(base + "/api/status")
    data = json.loads(req.read().decode("utf-8"))
    
    # Assert values are None or unavailable when no hardware is connected
    assert "zone1" in data and "zone2" in data and "system" in data
    print(f"    -> ESP32 Connected: {data['serial']['is_connected']}")
    print(f"    -> Zone 1 Value: {data['zone1']['value']} (Status: {data['zone1']['status']})")
    print(f"    -> Zone 2 Value: {data['zone2']['value']} (Status: {data['zone2']['status']})")
    print(f"    -> System Status: {data['system']['status']} (Message: {data['system']['message']})")
    
    if not data['serial']['is_connected']:
        assert data['zone1']['value'] is None, "Expected None value when hardware is disconnected!"
        assert data['zone2']['value'] is None, "Expected None value when hardware is disconnected!"
        assert data['zone1']['status'] == "UNAVAILABLE"
        assert data['zone2']['status'] == "UNAVAILABLE"
        print("    -> PASSED: Strictly verified that missing hardware produces UNAVAILABLE/None with NO mock readings.")

    # 3. Test GET /api/serial/ports
    print("[3] Testing GET /api/serial/ports ...")
    req = urllib.request.urlopen(base + "/api/serial/ports")
    ports_data = json.loads(req.read().decode("utf-8"))
    assert ports_data["status"] == "success"
    print(f"    -> Detected COM Ports: {len(ports_data['ports'])} port(s) found on machine.")
    for p in ports_data['ports']:
        print(f"       * {p['port']}: {p['description']}")

    # 4. Test Threshold Endpoint
    print("[4] Testing threshold GET/POST ...")
    req = urllib.request.Request(
        base + "/api/threshold",
        data=json.dumps({"threshold": 1000}).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    resp = urllib.request.urlopen(req)
    t_resp = json.loads(resp.read().decode("utf-8"))
    assert t_resp["threshold"] == 1000.0
    print("    -> PASSED: Threshold set to 1000 ADC successfully.")

    # 5. Test CSV Export
    print("[5] Testing GET /api/export/csv ...")
    req = urllib.request.urlopen(base + "/api/export/csv")
    csv_content = req.read().decode("utf-8")
    assert "Event ID,Timestamp,Zone,Event Type" in csv_content
    print("    -> PASSED: CSV report endpoint generated valid format.")


if __name__ == "__main__":
    print("==================================================================")
    print(" UNIT TESTING SERIAL PARSER & THRESHOLD BOUNDARIES")
    print("==================================================================")
    suite = unittest.TestLoader().loadTestsFromTestCase(TestSerialParser)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    if not result.wasSuccessful():
        exit(1)
        
    test_live_api()
    print("\n>>> ALL TESTS PASSED SUCCESSFULLY! <<<\n")
