"""
Local Natural Language Translation Pipeline.
Leverages local Ollama (qwen3:1.7b) on Raspberry Pi with automatic zero-friction fallback
to the local deterministic rule-based parser. Zero cloud dependency.
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
        ollama_model = os.environ.get("OLLAMA_MODEL", "qwen3:1.7b")
        ollama_timeout = float(os.environ.get("OLLAMA_TIMEOUT_SECONDS", "180.0"))
        
        local_t = LocalTranslator(
            backend_type="ollama", 
            ollama_url=ollama_url, 
            model_name=ollama_model,
            timeout=ollama_timeout
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
                "other": ComfortIntent.UNKNOWN,
                "too_hot": ComfortIntent.TOO_WARM,
                "hot": ComfortIntent.TOO_WARM,
                "warm": ComfortIntent.TOO_WARM,
                "boiling": ComfortIntent.TOO_WARM,
                "overheating": ComfortIntent.TOO_WARM,
                "cold": ComfortIntent.TOO_COLD,
                "freezing": ComfortIntent.TOO_COLD,
                "chilly": ComfortIntent.TOO_COLD,
                "humid": ComfortIntent.TOO_HUMID,
                "dry": ComfortIntent.TOO_DRY,
                "comfortable": ComfortIntent.COMFORTABLE,
            }
            
            clean_sensation = str(local_res.event.sensation or "").strip().lower()
            intent = sensation_map.get(clean_sensation, ComfortIntent.UNKNOWN)
            if intent == ComfortIntent.UNKNOWN and clean_sensation:
                if any(sub in clean_sensation for sub in ("hot", "warm", "boil", "overheat")):
                    intent = ComfortIntent.TOO_WARM
                elif any(sub in clean_sensation for sub in ("cold", "freez", "chill")):
                    intent = ComfortIntent.TOO_COLD
                elif any(sub in clean_sensation for sub in ("humid", "sticky", "muggy")):
                    intent = ComfortIntent.TOO_HUMID
                elif any(sub in clean_sensation for sub in ("dry", "arid")):
                    intent = ComfortIntent.TOO_DRY
                elif any(sub in clean_sensation for sub in ("stuffy", "stuff", "stale")):
                    intent = ComfortIntent.STUFFY
                elif any(sub in clean_sensation for sub in ("draft", "breez")):
                    intent = ComfortIntent.DRAFTY
                elif "comfort" in clean_sensation and "uncomfort" not in clean_sensation and "discomfort" not in clean_sensation:
                    intent = ComfortIntent.COMFORTABLE
            
            raw_zone = local_res.event.location or "open_office"
            from src.nlp.schemas import ALLOWED_ZONE_IDS, ZONE_ALIAS_MAP
            zone_id = "open_office"
            norm_zone = str(raw_zone).strip().lower().replace("-", "_").replace(" ", "_")
            canonical_zone = ZONE_ALIAS_MAP.get(norm_zone, norm_zone)
            if canonical_zone in ALLOWED_ZONE_IDS:
                zone_id = canonical_zone

            severity = SeverityLevel.MEDIUM
            if local_res.event.intensity >= 4:
                severity = SeverityLevel.HIGH
            elif local_res.event.intensity <= 2:
                severity = SeverityLevel.LOW

            try:
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
            except Exception as e:
                logger.error(f"SemanticComfortEvent mapping validation failed: {e}")
                return DeterministicFallbackParser.parse(text, timestamp=timestamp)
            
            friendly_response = "I have updated the system with your feedback."
            if intent == ComfortIntent.TOO_COLD:
                friendly_response = f"Got it. I'm increasing the heating in the {zone_id.replace('_', ' ')}."
            elif intent == ComfortIntent.TOO_WARM:
                friendly_response = f"Noted. I'm increasing the cooling in the {zone_id.replace('_', ' ')}."
            elif intent == ComfortIntent.TOO_HUMID or intent == ComfortIntent.STUFFY:
                friendly_response = f"Understood. I'm increasing ventilation in the {zone_id.replace('_', ' ')}."
            elif intent == ComfortIntent.DRAFTY:
                friendly_response = f"I'll adjust the airflow in the {zone_id.replace('_', ' ')} to reduce drafts."

            return SemanticTranslationResult(
                raw_query=text,
                is_applicable=(local_res.event.domain.lower() == "thermal"),
                response_text=friendly_response,
                events=[mapped_event],
                timestamp=timestamp
            )
        else:
            logger.warning(
                f"LocalTranslator failed: {local_res.error_message}. "
                "Executing local DeterministicFallbackParser (cloud inference is strictly disabled)."
            )
            return DeterministicFallbackParser.parse(text, timestamp=timestamp)

    # 2. If OLLAMA_URL is not set, use local DeterministicFallbackParser directly
    logger.info("OLLAMA_URL not configured. Executing local DeterministicFallbackParser (cloud inference is strictly disabled).")
    return DeterministicFallbackParser.parse(text, timestamp=timestamp)
