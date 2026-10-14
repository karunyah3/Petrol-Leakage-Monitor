"""
AI Safety Advisor Module for Two-Zone Petrol Leakage Monitoring System
Integrates with OpenAI API (gpt-4o-mini / gpt-3.5-turbo) to generate
real-time incident severity assessments and HAZMAT emergency response protocols.
"""

import os
import json
import logging
from typing import Dict, Any, Optional

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logger = logging.getLogger(__name__)

# Fallback protocol if API key is missing or network/API failure occurs
def get_rule_based_fallback(zone_name: str, reading_val: float, threshold: float) -> Dict[str, Any]:
    """Generates standard industrial NFPA 30 / OSHA safety guidance when offline."""
    ratio = reading_val / max(threshold, 1.0)
    
    if ratio >= 2.5:
        severity = "CRITICAL"
        flammability_risk = "Extremely high concentration of hydrocarbon vapors detected. Severe risk of flash fire or vapor cloud explosion if an ignition source is present."
        evacuation = "Evacuate non-essential personnel immediately. Maintain minimum 100m exclusion zone upwind."
        actions = [
            "Actuate Emergency Shutdown (ESD) button to isolate main fuel supply immediately.",
            "Eliminate all ignition sources, hot work, and non-intrinsically safe electrical equipment within 100 meters.",
            "Engage explosion-proof mechanical ventilation or water fog curtain to disperse heavy vapors.",
            "Alert plant safety supervisor and local fire department HAZMAT unit.",
            "Prevent vapor ingress into drainage sumps, trenches, or adjacent enclosed structures."
        ]
        ppe = "Full NFPA flame-resistant antistatic turnouts, SCBA (Self-Contained Breathing Apparatus), or NIOSH organic vapor full-face respirator."
    elif ratio >= 1.5:
        severity = "HIGH"
        flammability_risk = "High vapor accumulation above safety threshold. Rapid vapor migration towards ground-level pooling areas."
        evacuation = "Establish a 50-meter perimeter cordon. Restrict entry to authorized HAZMAT responders only."
        actions = [
            "Close upstream isolation valves feeding the affected zone.",
            "De-energize non-classified electrical machinery and equipment in the immediate vicinity.",
            "Activate auxiliary ventilation systems to prevent vapor pocket formation.",
            "Deploy handheld calibrated combustible gas indicator (CGI) to map Lower Explosive Limit (LEL) boundaries.",
            "Prepare dry chemical or foam fire extinguishers in standby positions."
        ]
        ppe = "Flame-resistant coveralls, nitrile chemical-resistant gloves, eye protection, and organic vapor cartridge half-mask."
    else:
        severity = "ELEVATED"
        flammability_risk = "Moderate volatile hydrocarbon vapors exceeding safe operating baseline. Potential early-stage flange gasket, valve seal, or coupling weepage."
        evacuation = "Keep area clear of unauthorized personnel. Flag zone as active hazard."
        actions = [
            "Inspect physical pipe joints, pump seals, and transfer hoses in the affected zone for seepage.",
            "Throttle flow or divert fuel transfer to alternate line if operational.",
            "Verify adequate natural and mechanical air circulation in the zone.",
            "Monitor trend: if sensor reading continues climbing, escalate to full emergency shutdown."
        ]
        ppe = "Standard antistatic safety footwear, safety glasses, and chemical-resistant gloves."

    return {
        "status": "success",
        "source": "RULE_BASED_SAFETY_ENGINE",
        "severity_level": severity,
        "zone_analyzed": zone_name,
        "reading": reading_val,
        "threshold": threshold,
        "flammability_risk": flammability_risk,
        "immediate_actions": actions,
        "evacuation_radius": evacuation,
        "ppe_guidance": ppe,
        "summary": f"{severity} hazard detected in {zone_name} (reading: {reading_val:.0f} vs threshold: {threshold:.0f}). Follow immediate emergency containment procedures."
    }


def get_api_key() -> str:
    """Retrieves OpenAI API key from environment, .env, or database setting."""
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if key:
        return key

    # Check database system_settings table if available
    try:
        import database
        db_key = database.get_setting("openai_api_key", "").strip()
        if db_key:
            return db_key
    except Exception:
        pass

    return ""


def analyze_leak_incident(
    zone_name: str,
    reading_val: float,
    threshold: float,
    recent_trend: Optional[str] = None
) -> Dict[str, Any]:
    """
    Calls OpenAI API to generate an authoritative industrial safety & emergency protocol.
    Falls back cleanly to standard industrial HAZMAT rules if API is inaccessible.
    """
    api_key = get_api_key()
    if not api_key:
        logger.warning("No OpenAI API key found; using rule-based safety engine.")
        fallback = get_rule_based_fallback(zone_name, reading_val, threshold)
        fallback["note"] = "Generated by offline industrial safety rules. Add OPENAI_API_KEY to enable live AI analysis."
        return fallback

    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)

        prompt = f"""You are an Industrial Chemical HAZMAT & Petroleum Safety Emergency Response Advisor.
A real-time petrol / flammable hydrocarbon vapor leakage alarm has just triggered in an industrial fuel facility:

- Affected Zone: {zone_name}
- Current Sensor Reading: {reading_val:.0f} ADC counts (relative vapor concentration, 0-4095 range)
- Alarm Threshold: {threshold:.0f} ADC counts
- Ratio Above Threshold: {(reading_val / max(threshold, 1.0)):.2f}x
- Recent Trend: {recent_trend or 'Active sensor reading spike'}

Provide an authoritative, actionable emergency incident assessment. Return ONLY a valid JSON object with the following exact keys:
{{
  "severity_level": "LOW" | "ELEVATED" | "HIGH" | "CRITICAL",
  "flammability_risk": "Detailed explanation of vapor ignition and explosion hazards under current concentration",
  "immediate_actions": [
    "Prioritized imperative step 1",
    "Prioritized imperative step 2",
    "Prioritized imperative step 3",
    "Prioritized imperative step 4",
    "Prioritized imperative step 5"
  ],
  "evacuation_radius": "Specific evacuation distance or perimeter cordon recommendations",
  "ppe_guidance": "Specific Personal Protective Equipment required for responders entering the zone",
  "summary": "2-3 sentence executive synopsis for the plant shift supervisor"
}}
"""

        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "You are a senior petroleum safety engineer and HAZMAT emergency incident commander. Always respond with pure, valid JSON."
                },
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=650
        )

        content = response.choices[0].message.content
        data = json.loads(content)

        data["status"] = "success"
        data["source"] = f"OPENAI_{model.upper()}"
        data["zone_analyzed"] = zone_name
        data["reading"] = reading_val
        data["threshold"] = threshold

        return data

    except Exception as e:
        logger.error(f"Error calling OpenAI API: {e}", exc_info=True)
        fallback = get_rule_based_fallback(zone_name, reading_val, threshold)
        fallback["note"] = f"AI service temporarily unavailable ({str(e)[:80]}). Displaying certified offline HAZMAT protocols."
        return fallback
