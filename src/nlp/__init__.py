"""
NLP Translation Engine and Constraint Bridge for Digital Twin HVAC Optimizer.
"""

from src.nlp.schemas import (
    ALLOWED_ZONE_IDS,
    ZONE_ALIAS_MAP,
    ComfortIntent,
    SeverityLevel,
    SuspectedCause,
    ComfortEvent,
    SemanticTranslationResult,
    BoundedPreference,
    get_translation_json_schema,
)
from src.nlp.fallback_parser import DeterministicFallbackParser
from src.nlp.translator import translate_complaint
from src.nlp.constraint_bridge import (
    NLPConstraintBridge,
    DeterministicConstraintMapper,
    VALID_ZONES,
)

__all__ = [
    "ALLOWED_ZONE_IDS",
    "ZONE_ALIAS_MAP",
    "ComfortIntent",
    "SeverityLevel",
    "SuspectedCause",
    "ComfortEvent",
    "SemanticTranslationResult",
    "BoundedPreference",
    "get_translation_json_schema",
    "DeterministicFallbackParser",
    "translate_complaint",
    "NLPConstraintBridge",
    "DeterministicConstraintMapper",
    "VALID_ZONES",
]
