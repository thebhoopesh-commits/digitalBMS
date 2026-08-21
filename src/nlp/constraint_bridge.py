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

    def add_translation_result(self, result: SemanticTranslationResult, current_time_minutes: float = 0.0) -> None:
        if not result.is_applicable:
            return
        for ev in result.events:
            self.add_event(ev, current_time_minutes)

    def add_event(self, event: ComfortEvent, current_time_minutes: float) -> None:
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

    def reset(self):
        for z in VALID_ZONES:
            self._zone_prefs[z] = []
            self._cooldown_timestamps[z] = 0.0
        self._satisfied_prefs.clear()
