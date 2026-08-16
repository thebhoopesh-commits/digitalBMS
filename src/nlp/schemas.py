"""
Pydantic Schemas and Interface Contracts for the NLP Translation Engine & Constraint Bridge.
Strict zero-hallucination validation with model_config = ConfigDict(extra="forbid").
"""

from __future__ import annotations

import time
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Canonical building zones for the 4-zone facility
ALLOWED_ZONE_IDS: Set[str] = {
    "lobby",
    "open_office",
    "conference_room",
    "server_room",
}

# Alias mapping for normalizing occupant and LLM zone references to canonical zone identifiers
ZONE_ALIAS_MAP: Dict[str, str] = {
    "lobby": "lobby",
    "entrance": "lobby",
    "foyer": "lobby",
    "reception": "lobby",
    "front_desk": "lobby",
    "front desk": "lobby",
    "waiting_area": "lobby",
    "waiting area": "lobby",
    "main_hall": "lobby",
    "main hall": "lobby",
    "vestibule": "lobby",
    "entryway": "lobby",
    "entry": "lobby",
    "open_office": "open_office",
    "open office": "open_office",
    "office": "open_office",
    "open_plan": "open_office",
    "open plan": "open_office",
    "cubicles": "open_office",
    "desks": "open_office",
    "workstations": "open_office",
    "bullpen": "open_office",
    "open_space": "open_office",
    "open space": "open_office",
    "workspace": "open_office",
    "main_office": "open_office",
    "office_floor": "open_office",
    "conference_room": "conference_room",
    "conference room": "conference_room",
    "conference": "conference_room",
    "conf_room": "conference_room",
    "conf room": "conference_room",
    "meeting_room": "conference_room",
    "meeting room": "conference_room",
    "boardroom": "conference_room",
    "board_room": "conference_room",
    "huddle_room": "conference_room",
    "huddle room": "conference_room",
    "war_room": "conference_room",
    "briefing_room": "conference_room",
    "server_room": "server_room",
    "server room": "server_room",
    "datacenter": "server_room",
    "data_center": "server_room",
    "data center": "server_room",
    "server_rack": "server_room",
    "server rack": "server_room",
    "it_closet": "server_room",
    "it closet": "server_room",
    "switch_room": "server_room",
    "equipment_room": "server_room",
    "servers": "server_room",
}


class ThermalIntent(str, Enum):
    """Primary environmental and thermal discomfort intents."""
    TOO_COLD = "too_cold"
    TOO_WARM = "too_warm"
    TOO_HUMID = "too_humid"
    TOO_DRY = "too_dry"
    STUFFY = "stuffy"
    COMFORTABLE = "comfortable"


class UrgencyLevel(str, Enum):
    """Urgency priority tiers for occupant feedback resolution."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ZoneConstraint(BaseModel):
    """Specific environmental constraint targeting a single building zone."""
    model_config = ConfigDict(
        extra="forbid",
        validate_assignment=True,
        use_enum_values=True,
        str_strip_whitespace=True,
    )

    zone_id: str = Field(
        ...,
        description="Target zone identifier: 'lobby', 'open_office', 'conference_room', or 'server_room'",
    )
    intent: ThermalIntent = Field(
        ...,
        description="Primary environmental discomfort intent",
    )
    temperature_offset_c: float = Field(
        default=0.0,
        description="Desired temperature offset in Celsius (+/-)",
    )
    humidity_offset_pct: float = Field(
        default=0.0,
        description="Desired relative humidity offset percentage (+/-)",
    )
    target_temp_bounds_c: Optional[Tuple[float, float]] = Field(
        default=None,
        description="Hard min/max temperature bounds in Celsius [T_min, T_max]",
    )
    urgency: UrgencyLevel = Field(
        default=UrgencyLevel.MEDIUM,
        description="Urgency priority of request",
    )
    duration_minutes: int = Field(
        default=60,
        ge=1,
        le=1440,
        description="Active constraint duration in minutes before exponential decay",
    )
    confidence: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="Confidence score of translation (0.0 to 1.0)",
    )
    reasoning: str = Field(
        ...,
        min_length=1,
        description="Brief explanation of the extracted parameters",
    )

    @field_validator("zone_id", mode="before")
    @classmethod
    def normalize_and_validate_zone_id(cls, v: Any) -> str:
        if not isinstance(v, str):
            raise ValueError(f"zone_id must be a string, got {type(v).__name__}")
        norm = v.strip().lower().replace("-", "_").replace(" ", "_")
        canonical = ZONE_ALIAS_MAP.get(norm, norm)
        # Also check without underscores if alias had space
        if canonical not in ALLOWED_ZONE_IDS and " " in v:
            canonical = ZONE_ALIAS_MAP.get(v.strip().lower(), canonical)
        if canonical not in ALLOWED_ZONE_IDS:
            raise ValueError(
                f"Invalid zone_id '{v}'. Must be one of {sorted(ALLOWED_ZONE_IDS)}"
            )
        return canonical

    @field_validator("temperature_offset_c")
    @classmethod
    def validate_temp_offset(cls, v: float) -> float:
        if not -5.0 <= v <= 5.0:
            raise ValueError(
                f"temperature_offset_c {v}°C exceeds safe bounds [-5.0, +5.0]°C"
            )
        return round(float(v), 2)

    @field_validator("humidity_offset_pct")
    @classmethod
    def validate_humidity_offset(cls, v: float) -> float:
        if not -30.0 <= v <= 30.0:
            raise ValueError(
                f"humidity_offset_pct {v}% exceeds safe bounds [-30.0, +30.0]%"
            )
        return round(float(v), 2)

    @field_validator("target_temp_bounds_c")
    @classmethod
    def validate_target_temp_bounds(
        cls, v: Optional[Tuple[float, float]]
    ) -> Optional[Tuple[float, float]]:
        if v is None:
            return None
        if len(v) != 2:
            raise ValueError(
                f"target_temp_bounds_c must contain exactly 2 floats (T_min, T_max), got {v}"
            )
        t_min, t_max = float(v[0]), float(v[1])
        if t_min > t_max:
            raise ValueError(
                f"Lower temperature bound {t_min}°C cannot exceed upper bound {t_max}°C"
            )
        if t_min < 15.0 or t_max > 32.0:
            raise ValueError(
                f"Temperature bounds [{t_min}, {t_max}]°C out of safety range [15.0, 32.0]°C"
            )
        return (round(t_min, 2), round(t_max, 2))


class NLPTranslationResult(BaseModel):
    """Complete structured response produced by the NLP translation engine."""
    model_config = ConfigDict(
        extra="forbid",
        validate_assignment=True,
        use_enum_values=True,
        str_strip_whitespace=True,
    )

    raw_query: str = Field(
        ...,
        description="Original occupant natural language complaint or query",
    )
    is_applicable: bool = Field(
        ...,
        description="True if query is a valid environmental/comfort feedback, False otherwise",
    )
    response_text: str = Field(
        default="",
        description="Conversational response generated by the NLP engine",
    )
    constraints: List[ZoneConstraint] = Field(
        default_factory=list,
        description="List of extracted zone constraints",
    )
    timestamp: float = Field(
        default_factory=time.time,
        description="POSIX epoch timestamp (seconds) when translation was generated",
    )

    @model_validator(mode="after")
    def validate_applicability_and_constraints(self) -> NLPTranslationResult:
        if not self.is_applicable:
            # If not applicable, constraints must be empty
            if self.constraints:
                self.constraints = []
        else:
            # If applicable, there must be at least one constraint
            if not self.constraints:
                raise ValueError(
                    "is_applicable is True but constraints list is empty. "
                    "At least one ZoneConstraint is required for applicable feedback."
                )
        return self


def get_translation_json_schema() -> Dict[str, Any]:
    """Returns the OpenAPI / JSON Schema dictionary for NLPTranslationResult."""
    return NLPTranslationResult.model_json_schema()
