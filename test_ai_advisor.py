"""
Unit and Integration Test for AI Incident Safety Advisor using Flask test_client.
"""
import unittest
import json
import os
from app import app
import ai_advisor

class TestAiAdvisor(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_direct_ai_advisor_offline_fallback(self):
        """Tests that rule-based safety engine generates full emergency protocol."""
        res = ai_advisor.get_rule_based_fallback("Zone 1 - Storage Tank", 1950, 1000)
        self.assertEqual(res["status"], "success")
        self.assertEqual(res["severity_level"], "HIGH")
        self.assertTrue(len(res["immediate_actions"]) >= 4)
        self.assertIn("evacuation_radius", res)
        self.assertIn("ppe_guidance", res)
        print("  [OK] Offline HAZMAT safety protocol engine passed.")

    def test_critical_severity_calculation(self):
        """Tests that ratio >= 2.5 triggers CRITICAL severity."""
        res = ai_advisor.get_rule_based_fallback("Zone 2 - Dispensing Unit", 3200, 1000)
        self.assertEqual(res["severity_level"], "CRITICAL")
        self.assertIn("ESD", res["immediate_actions"][0])
        print("  [OK] CRITICAL severity calculation passed.")

    def test_api_ai_config_endpoint(self):
        """Tests GET /api/ai/config endpoint with logged in session."""
        with self.client.session_transaction() as sess:
            sess["user_id"] = 1
            sess["username"] = "karunyah"

        resp = self.client.get("/api/ai/config")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data.decode("utf-8"))
        self.assertEqual(data["status"], "success")
        self.assertTrue(data["has_api_key"])
        self.assertTrue(data["api_key_masked"].startswith("sk-proj-"))
        print(f"  [OK] /api/ai/config masked key verified: {data['api_key_masked']}")

    def test_api_ai_analyze_endpoint(self):
        """Tests POST /api/ai/analyze endpoint with session."""
        with self.client.session_transaction() as sess:
            sess["user_id"] = 1
            sess["username"] = "karunyah"

        resp = self.client.post(
            "/api/ai/analyze",
            data=json.dumps({"zone": "Zone 1", "reading": 1850}),
            content_type="application/json"
        )
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.data.decode("utf-8"))
        self.assertEqual(data["status"], "success")
        self.assertIn("severity_level", data)
        self.assertIn("immediate_actions", data)
        self.assertIn("flammability_risk", data)
        self.assertIn("evacuation_radius", data)
        self.assertIn("ppe_guidance", data)
        print(f"  [OK] /api/ai/analyze endpoint passed: Severity={data['severity_level']}, Actions={len(data['immediate_actions'])}, Source={data.get('source')}")

if __name__ == "__main__":
    unittest.main()
