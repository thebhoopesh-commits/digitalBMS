"""
Pydantic Schemas and Interface Contracts for the NLP Translation Engine & Constraint Bridge.
Strict zero-hallucination validation with model_config = ConfigDict(extra="forbid").
"""

from __future__ import annotations

import time
import uuid
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


class ComfortIntent(str, Enum):
    """Primary environmental and thermal discomfort intents."""
    TOO_COLD = "too_cold"
    TOO_WARM = "too_warm"
    TOO_HUMID = "too_humid"
    TOO_DRY = "too_dry"
    STUFFY = "stuffy"
    DRAFTY = "drafty"
    COMFORTABLE = "comfortable"
    UNKNOWN = "unknown"


class SeverityLevel(str, Enum):
    """Severity tiers for occupant feedback."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class SuspectedCause(str, Enum):
    """Suspected physical causes of the discomfort."""
    DRAFT = "draft"
    SOLAR_GAIN = "solar_gain"
    HIGH_OCCUPANCY = "high_occupancy"
    EQUIPMENT_HEAT = "equipment_heat"
    HVAC_INACTIVE = "hvac_inactive"
    WEATHER_EXTREME = "weather_extreme"
    UNSPECIFIED = "unspecified"


class ComfortEvent(BaseModel):
    """Pure semantic extraction of an occupant's comfort feedback."""
    model_config = ConfigDict(
        extra="forbid",
        validate_assignment=True,
        use_enum_values=True,
        str_strip_whitespace=True,
    )

    event_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique identifier for the event",
    )
    zone_id: str = Field(
        ...,
        description="Target zone identifier",
    )
    intent: ComfortIntent = Field(
        ...,
        description="Primary environmental discomfort intent",
    )
    suspected_cause: Optional[SuspectedCause] = Field(
        default=SuspectedCause.UNSPECIFIED,
        description="Optional suspected cause extracted from the query",
    )
    severity: SeverityLevel = Field(
        default=SeverityLevel.MEDIUM,
        description="Severity or urgency priority of the request",
    )
    confidence: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="Confidence score of translation (0.0 to 1.0)",
    )
    duration_minutes: int = Field(
        default=60,
        ge=1,
        le=1440,
        description="Active constraint duration in minutes before exponential decay",
    )
    source: str = Field(
        default="LLM",
        description="Source of this event ('LLM', 'REGEX_FALLBACK', etc.)",
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


class SemanticTranslationResult(BaseModel):
    """Complete semantic response produced by the NLP translation engine."""
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
    events: List[ComfortEvent] = Field(
        default_factory=list,
        description="List of extracted semantic comfort events",
    )
    timestamp: float = Field(
        default_factory=time.time,
        description="POSIX epoch timestamp (seconds) when translation was generated",
    )

    @model_validator(mode="after")
    def validate_applicability_and_events(self) -> SemanticTranslationResult:
        if not self.is_applicable:
            if self.events:
                self.events = []
        else:
            if not self.events:
                raise ValueError(
                    "is_applicable is True but events list is empty. "
                    "At least one ComfortEvent is required for applicable feedback."
                )
        return self


class BoundedPreference(BaseModel):
    """Bounded physical preference translated deterministically from a ComfortEvent."""
    model_config = ConfigDict(extra="forbid")
    
    zone_id: str
    target_temp_offset_c: float
    target_rh_offset_pct: float
    base_weight: float
    plateau_minutes: int
    half_life_minutes: int
    created_at: float
    intent: str
    severity: str
    confidence: float


def get_translation_json_schema() -> Dict[str, Any]:
    """Returns the OpenAPI / JSON Schema dictionary for SemanticTranslationResult."""
    return SemanticTranslationResult.model_json_schema()
