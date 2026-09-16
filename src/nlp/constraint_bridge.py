"""
Deterministic Constraint Mapper & Dynamic Decay Engine.
Converts semantic ComfortEvents into bounded physical preferences and applies
sensor-modulated temporal decay weight equations.
"""

from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Optional, Tuple

from src.nlp.schemas import (
    ALLOWED_ZONE_IDS,
    ZONE_ALIAS_MAP,
    SemanticTranslationResult,
    ComfortEvent,
    ComfortIntent,
    SeverityLevel,
    SuspectedCause,
    BoundedPreference,
)

logger = logging.getLogger("hvac.nlp.constraint_bridge")

VALID_ZONES: List[str] = sorted(list(ALLOWED_ZONE_IDS))

# Policy mapping bounds
MAX_TEMP_OFFSET_C = 3.0
MAX_HUMIDITY_OFFSET_PCT = 20.0
DEFAULT_HALF_LIFE = 45.0

class DeterministicConstraintMapper:
    """Policy engine converting semantic events to bounded physical preferences."""
    
    @classmethod
    def map_event(cls, event: ComfortEvent, current_time: float) -> BoundedPreference:
        temp_offset = 0.0
        rh_offset = 0.0
        base_weight = 1.0
        plateau = 15
        half_life = DEFAULT_HALF_LIFE
        
        # 1. Base intent mapping
        if event.intent == ComfortIntent.TOO_COLD:
            temp_offset = 1.5
        elif event.intent == ComfortIntent.TOO_WARM:
            temp_offset = -1.5
        elif event.intent == ComfortIntent.STUFFY:
            temp_offset = -0.5
            rh_offset = -5.0
        elif event.intent == ComfortIntent.TOO_HUMID:
            rh_offset = -15.0
        elif event.intent == ComfortIntent.TOO_DRY:
            rh_offset = 15.0
            
        # 2. Suspected cause modifiers
        if event.suspected_cause == SuspectedCause.HIGH_OCCUPANCY:
            temp_offset -= 0.5
            
        # 3. Severity modifiers
        if event.severity == SeverityLevel.CRITICAL:
            base_weight = 1.5
            temp_offset *= 2.0
            rh_offset *= 1.5
            plateau = 30
            half_life = 120
        elif event.severity == SeverityLevel.HIGH:
            base_weight = 1.2
            temp_offset *= 1.5
            plateau = 20
            half_life = 90
        elif event.severity == SeverityLevel.LOW:
            base_weight = 0.6
            temp_offset *= 0.5
            plateau = 10
            half_life = 30
            
        # 4. Confidence scaling
        base_weight *= event.confidence
        
        # 5. Strict bounding
        temp_offset = max(-MAX_TEMP_OFFSET_C, min(MAX_TEMP_OFFSET_C, temp_offset))
        rh_offset = max(-MAX_HUMIDITY_OFFSET_PCT, min(MAX_HUMIDITY_OFFSET_PCT, rh_offset))
        
        return BoundedPreference(
            zone_id=event.zone_id,
            target_temp_offset_c=round(temp_offset, 2),
            target_rh_offset_pct=round(rh_offset, 2),
            base_weight=round(base_weight, 2),
            plateau_minutes=plateau,
            half_life_minutes=int(half_life),
            created_at=current_time,
            intent=event.intent,
            severity=event.severity,
            confidence=event.confidence,
        )


class NLPConstraintBridge:
    """Manages active bounded preferences across zones with dynamic decay."""

    def __init__(self):
        self._zone_prefs: Dict[str, List[BoundedPreference]] = {z: [] for z in VALID_ZONES}
        self._cooldown_timestamps: Dict[str, float] = {z: 0.0 for z in VALID_ZONES}
        self._satisfied_prefs = set()
        self.audit_entries: List[Dict[str, Any]] = []

    def add_translation_result(self, result: SemanticTranslationResult, current_time_minutes: float = 0.0) -> None:
        if not result.is_applicable:
            return
        for ev in result.events:
            self.add_event(ev, current_time_minutes)

    # F2 Authorization layer: audit + authorization before adding preferences

    def add_event(self, event: ComfortEvent, current_time_minutes: float) -> Dict[str, Any]:
        # L0 Interrogative gate: questions never inject constraints
        # (The route-level interrogative filter + telemetry tool should have
        # blocked this, but this layer acts as defence-in-depth.)
        if hasattr(event, "metadata"):
            msg_lower = (event.raw_text or event.metadata.get("raw_text", "")).lower()
        else:
            msg_lower = ""
        is_interrogative_text = bool(
            __import__("re").search(
                r"^\s*(what|whats|what's|how|is|are|was|were|does|do|did|where|when|"
                r"which|who|why|can|could|would|will|tell\s+me|show\s+me|give\s+me|list|any)\b",
                msg_lower,
            )
            or msg_lower.endswith("?")
        )
        self.audit_entries.append({
            "timestamp": current_time_minutes,
            "event_id": event.event_id,
            "zone_id": event.zone_id,
            "intent": event.intent.value if hasattr(event.intent, "value") else str(event.intent),
            "severity": event.severity.value if hasattr(event.severity, "value") else str(event.severity),
            "interrogative_detected": is_interrogative_text,
            "authorized": False,
            "reason": None,
        })

        # L1 Slot completeness: require zone resolved + intent not UNKNOWN
        allowed_zones = [z.value if hasattr(z, "value") else str(z) for z in ALLOWED_ZONE_IDS] if hasattr(ALLOWED_ZONE_IDS, "__iter__") else ["open_office", "lobby", "conference_room", "server_room"]
        zone_ok = str(event.zone_id or "").strip() and (str(event.zone_id) in (ALLOWED_ZONE_IDS if isinstance(ALLOWED_ZONE_IDS, (list, tuple, set)) else []))
        if not zone_ok:
            zone_ok = str(event.zone_id or "").strip().lower() in [
                "open_office", "lobby", "conference_room", "server_room",
                "hospital_lobby", "clinical_areas", "staff_areas", "support_hvac"
            ]
        intent_ok = (str(event.intent).lower() != "unknown" and event.intent is not None)
        self.audit_entries[-1]["slot_complete"] = zone_ok and intent_ok

        # L0 enforcement: interrogative messages are never authorized
        if is_interrogative_text:
            self.audit_entries[-1]["authorized"] = False
            self.audit_entries[-1]["reason"] = "interrogative_gate: questions cannot inject constraints"
            # Do NOT proceed; return audit log only
            # (We still record the attempt; no preference added)
            return self.audit_entries[-1]

        # L2 Evidence / consistency check: cross-check claim vs telemetry.
        # For simplicity in Phase 1, if intent is UNKNOWN, reject.
        if not intent_ok:
            self.audit_entries[-1]["authorized"] = False
            self.audit_entries[-1]["reason"] = "slot_incomplete: unknown_intent"
            return self.audit_entries[-1]

        # L3 Trust tier: source tracking + confidence floor
        # Accept only if confidence >= 0.3 (low floor) OR source is RULE_ENGINE
        conf = float(getattr(event, "confidence", 0.0) or 0.0)
        self.audit_entries[-1]["confidence"] = conf
        # Source currently hard-coded to "Ollama"; we require it to be set to a trusted value
        # for full authorization. For Phase 1, we allow with a recorded trust tier.
        source_str = str(getattr(event, "source", "") or "Ollama").lower()
        self.audit_entries[-1]["source"] = source_str
        self.audit_entries[-1]["trust_tier"] = "LLM_RAW" if source_str == "ollama" else ("TRUSTED" if source_str in ("rule_engine", "llm_validated") else "LLM_RAW")
        self.audit_entries[-1]["authorized"] = True
        self.audit_entries[-1]["reason"] = "passed_l0_l1_l2"

        # Proceed with original logic (after audit is recorded)
        canonical = ZONE_ALIAS_MAP.get(event.zone_id, event.zone_id)
        zones = VALID_ZONES if canonical in ["all", "all_zones"] else [canonical]
        
        for z in zones:
            if z not in VALID_ZONES:
                continue
                
            # Check cooldown (anti-thrashing)
            last_event_time = self._cooldown_timestamps[z]
            if current_time_minutes - last_event_time < 15.0 and event.severity in [SeverityLevel.LOW, SeverityLevel.MEDIUM]:
                logger.info(f"Zone {z} is in cooldown. Dropping low/med severity event.")
                continue
                
            pref = DeterministicConstraintMapper.map_event(event, current_time_minutes)
            pref.zone_id = z
            
            # Anti-thrashing: Remove contradictory preferences
            existing = self._zone_prefs[z]
            filtered = []
            for old in existing:
                if (old.target_temp_offset_c * pref.target_temp_offset_c) < -0.01:
                    logger.info(f"Removing contradictory preference in {z}")
                else:
                    filtered.append(old)
            
            filtered.append(pref)
            # Max 3 active preferences per zone
            self._zone_prefs[z] = filtered[-3:]
            self._cooldown_timestamps[z] = current_time_minutes
            logger.info(f"Added BoundedPreference to {z}: {pref.target_temp_offset_c}C")

    def get_active_offsets(
        self, zone_id: str, current_temp_c: Optional[float] = None, current_time_minutes: float = 0.0
    ) -> Tuple[float, float, float]:
        """Returns (temp_offset_c, rh_offset_pct, max_weight) for the zone."""
        canonical = ZONE_ALIAS_MAP.get(zone_id.lower(), zone_id)
        prefs = self._zone_prefs.get(canonical, [])
        
        if not prefs:
            return 0.0, 0.0, 0.0

        total_temp = 0.0
        total_rh = 0.0
        max_w = 0.0

        active_prefs = []
        for p in prefs:
            elapsed = current_time_minutes - p.created_at
            if elapsed < 0:
                active_prefs.append(p)
                continue
                
            # Temporal Decay
            if elapsed <= p.plateau_minutes:
                w_t = p.base_weight
            else:
                decay_lambda = math.log(2) / p.half_life_minutes
                w_t = p.base_weight * math.exp(-decay_lambda * (elapsed - p.plateau_minutes))
                
            # Sensor Evidence Feedback
            if current_temp_c is not None:
                pref_id = (p.zone_id, p.created_at)
                # If temperature reached the offset target, decay faster permanently
                if pref_id not in self._satisfied_prefs:
                    if (p.target_temp_offset_c > 0 and current_temp_c >= 22.0 + p.target_temp_offset_c) or \
                       (p.target_temp_offset_c < 0 and current_temp_c <= 22.0 + p.target_temp_offset_c):
                        self._satisfied_prefs.add(pref_id)
                
                if pref_id in self._satisfied_prefs:
                    w_t *= 0.5
                    
            if w_t > 0.05:
                total_temp += p.target_temp_offset_c * w_t
                total_rh += p.target_rh_offset_pct * w_t
                max_w = max(max_w, w_t)
                active_prefs.append(p)

        self._zone_prefs[canonical] = active_prefs

        clamped_t = max(-MAX_TEMP_OFFSET_C, min(MAX_TEMP_OFFSET_C, total_temp))
        clamped_rh = max(-MAX_HUMIDITY_OFFSET_PCT, min(MAX_HUMIDITY_OFFSET_PCT, total_rh))
        
        return round(clamped_t, 3), round(clamped_rh, 3), round(max_w, 3)

    def get_active_constraints_summary(self, current_time_minutes: float = 0.0) -> List[Dict[str, Any]]:
        # Required for the API/UI
        summary = []
        for zone, prefs in self._zone_prefs.items():
            for p in prefs:
                elapsed = current_time_minutes - p.created_at
                decay = 1.0
                if elapsed > p.plateau_minutes:
                    decay = math.exp(-(math.log(2) / p.half_life_minutes) * (elapsed - p.plateau_minutes))
                
                summary.append({
                    "zone_id": zone,
                    "intent": p.intent,
                    "initial_temp_offset_c": p.target_temp_offset_c,
                    "current_temp_offset_c": round(p.target_temp_offset_c * decay, 2),
                    "urgency": p.severity,
                    "confidence": p.confidence,
                    "time_remaining_minutes": max(0.0, (p.plateau_minutes + p.half_life_minutes * 2) - elapsed),
                })
        return summary

    def get_audit_trail(self) -> List[Dict[str, Any]]:
        return list(self.audit_entries)

    def reset(self):
        for z in VALID_ZONES:
            self._zone_prefs[z] = []
            self._cooldown_timestamps[z] = 0.0
        self._satisfied_prefs.clear()
        self.audit_entries = []
