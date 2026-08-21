"""
Deterministic Semantic Fallback Parser for Natural Language Occupant Comfort Feedback.
Zero external runtime dependencies beyond Python standard library and Pydantic schemas.
Guarantees 100% valid Pydantic instances with extra="forbid" and zero hallucinated keys.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional, Set, Tuple

from src.nlp.schemas import (
    ALLOWED_ZONE_IDS,
    SemanticTranslationResult,
    ComfortIntent,
    SeverityLevel,
    ComfortEvent,
    SuspectedCause,
)

# Canonical Zone Mapping with comprehensive synonym lexicons
ZONE_ALIASES: Dict[str, List[str]] = {
    "lobby": [
        "lobby",
        "reception",
        "entrance",
        "foyer",
        "front desk",
        "waiting area",
        "main hall",
        "vestibule",
        "entryway",
        "entry",
    ],
    "open_office": [
        "open office",
        "open plan",
        "office floor",
        "main office",
        "workstations",
        "workstation",
        "workplace",
        "cubicles",
        "cubicle",
        "open space",
        "workspace",
        "bullpen",
        "desks",
        "desk",
        "office",
        "floor",
    ],
    "conference_room": [
        "conference room",
        "meeting space",
        "briefing room",
        "meeting room",
        "huddle room",
        "board room",
        "boardroom",
        "conf room",
        "war room",
        "conference",
        "conf",
    ],
    "server_room": [
        "server room",
        "data center",
        "datacenter",
        "server rack",
        "switch room",
        "comms room",
        "equipment room",
        "it closet",
        "it room",
        "servers",
        "server",
        "mdf",
        "idf",
    ],
}

GLOBAL_ZONE_PATTERNS: List[str] = [
    r"\b(all zones|all rooms|whole building|entire building|entire office building|everywhere|all over the building|across the building|the whole floor|entire office)\b"
]

# Operational Inversion Grammar Patterns
INVERSION_COOLING_DOWN = [
    r"\b(turn down (the )?ac|turn down (the )?air conditioning|lower (the )?ac|reduce (the )?ac|less ac|lesser ac|reduce (the )?cooling|less cooling|decrease (the )?cooling|ease up on (the )?ac|ac (?:is )?(?:a little )?lesser|ac .* lesser|ac .* lower|ac .* down)\b"
]

INVERSION_COOLING_UP = [
    r"\b(turn up (the )?ac|turn up (the )?air conditioning|crank (the )?ac|crank up (the )?ac|more ac|boost (the )?ac|max cooling|more cooling|increase (the )?cooling|increase (the )?ac|turn on (the )?ac|blast (the )?ac|ac .* higher|ac .* up|ac .* more)\b"
]

INVERSION_HEATING_UP = [
    r"\b(turn up (the )?heat|increase (the )?heat|more heat|crank (the )?heat|raise (the )?heat|turn on (the )?heat|boost (the )?heat|need (more )?heat|heat .* higher|heat .* up|heat .* more)\b"
]

INVERSION_HEATING_DOWN = [
    r"\b(turn down (the )?heat|lower (the )?heat|reduce (the )?heat|less heat|decrease (the )?heat|ease off (the )?heat|heat .* lower|heat .* down|heat .* lesser)\b"
]

INTENT_PATTERNS: Dict[ComfortIntent, List[str]] = {
    ComfortIntent.TOO_COLD: [
        r"\b(freezing|freeze|froze|iceberg|arctic|frosty|frigid|icicle|polar|shiver|shivering|teeth chattering|ice box)\b",
        r"\b(cold|chilly|numb|frostbite|too cold|way too cold|much too cold|bit chilly)\b",
        r"\b(warmer|make it warmer|need warmth|raise (the )?(?:temp|temperature)|increase (the )?(?:temp|temperature)|temp(?:erature)? too low|turn up (the )?(?:temp|temperature)|higher (?:temp|temperature)|up (the )?(?:temp|temperature))\b",
    ],
    ComfortIntent.TOO_WARM: [
        r"\b(boiling|sweltering|roasting|furnace|sweating|sweat box|baking|burning up|burning|spiking|heat wave|sauna)\b",
        r"\b(hot|warm|overheating|overheated|heat|too hot|way too hot|much too hot|extremely hot)\b",
        r"\b(cooler|make it cooler|need cooling|lower (the )?(?:temp|temperature)|decrease (the )?(?:temp|temperature)|reduce (the )?(?:temp|temperature)|drop (the )?(?:temp|temperature)|temp(?:erature)? too high|turn down (the )?(?:temp|temperature)|down (the )?(?:temp|temperature)|less (?:temp|temperature))\b",
    ],
    ComfortIntent.TOO_HUMID: [
        r"\b(humid|humidity|sticky|muggy|clammy|damp|moist|sweaty air|tropical|swamp|thick air)\b",
        r"\b(too humid|way too humid|high humidity|dehumidif|dehumidify)\b",
    ],
    ComfortIntent.TOO_DRY: [
        r"\b(dry|arid|parched|dehydrated|scratchy throat|static shock|dry eyes|no humidity|too dry|low humidity|humidify|humidification)\b"
    ],
    ComfortIntent.STUFFY: [
        r"\b(stuffy|stale|suffocating|can barely breathe|barely breathe|hard to breathe|lack of air|unventilated|airless|oppressive|poor ventilation|no airflow|ventilation|stale air)\b"
    ],
    ComfortIntent.DRAFTY: [
        r"\b(drafty|draft|breeze|breezy|air blowing|wind)\b"
    ],
    ComfortIntent.COMFORTABLE: [
        r"\b(comfortable|perfect|just right|fine|great|pleasant|feels good|good temperature|optimal temp)\b"
    ],
}

SEVERITY_PATTERNS: Dict[SeverityLevel, List[str]] = {
    SeverityLevel.CRITICAL: [
        r"\b(emergency|critical|danger|freezing to death|burning alive|spiking)\b"
    ],
    SeverityLevel.HIGH: [
        r"\b(urgent|urgently|immediately|asap|burning|overheating|can barely breathe|barely breathe|unbearable|extreme|max cooling|iceberg|furnace|sauna|boiling|sweltering|freezing|now)\b",
        r"!{2,}",
    ],
    SeverityLevel.LOW: [
        r"\b(a bit|a little|slightly|tiny bit|somewhat|mildly|kinda|sort of|just a touch|minor|little bit)\b"
    ],
}

NON_ENVIRONMENTAL_PATTERNS: List[str] = [
    r"\b(cafeteria|lunch|coffee|tea|snack|food|menu|restaurant|canteen|breakfast|dinner)\b",
    r"\b(wifi|wi-fi|password|internet|network login|ethernet|login|credentials)\b",
    r"\b(restroom|bathroom|toilet|washroom|water closet|sink)\b",
    r"\b(parking|garage|car park|valet|bus|shuttle|train|commute|bike rack)\b",
    r"\b(salary|payroll|bonus|hr|human resources|manager|meeting schedule|vacation|leave)\b",
    r"\b(printer|scanner|paper|toner|stapler|pen|supplies)\b",
    r"\b(where is|what time|who is|directions to|how do i get to|when does|schedule)\b",
    r"\b(good morning|good afternoon|hello|hi|hey|how are you|good evening|bye)\b",
]


class DeterministicFallbackParser:
    """Zero-hallucination semantic regex parser for occupant comfort complaints."""

    @classmethod
    def parse(
        cls,
        raw_query: str,
        timestamp: float = 0.0,
        current_time: Optional[float] = None,
    ) -> SemanticTranslationResult:
        """
        Parses an occupant natural language query into an SemanticTranslationResult.
        Guarantees 100% strict Pydantic compliance.
        """
        ts = current_time if current_time is not None else timestamp
        if not raw_query or not isinstance(raw_query, str):
            return SemanticTranslationResult(
                raw_query=str(raw_query or ""),
                is_applicable=False,
                response_text="Message received, but no actionable constraints were identified.",
                events=[],
                timestamp=ts,
            )

        q_clean = raw_query.strip()
        q_lower = q_clean.lower()

        if not q_clean or len(re.findall(r"\w+", q_lower)) == 0:
            return SemanticTranslationResult(
                raw_query=raw_query,
                is_applicable=False,
                response_text="Message received, but no actionable constraints were identified.",
                events=[],
                timestamp=ts,
            )

        # 1. Non-environmental filtering
        has_intent_match = any(
            re.search(pat, q_lower) for pats in INTENT_PATTERNS.values() for pat in pats
        )
        has_inversion_match = any(
            re.search(pat, q_lower)
            for pat in (
                INVERSION_COOLING_DOWN
                + INVERSION_COOLING_UP
                + INVERSION_HEATING_UP
                + INVERSION_HEATING_DOWN
            )
        )
        has_degree_number = bool(
            re.search(r"\b(\d+(\.\d+)?\s*(?:degrees?|deg|°|°c|°f|c|f))\b", q_lower)
        )
        has_environmental_keyword = bool(
            re.search(
                r"\b(draft|drafty|breeze|breezy|air|fan|climate|temp|temperature|humidity|humid|moisture|sweat|sweating|chill|chilly|frost|frosty|vent|ventilation|airflow|heating|cooling|ac|hvac|overheating|overheated|burning|sweltering|freezing|cold|warm|hot|iceberg|sauna|furnace|stuffy|sticky|muggy|parched|arid|shivering|people|uncomfortable|discomfort|unbearable)\b",
                q_lower,
            )
        )

        has_positive_signal = (
            has_intent_match
            or has_inversion_match
            or has_degree_number
            or has_environmental_keyword
        )

        is_non_env = any(re.search(pat, q_lower) for pat in NON_ENVIRONMENTAL_PATTERNS)

        if is_non_env and not (has_intent_match or has_inversion_match or has_degree_number):
            return SemanticTranslationResult(
                raw_query=q_clean,
                is_applicable=False,
                response_text="Message received, but no actionable constraints were identified.",
                events=[],
                timestamp=ts,
            )

        if not has_positive_signal:
            return SemanticTranslationResult(
                raw_query=q_clean,
                is_applicable=False,
                response_text="Message received, but no actionable constraints were identified.",
                events=[],
                timestamp=ts,
            )

        # 2. Global Check
        is_global = any(re.search(pat, q_lower) for pat in GLOBAL_ZONE_PATTERNS)

        if is_global:
            global_events = cls._parse_single_clause_all_zones(q_clean, q_lower)
            if global_events:
                return SemanticTranslationResult(
                    raw_query=q_clean,
                    is_applicable=True,
                    response_text=f"Adjusted setpoints for all zones based on: '{q_clean}'",
                    events=global_events,
                    timestamp=ts,
                )

        # 3. Multi-clause segmentation
        raw_clauses = re.split(
            r"\b(?:and|but|while|also|as well as|however)\b|;|,", q_lower
        )
        raw_clauses = [c.strip() for c in raw_clauses if c.strip()]
        if not raw_clauses:
            raw_clauses = [q_lower]

        zone_clause_map: List[Tuple[str, str]] = []
        for clause in raw_clauses:
            detected_zone = None
            for zid, aliases in ZONE_ALIASES.items():
                sorted_aliases = sorted(aliases, key=len, reverse=True)
                for alias in sorted_aliases:
                    if re.search(r"\b" + re.escape(alias) + r"\b", clause):
                        detected_zone = zid
                        break
                if detected_zone:
                    break
            if detected_zone:
                zone_clause_map.append((detected_zone, clause))

        if not zone_clause_map:
            detected_zone = "open_office"
            for zid, aliases in ZONE_ALIASES.items():
                sorted_aliases = sorted(aliases, key=len, reverse=True)
                for alias in sorted_aliases:
                    if re.search(r"\b" + re.escape(alias) + r"\b", q_lower):
                        detected_zone = zid
                        break
                if detected_zone != "open_office":
                    break
            zone_clause_map.append((detected_zone, q_lower))

        events: List[ComfortEvent] = []
        seen_zones: Set[str] = set()

        for zid, clause in zone_clause_map:
            if zid in seen_zones:
                continue
            seen_zones.add(zid)

            event = cls._extract_comfort_event(zid, clause, q_lower)
            if event:
                events.append(event)

        if not events:
            fallback_ev = cls._extract_comfort_event("open_office", q_lower, q_lower)
            if fallback_ev:
                events.append(fallback_ev)
            else:
                return SemanticTranslationResult(
                    raw_query=q_clean,
                    is_applicable=False,
                    response_text="Message received, but no actionable constraints were identified.",
                    events=[],
                    timestamp=ts,
                )

        return SemanticTranslationResult(
            raw_query=q_clean,
            is_applicable=True,
            response_text=f"Processed feedback based on: '{q_clean}'",
            events=events,
            timestamp=ts,
        )

    @classmethod
    def _extract_comfort_event(
        cls, zid: str, clause: str, full_query: str
    ) -> Optional[ComfortEvent]:
        """Extracts a validated ComfortEvent from a clause."""
        inversion_intent: Optional[ComfortIntent] = None

        for pat in INVERSION_COOLING_DOWN:
            if re.search(pat, clause) or re.search(pat, full_query):
                inversion_intent = ComfortIntent.TOO_COLD
                break

        if not inversion_intent:
            for pat in INVERSION_COOLING_UP:
                if re.search(pat, clause) or re.search(pat, full_query):
                    inversion_intent = ComfortIntent.TOO_WARM
                    break

        if not inversion_intent:
            for pat in INVERSION_HEATING_UP:
                if re.search(pat, clause) or re.search(pat, full_query):
                    inversion_intent = ComfortIntent.TOO_COLD
                    break

        if not inversion_intent:
            for pat in INVERSION_HEATING_DOWN:
                if re.search(pat, clause) or re.search(pat, full_query):
                    inversion_intent = ComfortIntent.TOO_WARM
                    break

        intent = inversion_intent
        intent_confidence = 0.80 if inversion_intent else 0.70

        if not intent:
            for tent, pats in INTENT_PATTERNS.items():
                for pat in pats:
                    if re.search(pat, clause):
                        intent = tent
                        break
                if intent:
                    break

            if not intent:
                for tent, pats in INTENT_PATTERNS.items():
                    for pat in pats:
                        if re.search(pat, full_query):
                            intent = tent
                            break
                    if intent:
                        break

        if not intent:
            intent = ComfortIntent.UNKNOWN
            intent_confidence = 0.50

        # Suspected Cause
        cause = SuspectedCause.UNSPECIFIED
        if "draft" in full_query:
            cause = SuspectedCause.DRAFT
        elif "sun" in full_query or "window" in full_query:
            cause = SuspectedCause.SOLAR_GAIN
        elif "people" in full_query or "crowded" in full_query:
            cause = SuspectedCause.HIGH_OCCUPANCY

        # Severity Scoring
        severity = SeverityLevel.MEDIUM
        is_critical = any(re.search(p, clause) for p in SEVERITY_PATTERNS[SeverityLevel.CRITICAL])
        is_high = any(re.search(p, clause) for p in SEVERITY_PATTERNS[SeverityLevel.HIGH])
        is_low = any(re.search(p, clause) for p in SEVERITY_PATTERNS[SeverityLevel.LOW])
        
        if is_critical:
            severity = SeverityLevel.CRITICAL
        elif is_high:
            severity = SeverityLevel.HIGH
        elif is_low:
            severity = SeverityLevel.LOW

        confidence = intent_confidence
        if any(a in clause for a in ZONE_ALIASES.get(zid, [])):
            confidence = min(1.0, confidence + 0.10)
        
        duration = 120 if severity in [SeverityLevel.HIGH, SeverityLevel.CRITICAL] else (45 if severity == SeverityLevel.LOW else 60)

        return ComfortEvent(
            zone_id=zid,
            intent=intent,
            suspected_cause=cause,
            severity=severity,
            confidence=round(confidence, 2),
            duration_minutes=duration,
            source="REGEX_FALLBACK",
            reasoning=f"Regex matched intent '{intent.value}' and severity '{severity.value}'",
        )

    @classmethod
    def _parse_single_clause_all_zones(
        cls, raw_query: str, q_lower: str
    ) -> List[ComfortEvent]:
        events = []
        for zid in sorted(ALLOWED_ZONE_IDS):
            ev = cls._extract_comfort_event(zid, q_lower, q_lower)
            if ev:
                events.append(ev)
        return events
