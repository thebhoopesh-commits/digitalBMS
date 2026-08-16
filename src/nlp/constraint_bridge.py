"""
Dynamic Constraint Bridge & Temporal Decay Engine.
Manages active occupant constraints across building zones with exponential temporal decay,
conflict resolution, saturation limits, and safe physical setpoint bounds clamping.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from src.nlp.schemas import (
    ALLOWED_ZONE_IDS,
    ZONE_ALIAS_MAP,
    NLPTranslationResult,
    ThermalIntent,
    UrgencyLevel,
    ZoneConstraint,
)

logger = logging.getLogger("hvac.nlp.constraint_bridge")

# Canonical building zones
VALID_ZONES: List[str] = sorted(list(ALLOWED_ZONE_IDS))

# Physical safety limits and operating parameters
PHYSICAL_MIN_TEMP_C: float = 16.0
PHYSICAL_MAX_TEMP_C: float = 28.0
PHYSICAL_MIN_RH_PCT: float = 20.0
PHYSICAL_MAX_RH_PCT: float = 80.0
MAX_TEMP_OFFSET_C: float = 5.0
MAX_HUMIDITY_OFFSET_PCT: float = 30.0
DEFAULT_HALF_LIFE_MINUTES: float = 30.0
EXPIRATION_EPSILON: float = 0.02


class ActiveConstraintEntry:
    """Internal active constraint state wrapper with exponential temporal decay dynamics."""

    def __init__(
        self,
        constraint: ZoneConstraint,
        created_at_minutes: float,
        half_life_minutes: float = DEFAULT_HALF_LIFE_MINUTES,
        constraint_id: Optional[str] = None,
    ):
        self.constraint = constraint
        self.zone_id = constraint.zone_id
        self.intent = constraint.intent
        self.temperature_offset_c = max(
            -MAX_TEMP_OFFSET_C, min(MAX_TEMP_OFFSET_C, constraint.temperature_offset_c)
        )
        self.humidity_offset_pct = max(
            -MAX_HUMIDITY_OFFSET_PCT, min(MAX_HUMIDITY_OFFSET_PCT, constraint.humidity_offset_pct)
        )
        self.target_temp_bounds_c = constraint.target_temp_bounds_c
        self.urgency = constraint.urgency
        self.created_at_minutes = float(created_at_minutes)
        self.active_duration_minutes = float(constraint.duration_minutes)
        self.half_life_minutes = float(half_life_minutes)
        self.confidence = float(constraint.confidence)
        self.reasoning = str(constraint.reasoning)
        self.constraint_id = constraint_id or f"{self.zone_id}_{int(created_at_minutes)}"

    @property
    def t_active_end_minutes(self) -> float:
        """Timestamp marking the end of the full-strength plateau."""
        return self.created_at_minutes + self.active_duration_minutes

    @property
    def decay_lambda(self) -> float:
        """Exponential decay constant derived from half-life duration."""
        if self.half_life_minutes <= 0.0:
            return float("inf")
        return math.log(2.0) / self.half_life_minutes

    @property
    def urgency_weight(self) -> float:
        """Priority weight multiplier for RL reward penalties and ranking."""
        weights = {
            UrgencyLevel.LOW: 1.0,
            UrgencyLevel.MEDIUM: 2.0,
            UrgencyLevel.HIGH: 3.5,
        }
        return weights.get(self.urgency, 2.0)

    def compute_decay_factor(self, current_time_minutes: float) -> float:
        """
        Calculates instantaneous decay factor in [0.0, 1.0].
        Plateau: factor = 1.0 for t <= t_active_end_minutes
        Decay: factor = exp(-lambda * (t - t_active_end_minutes)) for t > t_active_end_minutes
        """
        if current_time_minutes <= self.t_active_end_minutes:
            return 1.0
        elapsed_decay = current_time_minutes - self.t_active_end_minutes
        return math.exp(-self.decay_lambda * elapsed_decay)

    def get_current_temp_offset(self, current_time_minutes: float) -> float:
        """Computes instantaneous decayed temperature offset in Celsius."""
        return self.temperature_offset_c * self.compute_decay_factor(current_time_minutes)

    def get_current_humidity_offset(self, current_time_minutes: float) -> float:
        """Computes instantaneous decayed humidity offset in percentage."""
        return self.humidity_offset_pct * self.compute_decay_factor(current_time_minutes)

    def is_expired(self, current_time_minutes: float, epsilon: float = EXPIRATION_EPSILON) -> bool:
        """Returns True if the constraint has decayed below the epsilon threshold."""
        if current_time_minutes <= self.t_active_end_minutes:
            return False
        return self.compute_decay_factor(current_time_minutes) < epsilon

    def to_dict(self, current_time_minutes: float) -> Dict[str, Any]:
        """Serializes active constraint state for REST API and telemetry streaming."""
        decay_factor = self.compute_decay_factor(current_time_minutes)
        time_remaining = max(0.0, self.t_active_end_minutes - current_time_minutes)
        return {
            "constraint_id": self.constraint_id,
            "zone_id": self.zone_id,
            "intent": self.intent.value if hasattr(self.intent, "value") else str(self.intent),
            "initial_temp_offset_c": self.temperature_offset_c,
            "current_temp_offset_c": round(self.get_current_temp_offset(current_time_minutes), 3),
            "initial_humidity_offset_pct": self.humidity_offset_pct,
            "current_humidity_offset_pct": round(self.get_current_humidity_offset(current_time_minutes), 3),
            "urgency": self.urgency.value if hasattr(self.urgency, "value") else str(self.urgency),
            "decay_factor": round(decay_factor, 4),
            "time_remaining_minutes": round(time_remaining, 1),
            "confidence": self.confidence,
            "reasoning": self.reasoning,
        }


class NLPConstraintBridge:
    """
    Central Constraint Bridge managing dynamic active occupant constraints across all zones.
    """

    def __init__(self, default_half_life_minutes: float = DEFAULT_HALF_LIFE_MINUTES):
        self.default_half_life_minutes = float(default_half_life_minutes)
        self._zone_constraints: Dict[str, List[ActiveConstraintEntry]] = {
            zone: [] for zone in VALID_ZONES
        }
        self._constraint_counter = 0

    def add_constraint(
        self,
        constraint: ZoneConstraint,
        current_time_minutes: float = 0.0,
        half_life_minutes: Optional[float] = None,
    ) -> List[str]:
        """
        Adds a parsed ZoneConstraint to target zone queue(s).
        Handles global broadcast by fanning out to all valid building zones.
        """
        hl = half_life_minutes or self.default_half_life_minutes
        raw_zid = str(constraint.zone_id).strip().lower()
        
        # Check for global broadcast
        if raw_zid in ["all", "all_zones", "building", "everywhere", "whole_building"]:
            target_zones = VALID_ZONES
        else:
            canonical = ZONE_ALIAS_MAP.get(raw_zid, raw_zid)
            target_zones = [canonical] if canonical in VALID_ZONES else [VALID_ZONES[0]]

        added_ids = []
        for zone in target_zones:
            if zone not in self._zone_constraints:
                self._zone_constraints[zone] = []

            self._constraint_counter += 1
            cid = f"cnstr_{zone}_{self._constraint_counter}"

            # Clone constraint with canonical zone_id
            resolved_constraint = constraint.model_copy(update={"zone_id": zone})
            entry = ActiveConstraintEntry(
                constraint=resolved_constraint,
                created_at_minutes=current_time_minutes,
                half_life_minutes=hl,
                constraint_id=cid,
            )

            self._reconcile_and_insert(zone, entry, current_time_minutes)
            added_ids.append(cid)
            logger.info(
                f"Injected constraint {cid} into {zone}: offset={entry.temperature_offset_c}°C, "
                f"urgency={entry.urgency}"
            )

        return added_ids

    def add_translation_result(
        self,
        result: NLPTranslationResult,
        current_time_minutes: float = 0.0,
    ) -> List[str]:
        """Ingests all constraints from an NLPTranslationResult."""
        if not result.is_applicable or not result.constraints:
            return []

        all_added = []
        for constraint in result.constraints:
            added = self.add_constraint(constraint, current_time_minutes)
            all_added.extend(added)
        return all_added

    def _reconcile_and_insert(
        self,
        zone: str,
        new_entry: ActiveConstraintEntry,
        current_time_minutes: float,
    ) -> None:
        """Applies conflict resolution and saturation stacking policies."""
        existing = self._zone_constraints[zone]

        # Check for contradictory complaints (opposite sign on temperature offset)
        contradictory = []
        for item in existing:
            if not item.is_expired(current_time_minutes):
                if (item.temperature_offset_c * new_entry.temperature_offset_c) < -0.01:
                    contradictory.append(item)

        if contradictory:
            # Newer complaint supersedes older contradictory complaints
            for old in contradictory:
                if old in existing:
                    existing.remove(old)
                    logger.info(f"Purged contradictory constraint {old.constraint_id} in {zone}")

        # Limit stacking queue to at most 3 active constraints per zone
        while len(existing) >= 3:
            existing.pop(0)

        existing.append(new_entry)

    def get_active_offsets(self, current_time_minutes: float = 0.0) -> Dict[str, Dict[str, float]]:
        """
        Computes active decayed temperature and humidity offsets and urgency weights per zone.
        """
        self.clean_expired_constraints(current_time_minutes)
        offsets: Dict[str, Dict[str, float]] = {}

        for zone in VALID_ZONES:
            entries = self._zone_constraints.get(zone, [])
            if not entries:
                offsets[zone] = {
                    "temp_offset_c": 0.0,
                    "humidity_offset_pct": 0.0,
                    "urgency_weight": 0.0,
                    "active_count": 0.0,
                }
                continue

            # Aggregate offsets across active entries with saturation clamping
            total_temp = sum(e.get_current_temp_offset(current_time_minutes) for e in entries)
            total_humidity = sum(e.get_current_humidity_offset(current_time_minutes) for e in entries)
            max_urgency_w = max(e.urgency_weight for e in entries)

            # Saturated clamping to safety envelopes
            clamped_temp = max(-MAX_TEMP_OFFSET_C, min(MAX_TEMP_OFFSET_C, total_temp))
            clamped_rh = max(-MAX_HUMIDITY_OFFSET_PCT, min(MAX_HUMIDITY_OFFSET_PCT, total_humidity))

            offsets[zone] = {
                "temp_offset_c": round(clamped_temp, 3),
                "humidity_offset_pct": round(clamped_rh, 3),
                "urgency_weight": max_urgency_w,
                "active_count": float(len(entries)),
            }

        return offsets

    def get_zone_setpoint_bounds(
        self,
        zone_id: str,
        default_bounds: Tuple[float, float],
        current_time_minutes: float = 0.0,
    ) -> Tuple[float, float]:
        """
        Computes dynamic [T_min, T_max] setpoint bounds for a zone,
        strictly clamped to safe physical limits [16.0°C, 28.0°C].
        """
        canonical_zone = ZONE_ALIAS_MAP.get(zone_id.lower().replace("-", "_"), zone_id)
        offsets = self.get_active_offsets(current_time_minutes)
        zone_info = offsets.get(canonical_zone, {"temp_offset_c": 0.0})
        delta_t = zone_info["temp_offset_c"]

        t_min_base, t_max_base = default_bounds

        # Check if active constraint has explicit target_temp_bounds_c
        active_entries = self._zone_constraints.get(canonical_zone, [])
        target_bounds_entry = next(
            (e for e in reversed(active_entries) if e.target_temp_bounds_c and not e.is_expired(current_time_minutes)),
            None
        )

        if target_bounds_entry and target_bounds_entry.target_temp_bounds_c:
            u_low, u_high = target_bounds_entry.target_temp_bounds_c
            decay_factor = target_bounds_entry.compute_decay_factor(current_time_minutes)
            t_min_eff = decay_factor * u_low + (1.0 - decay_factor) * (t_min_base + delta_t)
            t_max_eff = decay_factor * u_high + (1.0 - decay_factor) * (t_max_base + delta_t)
        else:
            t_min_eff = t_min_base + delta_t
            t_max_eff = t_max_base + delta_t

        # Strict physical envelope clamping
        t_min_clamped = max(PHYSICAL_MIN_TEMP_C, min(PHYSICAL_MAX_TEMP_C, t_min_eff))
        t_max_clamped = max(PHYSICAL_MIN_TEMP_C, min(PHYSICAL_MAX_TEMP_C, t_max_eff))

        # Enforce non-crossing bounds with minimum deadband
        if t_min_clamped > t_max_clamped:
            midpoint = (t_min_clamped + t_max_clamped) / 2.0
            t_min_clamped = max(PHYSICAL_MIN_TEMP_C, midpoint - 0.25)
            t_max_clamped = min(PHYSICAL_MAX_TEMP_C, midpoint + 0.25)

        return (round(t_min_clamped, 2), round(t_max_clamped, 2))

    def get_active_constraints_summary(self, current_time_minutes: float = 0.0) -> List[Dict[str, Any]]:
        """Returns JSON-serializable list of all active constraints for UI and telemetry streaming."""
        summary = []
        for zone in VALID_ZONES:
            for e in self._zone_constraints.get(zone, []):
                if not e.is_expired(current_time_minutes):
                    summary.append(e.to_dict(current_time_minutes))
        return summary

    def clean_expired_constraints(self, current_time_minutes: float = 0.0) -> int:
        """Evicts expired constraints and returns total removed count."""
        removed_count = 0
        for zone in VALID_ZONES:
            active = []
            for e in self._zone_constraints.get(zone, []):
                if e.is_expired(current_time_minutes):
                    removed_count += 1
                else:
                    active.append(e)
            self._zone_constraints[zone] = active
        return removed_count

    def reset(self) -> None:
        """Clears all active constraint queues across all zones."""
        for zone in VALID_ZONES:
            self._zone_constraints[zone] = []
        self._constraint_counter = 0
