"""
NLP Translation Engine and Constraint Bridge for Digital Twin HVAC Optimizer.
"""

from src.nlp.schemas import (
    ALLOWED_ZONE_IDS,
    ZONE_ALIAS_MAP,
    ThermalIntent,
    UrgencyLevel,
    ZoneConstraint,
    NLPTranslationResult,
    get_translation_json_schema,
)
from src.nlp.fallback_parser import DeterministicFallbackParser
from src.nlp.translator import translate_complaint
from src.nlp.constraint_bridge import (
    NLPConstraintBridge,
    ActiveConstraintEntry,
    PHYSICAL_MIN_TEMP_C,
    PHYSICAL_MAX_TEMP_C,
    PHYSICAL_MIN_RH_PCT,
    PHYSICAL_MAX_RH_PCT,
    DEFAULT_HALF_LIFE_MINUTES,
    VALID_ZONES,
)

__all__ = [
    "ALLOWED_ZONE_IDS",
    "ZONE_ALIAS_MAP",
    "ThermalIntent",
    "UrgencyLevel",
    "ZoneConstraint",
    "NLPTranslationResult",
    "get_translation_json_schema",
    "DeterministicFallbackParser",
    "translate_complaint",
    "NLPConstraintBridge",
    "ActiveConstraintEntry",
    "PHYSICAL_MIN_TEMP_C",
    "PHYSICAL_MAX_TEMP_C",
    "PHYSICAL_MIN_RH_PCT",
    "PHYSICAL_MAX_RH_PCT",
    "DEFAULT_HALF_LIFE_MINUTES",
    "VALID_ZONES",
]
