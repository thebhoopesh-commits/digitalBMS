"""
Dual-Engine Natural Language Translation Pipeline.
Leverages Google Gemini Generative AI API with automatic zero-friction fallback
to the deterministic rule-based parser.
"""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.request
import urllib.error
from typing import Any, Dict, Optional

from src.nlp.fallback_parser import DeterministicFallbackParser
from src.nlp.schemas import (
    NLPTranslationResult,
    ThermalIntent,
    UrgencyLevel,
    ZoneConstraint,
)

logger = logging.getLogger("hvac.nlp.translator")

SYSTEM_PROMPT = """You are an expert Building Automation and HVAC Comfort Translation AI.
Your task is to analyze natural language occupant feedback and translate it into a structured environmental constraint JSON object.

Valid Zone IDs:
- 'lobby'
- 'open_office'
- 'conference_room'
- 'server_room'

Valid Intents:
- 'too_cold' (occupant feels cold/freezing/chilly -> temperature_offset_c must be POSITIVE, e.g. +1.0 to +3.0)
- 'too_warm' (occupant feels hot/warm/sweltering -> temperature_offset_c must be NEGATIVE, e.g. -1.0 to -3.5)
- 'too_humid' (occupant feels humid/sticky -> humidity_offset_pct must be NEGATIVE, e.g. -5 to -15)
- 'too_dry' (occupant feels dry/arid -> humidity_offset_pct must be POSITIVE, e.g. +5 to +15)
- 'stuffy' (poor air/stale air -> intent 'stuffy', temperature_offset_c -1.0, humidity_offset_pct -5.0)
- 'comfortable' (satisfactory comfort -> temperature_offset_c 0.0)
- If the occupant requests an absolute target temperature (e.g. "set temperature to 26C"), calculate the offset relative to a 22.0C baseline. (e.g. 26C -> offset of +4.0).
- If the occupant mentions a change in room occupancy (e.g. "two more people entered" or "five people left"), adjust the temperature offset to counteract their body heat: DECREASE the temperature offset by 0.5C per additional person, or INCREASE it by 0.5C per person leaving. Set the intent to 'too_warm' for entering or 'too_cold' for leaving.

Urgency Levels:
- 'high' (critical, emergency, spiking, freezing, boiling, max cooling, immediately)
- 'medium' (standard complaint)
- 'low' (mild, slight, a bit chilly/warm)

Applicability Rules:
- If the query is NOT related to indoor thermal comfort, humidity, or air quality (e.g. cafeteria hours, wifi, parking, general questions), set is_applicable to false and constraints to [].
- If the query is a simple status question ("what is the temperature?"), set is_applicable to false, constraints to [], but provide the answer using live building context in response_text.
- If is_applicable is true, constraints MUST contain at least one valid ZoneConstraint.

JSON Output Schema (Do NOT include any extra keys):
{
  "raw_query": string,
  "is_applicable": boolean,
  "response_text": string,
  "constraints": [
    {
      "zone_id": string,
      "intent": "too_cold" | "too_warm" | "too_humid" | "too_dry" | "stuffy" | "comfortable",
      "temperature_offset_c": float,
      "humidity_offset_pct": float,
      "target_temp_bounds_c": [min_temp, max_temp] or null,
      "urgency": "low" | "medium" | "high",
      "duration_minutes": integer,
      "confidence": float,
      "reasoning": string
    }
  ],
  "timestamp": float
}
"""


def clean_json_markdown(text: str) -> str:
    """Removes markdown code fences and cleans JSON output."""
    cleaned = text.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    elif cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return cleaned.strip()


def _call_gemini_api(prompt: str, api_key: str, model_name: str = "gemini-3.6-flash") -> str:
    """
    Attempts to call Gemini API via available SDKs or direct REST fallback,
    with exponential backoff for 429 Too Many Requests errors.
    """
    import time
    max_retries = 3
    base_delay = 2.0

    for attempt in range(max_retries):
        # 1. Try modern google-genai SDK
        try:
            from google import genai
            client = genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config={"response_mime_type": "application/json"},
            )
            if hasattr(response, "text") and response.text:
                return response.text
        except Exception as e:
            if "429" in str(e):
                logger.debug(f"genai SDK 429 error on attempt {attempt+1}")
            else:
                logger.debug(f"google-genai SDK attempt failed or unavailable: {e}")

        # 2. Try legacy google.generativeai SDK
        try:
            import google.generativeai as genai_legacy
            from google.api_core.exceptions import ResourceExhausted
            genai_legacy.configure(api_key=api_key)
            model = genai_legacy.GenerativeModel(model_name)
            response = model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"},
            )
            if hasattr(response, "text") and response.text:
                return response.text
        except Exception as e:
            if "429" in str(e) or "ResourceExhausted" in type(e).__name__:
                logger.debug(f"genai_legacy SDK 429 error on attempt {attempt+1}")
            else:
                logger.debug(f"google.generativeai SDK attempt failed or unavailable: {e}")

        # 3. Direct HTTPS REST request fallback via requests
        try:
            import requests
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
            headers = {"Content-Type": "application/json"}
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "temperature": 0.1,
                },
            }
            resp = requests.post(url, headers=headers, json=payload, timeout=5.0)
            resp.raise_for_status()
            data = resp.json()
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except Exception as e:
            if hasattr(e, "response") and e.response is not None and e.response.status_code == 429:
                logger.debug(f"requests REST 429 error on attempt {attempt+1}")
            else:
                logger.debug(f"requests REST attempt failed: {e}")

        # 4. Standard library urllib.request fallback (Zero third-party library dependencies)
        try:
            import urllib.request
            import urllib.error
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
            payload_bytes = json.dumps({
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "temperature": 0.1,
                },
            }).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=payload_bytes,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30.0) as resp:
                body = resp.read().decode("utf-8")
                data = json.loads(body)
                return data["candidates"][0]["content"]["parts"][0]["text"]
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < max_retries - 1:
                sleep_time = base_delay * (2 ** attempt)
                logger.warning(f"HTTP 429 Too Many Requests. Retrying in {sleep_time}s...")
                import os
                if "PYTEST_CURRENT_TEST" not in os.environ:
                    time.sleep(sleep_time)
                continue
            raise e
        except Exception as e:
            raise e


def translate_complaint(
    text: str,
    current_time: Optional[float] = None,
    api_key: Optional[str] = None,
    model_name: str = "gemini-3.6-flash",
    live_building_state: Optional[Dict[str, Any]] = None,
    outdoor_temp_c: float = 25.0,
    history: Optional[List[Dict[str, str]]] = None,
) -> NLPTranslationResult:
    """
    Translates an occupant natural language complaint into a structured constraint model.
    Seamlessly falls back to DeterministicFallbackParser on missing key, network error,
    timeout, or schema validation failure.
    """
    timestamp = current_time if current_time is not None else 0.0
    key = api_key or os.environ.get("GEMINI_API_KEY")

    if not key or not key.strip():
        logger.debug("No GEMINI_API_KEY configured. Executing DeterministicFallbackParser.")
        return DeterministicFallbackParser.parse(text, timestamp=timestamp)

    context_block = ""
    if live_building_state:
        context_block = (
            "--- LAYER 3: LIVE BUILDING CONTEXT ---\n"
            f"Outdoor Temperature: {outdoor_temp_c}°C\n"
            f"Zone States: {json.dumps(live_building_state, indent=2)}\n"
            "--------------------------------------\n\n"
        )
        
    history_block = ""
    if history:
        history_block = "--- LAYER 4: DIALOGUE HISTORY ---\n"
        for msg in history:
            history_block += f"{msg.get('role', 'unknown').capitalize()}: {msg.get('content', '')}\n"
        history_block += "---------------------------------\n\n"

    full_prompt = (
        f"{SYSTEM_PROMPT}\n\n"
        f"{context_block}"
        f"{history_block}"
        f"Occupant Input Query: \"{text}\"\n"
        f"Current Timestamp: {timestamp}\n"
        "JSON Response:"
    )

    try:
        raw_response = _call_gemini_api(full_prompt, api_key=key.strip(), model_name=model_name)
        cleaned_json = clean_json_markdown(raw_response)
        parsed_dict = json.loads(cleaned_json)
        
        # Override timestamp if missing or inconsistent
        if "timestamp" not in parsed_dict or parsed_dict["timestamp"] == 0.0:
            parsed_dict["timestamp"] = timestamp
            
        # Enforce exact Pydantic schema validation (with extra="forbid")
        result = NLPTranslationResult.model_validate(parsed_dict)
        return result
    except Exception as exc:
        logger.warning(
            f"LLM translation failed ({type(exc).__name__}: {exc}). "
            "Falling back to DeterministicFallbackParser."
        )
        return DeterministicFallbackParser.parse(text, timestamp=timestamp)
