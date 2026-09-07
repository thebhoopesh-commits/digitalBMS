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
from typing import Any, Dict, Optional, List

from src.nlp.fallback_parser import DeterministicFallbackParser
from src.nlp.schemas import (
    SemanticTranslationResult,
    ComfortIntent,
    SeverityLevel,
    SuspectedCause,
    ComfortEvent,
)

logger = logging.getLogger("hvac.nlp.translator")

SYSTEM_PROMPT = """You are an expert Building Automation and HVAC Comfort Translation AI.
Your task is to analyze natural language occupant feedback and extract the semantics into a structured event JSON object.
Do NOT attempt to prescribe physical temperature or humidity offsets; you must only extract the occupant's INTENT, CAUSE, and SEVERITY.

Valid Zone IDs:
- 'lobby'
- 'open_office'
- 'conference_room'
- 'server_room'

Valid Intents:
- 'too_cold' (occupant feels cold/freezing/chilly)
- 'too_warm' (occupant feels hot/warm/sweltering)
- 'too_humid' (occupant feels humid/sticky)
- 'too_dry' (occupant feels dry/arid)
- 'stuffy' (poor air/stale air)
- 'drafty' (feeling air blowing directly on them)
- 'comfortable' (satisfactory comfort)
- 'unknown' (cannot determine intent)

Valid Suspected Causes:
- 'draft'
- 'solar_gain'
- 'high_occupancy'
- 'equipment_heat'
- 'hvac_inactive'
- 'weather_extreme'
- 'unspecified'

Severity Levels:
- 'critical' (emergency, health risk, freezing, boiling)
- 'high' (strong discomfort)
- 'medium' (standard complaint)
- 'low' (mild, slight, a bit chilly/warm)

Applicability Rules:
- If the query is NOT related to indoor thermal comfort, humidity, or air quality (e.g. cafeteria hours, wifi, parking, general questions), set is_applicable to false and events to [].
- If the query is a simple status question ("what is the temperature?"), set is_applicable to false, events to [], but provide the answer using live building context in response_text.
- If the query asks about current room occupancy ("how many people are in the open office?"), set is_applicable to false, events to [], and accurately answer using the exact `occupancy_count` from the LIVE BUILDING CONTEXT in your response_text. Do NOT guess or hallucinate numbers.
- If is_applicable is true, events MUST contain at least one valid ComfortEvent.

JSON Output Schema (Do NOT include any extra keys):
{
  "raw_query": string,
  "is_applicable": boolean,
  "response_text": string,
  "events": [
    {
      "zone_id": string,
      "intent": "too_cold" | "too_warm" | "too_humid" | "too_dry" | "stuffy" | "drafty" | "comfortable" | "unknown",
      "suspected_cause": "draft" | "solar_gain" | "high_occupancy" | "equipment_heat" | "hvac_inactive" | "weather_extreme" | "unspecified",
      "severity": "low" | "medium" | "high" | "critical",
      "confidence": float (0.0 to 1.0),
      "duration_minutes": integer (default 60),
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


def _call_openai_api(prompt: str, api_key: str, model_name: str = "gpt-4o-mini", base_url: str = None) -> str:
    """
    Attempts to call the LLM using the official OpenAI SDK,
    with direct REST fallbacks if the SDK is unavailable.
    """
    import time
    max_retries = 3
    base_delay = 2.0

    for attempt in range(max_retries):
        # 1. Try official openai SDK
        try:
            import openai
            client = openai.OpenAI(api_key=api_key, base_url=base_url)
            response = client.chat.completions.create(
                model=model_name,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                temperature=0.1
            )
            if response.choices and response.choices[0].message.content:
                return response.choices[0].message.content
        except Exception as e:
            import logging
            logger = logging.getLogger("hvac.nlp")
            if "429" in str(e):
                logger.debug(f"OpenAI SDK 429 error on attempt {attempt+1}")
            else:
                logger.debug(f"OpenAI SDK attempt failed: {e}")

        # 2. Direct HTTPS REST request fallback via requests
        try:
            import requests
            url = base_url or "https://api.openai.com/v1"
            url = url.rstrip("/") + "/chat/completions"
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            }
            payload = {
                "model": model_name,
                "messages": [{"role": "user", "content": prompt}],
                "response_format": {"type": "json_object"},
                "temperature": 0.1
            }
            resp = requests.post(url, headers=headers, json=payload, timeout=10.0)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
        except Exception as e:
            import logging
            logger = logging.getLogger("hvac.nlp")
            if hasattr(e, "response") and e.response is not None and e.response.status_code == 429:
                logger.debug(f"requests REST 429 error on attempt {attempt+1}")
            else:
                logger.debug(f"requests REST attempt failed: {e}")

        # 3. Standard library urllib.request fallback
        try:
            import urllib.request
            import urllib.error
            import json
            url = base_url or "https://api.openai.com/v1"
            url = url.rstrip("/") + "/chat/completions"
            payload_bytes = json.dumps({
                "model": model_name,
                "messages": [{"role": "user", "content": prompt}],
                "response_format": {"type": "json_object"},
                "temperature": 0.1
            }).encode("utf-8")
            
            req = urllib.request.Request(
                url,
                data=payload_bytes,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}"
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30.0) as resp:
                body = resp.read().decode("utf-8")
                data = json.loads(body)
                return data["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            import logging
            logger = logging.getLogger("hvac.nlp")
            if e.code in (429, 503) and attempt < max_retries - 1:
                sleep_time = base_delay * (2 ** attempt)
                logger.warning(f"HTTP {e.code} error. Retrying in {sleep_time}s...")
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
    model_name: str = "gpt-4o-mini",
    base_url: Optional[str] = None,
    live_building_state: Optional[Dict[str, Any]] = None,
    outdoor_temp_c: float = 25.0,
    history: Optional[List[Dict[str, str]]] = None,
) -> SemanticTranslationResult:
    """
    Translates an occupant natural language complaint into a structured semantic model.
    Seamlessly falls back to DeterministicFallbackParser on missing key, network error,
    timeout, or schema validation failure.
    """
    timestamp = current_time if current_time is not None else 0.0

    # 1. Check if Local Ollama is configured
    ollama_url = os.environ.get("OLLAMA_URL")
    if ollama_url:
        logger.info(f"Routing request to LocalTranslator at {ollama_url}")
        from src.nlp.local_translator import LocalTranslator
        ollama_model = os.environ.get("OLLAMA_MODEL", "qwen2.5:0.5b")
        local_t = LocalTranslator(
            backend_type="ollama", 
            ollama_url=ollama_url, 
            model_name=ollama_model
        )
        
        # LocalTranslator parses into its own `TranslationResult`
        local_res = local_t.translate(text)
        
        if local_res.success and local_res.event:
            # Map Local ComfortEvent to SemanticTranslationResult
            from src.nlp.schemas import ComfortEvent as SemanticComfortEvent
            from src.nlp.schemas import ComfortIntent, SuspectedCause, SeverityLevel

            sensation_map = {
                "too_cold": ComfortIntent.TOO_COLD,
                "too_warm": ComfortIntent.TOO_WARM,
                "too_humid": ComfortIntent.TOO_HUMID,
                "too_dry": ComfortIntent.TOO_DRY,
                "stuffy": ComfortIntent.STUFFY,
                "drafty": ComfortIntent.DRAFTY,
                "glare": ComfortIntent.UNKNOWN,
                "other": ComfortIntent.UNKNOWN
            }
            
            intent = sensation_map.get(local_res.event.sensation.lower(), ComfortIntent.UNKNOWN)
            zone_id = local_res.event.location or "open_office"
            severity = SeverityLevel.MEDIUM
            if local_res.event.intensity >= 4:
                severity = SeverityLevel.HIGH
            elif local_res.event.intensity <= 2:
                severity = SeverityLevel.LOW

            mapped_event = SemanticComfortEvent(
                event_id=local_res.event.event_id,
                zone_id=zone_id,
                intent=intent,
                suspected_cause=SuspectedCause.UNSPECIFIED,
                severity=severity,
                confidence=local_res.event.confidence,
                duration_minutes=60,
                source="Ollama",
                reasoning=f"Mapped from local backend. Sensation: {local_res.event.sensation}"
            )
            
            return SemanticTranslationResult(
                raw_query=text,
                is_applicable=(local_res.event.domain.lower() == "thermal"),
                response_text="Processed feedback based on local edge AI translation.",
                events=[mapped_event],
                timestamp=timestamp
            )
        else:
            logger.warning(f"LocalTranslator failed: {local_res.error_message}. Falling back.")

    # 2. Fall back to Cloud LLM or Deterministic logic
    key = api_key or os.environ.get("OPENAI_API_KEY") or os.environ.get("GEMINI_API_KEY")

    if not key or not key.strip():
        logger.debug("No LLM API KEY configured. Executing DeterministicFallbackParser.")
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
        raw_response = _call_openai_api(full_prompt, api_key=key.strip(), model_name=model_name, base_url=base_url)
        cleaned_json = clean_json_markdown(raw_response)
        parsed_dict = json.loads(cleaned_json)
        
        # Override timestamp if missing or inconsistent
        if "timestamp" not in parsed_dict or parsed_dict["timestamp"] == 0.0:
            parsed_dict["timestamp"] = timestamp
            
        # Add a default 'source' to events
        if "events" in parsed_dict:
            for ev in parsed_dict["events"]:
                if "source" not in ev:
                    ev["source"] = "LLM"
                    
        # Enforce exact Pydantic schema validation (with extra="forbid")
        result = SemanticTranslationResult.model_validate(parsed_dict)
        return result
    except Exception as exc:
        logger.warning(
            f"LLM translation failed ({type(exc).__name__}: {exc}). "
            "Falling back to DeterministicFallbackParser."
        )
        return DeterministicFallbackParser.parse(text, timestamp=timestamp)
