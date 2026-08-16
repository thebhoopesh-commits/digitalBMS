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
    NLPTranslationResult,
    ThermalIntent,
    UrgencyLevel,
    ZoneConstraint,
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
    # Turn down AC / lower AC -> less cooling -> warmer setpoint (+ offset)
    r"\b(turn down (the )?ac|turn down (the )?air conditioning|lower (the )?ac|reduce (the )?ac|less ac|lesser ac|reduce (the )?cooling|less cooling|decrease (the )?cooling|ease up on (the )?ac|ac (?:is )?(?:a little )?lesser|ac .* lesser|ac .* lower|ac .* down)\b"
]

INVERSION_COOLING_UP = [
    # Turn up AC / crank AC -> more cooling -> cooler setpoint (- offset)
    r"\b(turn up (the )?ac|turn up (the )?air conditioning|crank (the )?ac|crank up (the )?ac|more ac|boost (the )?ac|max cooling|more cooling|increase (the )?cooling|increase (the )?ac|turn on (the )?ac|blast (the )?ac|ac .* higher|ac .* up|ac .* more)\b"
]

INVERSION_HEATING_UP = [
    # Turn up heat / increase heat -> warmer setpoint (+ offset)
    r"\b(turn up (the )?heat|increase (the )?heat|more heat|crank (the )?heat|raise (the )?heat|turn on (the )?heat|boost (the )?heat|need (more )?heat|heat .* higher|heat .* up|heat .* more)\b"
]

INVERSION_HEATING_DOWN = [
    # Turn down heat / lower heat -> cooler setpoint (- offset)
    r"\b(turn down (the )?heat|lower (the )?heat|reduce (the )?heat|less heat|decrease (the )?heat|ease off (the )?heat|heat .* lower|heat .* down|heat .* lesser)\b"
]

INTENT_PATTERNS: Dict[ThermalIntent, List[str]] = {
    ThermalIntent.TOO_COLD: [
        r"\b(freezing|freeze|froze|iceberg|arctic|frosty|frigid|icicle|polar|shiver|shivering|teeth chattering|ice box)\b",
        r"\b(cold|chilly|drafty|draft|numb|frostbite|too cold|way too cold|much too cold|bit chilly)\b",
        r"\b(warmer|make it warmer|need warmth|raise (the )?(?:temp|temperature)|increase (the )?(?:temp|temperature)|temp(?:erature)? too low|turn up (the )?(?:temp|temperature)|higher (?:temp|temperature)|up (the )?(?:temp|temperature))\b",
    ],
    ThermalIntent.TOO_WARM: [
        r"\b(boiling|sweltering|roasting|furnace|sweating|sweat box|baking|burning up|burning|spiking|heat wave|sauna)\b",
        r"\b(hot|warm|overheating|overheated|heat|too hot|way too hot|much too hot|extremely hot)\b",
        r"\b(cooler|make it cooler|need cooling|lower (the )?(?:temp|temperature)|decrease (the )?(?:temp|temperature)|reduce (the )?(?:temp|temperature)|drop (the )?(?:temp|temperature)|temp(?:erature)? too high|turn down (the )?(?:temp|temperature)|down (the )?(?:temp|temperature)|less (?:temp|temperature))\b",
    ],
    ThermalIntent.TOO_HUMID: [
        r"\b(humid|humidity|sticky|muggy|clammy|damp|moist|sweaty air|tropical|swamp|thick air)\b",
        r"\b(too humid|way too humid|high humidity|dehumidif|dehumidify)\b",
    ],
    ThermalIntent.TOO_DRY: [
        r"\b(dry|arid|parched|dehydrated|scratchy throat|static shock|dry eyes|no humidity|too dry|low humidity|humidify|humidification)\b"
    ],
    ThermalIntent.STUFFY: [
        r"\b(stuffy|stale|suffocating|can barely breathe|barely breathe|hard to breathe|lack of air|unventilated|airless|oppressive|poor ventilation|no airflow|ventilation|stale air)\b"
    ],
    ThermalIntent.COMFORTABLE: [
        r"\b(comfortable|perfect|just right|fine|great|pleasant|feels good|good temperature|optimal temp)\b"
    ],
}

URGENCY_PATTERNS: Dict[UrgencyLevel, List[str]] = {
    UrgencyLevel.HIGH: [
        r"\b(urgent|urgently|emergency|critical|immediately|asap|spiking|danger|burning|overheating|can barely breathe|barely breathe|unbearable|extreme|max cooling|iceberg|furnace|sauna|boiling|sweltering|freezing|now)\b",
        r"!{2,}",
    ],
    UrgencyLevel.LOW: [
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

POSITIVE_ENVIRONMENTAL_SIGNALS: List[str] = [
    r"\b(cold|freeze|freezing|chilly|iceberg|arctic|warm|hot|boiling|sweltering|sauna|furnace|bake|humid|sticky|muggy|dry|stuffy|air|breathe|ac|hvac|heat|heating|cool|cooling|temp|temperature|degrees?|deg|°c|°f|ventilation|airflow|people)\b"
]


class DeterministicFallbackParser:
    """Zero-hallucination semantic regex parser for occupant comfort complaints."""

    @classmethod
    def parse(
        cls,
        raw_query: str,
        timestamp: float = 0.0,
        current_time: Optional[float] = None,
    ) -> NLPTranslationResult:
        """
        Parses an occupant natural language query into an NLPTranslationResult.
        Guarantees 100% strict Pydantic compliance.
        """
        ts = current_time if current_time is not None else timestamp
        if not raw_query or not isinstance(raw_query, str):
            return NLPTranslationResult(
                raw_query=str(raw_query or ""),
                is_applicable=False,
                response_text="Message received, but no actionable constraints were identified.",
                constraints=[],
                timestamp=ts,
            )

        q_clean = raw_query.strip()
        q_lower = q_clean.lower()

        # Check for empty string or pure noise/punctuation
        if not q_clean or len(re.findall(r"\w+", q_lower)) == 0:
            return NLPTranslationResult(
                raw_query=raw_query,
                is_applicable=False,
                response_text="Message received, but no actionable constraints were identified.",
                constraints=[],
                timestamp=ts,
            )

        # 1. Non-environmental filtering and applicability check
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
                r"\b(draft|drafty|breeze|breezy|air|fan|climate|temp|temperature|humidity|humid|moisture|sweat|sweating|chill|chilly|frost|frosty|vent|ventilation|airflow|heating|cooling|ac|hvac|overheating|overheated|burning|sweltering|freezing|cold|warm|hot|iceberg|sauna|furnace|stuffy|sticky|muggy|parched|arid|shivering|people)\b",
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
            return NLPTranslationResult(
                raw_query=q_clean,
                is_applicable=False,
                response_text="Message received, but no actionable constraints were identified.",
                constraints=[],
                timestamp=ts,
            )

        if not has_positive_signal:
            return NLPTranslationResult(
                raw_query=q_clean,
                is_applicable=False,
                response_text="Message received, but no actionable constraints were identified.",
                constraints=[],
                timestamp=ts,
            )

        # 2. Check for Global Broadcast ("all zones", "entire office building", "everywhere")
        is_global = any(re.search(pat, q_lower) for pat in GLOBAL_ZONE_PATTERNS)

        if is_global:
            # Extract intent, urgency, and offset for global complaint
            global_constraints = cls._parse_single_clause_all_zones(q_clean, q_lower)
            if global_constraints:
                return NLPTranslationResult(
                    raw_query=q_clean,
                    is_applicable=True,
                    response_text=f"Adjusted setpoints for all zones based on: '{q_clean}'",
                    constraints=global_constraints,
                    timestamp=ts,
                )

        # 3. Multi-clause segmentation
        raw_clauses = re.split(
            r"\b(?:and|but|while|also|as well as|however)\b|;|,", q_lower
        )
        raw_clauses = [c.strip() for c in raw_clauses if c.strip()]
        if not raw_clauses:
            raw_clauses = [q_lower]

        # 4. Zone Detection per Clause
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

        # Default zone if none identified in segmented clauses
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

        constraints: List[ZoneConstraint] = []
        seen_zones: Set[str] = set()

        for zid, clause in zone_clause_map:
            if zid in seen_zones:
                continue
            seen_zones.add(zid)

            constraint = cls._extract_zone_constraint(zid, clause, q_lower)
            if constraint:
                constraints.append(constraint)

        if not constraints:
            # Fallback constraint for open_office
            fallback_zc = cls._extract_zone_constraint("open_office", q_lower, q_lower)
            if fallback_zc:
                constraints.append(fallback_zc)
            else:
                return NLPTranslationResult(
                    raw_query=q_clean,
                    is_applicable=False,
                    response_text="Message received, but no actionable constraints were identified.",
                    constraints=[],
                    timestamp=ts,
                )

        return NLPTranslationResult(
            raw_query=q_clean,
            is_applicable=True,
            response_text=f"Adjusted setpoints based on: '{q_clean}'",
            constraints=constraints,
            timestamp=ts,
        )

    @classmethod
    def _extract_zone_constraint(
        cls, zid: str, clause: str, full_query: str
    ) -> Optional[ZoneConstraint]:
        """Extracts a validated ZoneConstraint from a clause."""
        # 1. Inversion Grammar Check
        inversion_detected = False
        inversion_intent: Optional[ThermalIntent] = None
        inversion_temp_offset: float = 0.0

        for pat in INVERSION_COOLING_DOWN:
            if re.search(pat, clause) or re.search(pat, full_query):
                inversion_detected = True
                inversion_intent = ThermalIntent.TOO_COLD
                inversion_temp_offset = 2.0
                break

        if not inversion_detected:
            for pat in INVERSION_COOLING_UP:
                if re.search(pat, clause) or re.search(pat, full_query):
                    inversion_detected = True
                    inversion_intent = ThermalIntent.TOO_WARM
                    inversion_temp_offset = -2.5
                    break

        if not inversion_detected:
            for pat in INVERSION_HEATING_UP:
                if re.search(pat, clause) or re.search(pat, full_query):
                    inversion_detected = True
                    inversion_intent = ThermalIntent.TOO_COLD
                    inversion_temp_offset = 2.0
                    break

        if not inversion_detected:
            for pat in INVERSION_HEATING_DOWN:
                if re.search(pat, clause) or re.search(pat, full_query):
                    inversion_detected = True
                    inversion_intent = ThermalIntent.TOO_WARM
                    inversion_temp_offset = -2.0
                    break

        # 2. Standard Intent Extraction
        intent = inversion_intent
        intent_confidence = 0.90 if inversion_detected else 0.88

        if not intent:
            # Check clause first
            for tent, pats in INTENT_PATTERNS.items():
                for pat in pats:
                    if re.search(pat, clause):
                        intent = tent
                        break
                if intent:
                    break

            # If not in clause, check full query
            if not intent:
                for tent, pats in INTENT_PATTERNS.items():
                    for pat in pats:
                        if re.search(pat, full_query):
                            intent = tent
                            break
                    if intent:
                        break

        if not intent:
            # Default to TOO_WARM if temperature indicators present
            intent = ThermalIntent.TOO_WARM
            intent_confidence = 0.70

        # 3. Urgency Scoring
        urgency = UrgencyLevel.MEDIUM
        is_high = any(
            re.search(pat, clause) for pat in URGENCY_PATTERNS[UrgencyLevel.HIGH]
        ) or any(
            re.search(pat, full_query) for pat in URGENCY_PATTERNS[UrgencyLevel.HIGH]
        )
        is_low = any(
            re.search(pat, clause) for pat in URGENCY_PATTERNS[UrgencyLevel.LOW]
        ) or any(
            re.search(pat, full_query) for pat in URGENCY_PATTERNS[UrgencyLevel.LOW]
        )

        if is_high:
            urgency = UrgencyLevel.HIGH
        elif is_low:
            urgency = UrgencyLevel.LOW

        # 4. Explicit Numeric Degrees Extraction
        temp_offset = inversion_temp_offset
        hum_offset = 0.0

        deg_match = re.search(
            r"\b(to|at|set to|by)?\s*(\+|-)?\s*(\d+(?:\.\d+)?)\s*(?:degrees?|deg|°c|°f|°|c|f)?\b", clause
        )
        if not deg_match:
            deg_match = re.search(
                r"\b(to|at|set to|by)?\s*(\+|-)?\s*(\d+(?:\.\d+)?)\s*(?:degrees?|deg|°c|°f|°|c|f)?\b", full_query
            )

        if deg_match:
            modifier = deg_match.group(1)
            sign_str = deg_match.group(2)
            val_str = deg_match.group(3)

            if val_str:
                val = float(val_str)
                # Convert Fahrenheit if >= 50.0
                if val >= 50.0:
                    val = (val - 32.0) * 5.0 / 9.0

                is_absolute = False
                if modifier in ["to", "at", "set to"]:
                    is_absolute = True
                elif modifier == "by":
                    is_absolute = False
                elif val >= 15.0:
                    is_absolute = True

                if is_absolute:
                    temp_offset = val - 22.0
                else:
                    if sign_str == "-":
                        sign = -1.0
                    elif sign_str == "+":
                        sign = 1.0
                    elif any(
                        k in clause or k in full_query
                        for k in ["lower", "cooler", "drop", "reduce", "down", "cold", "less", "decrease"]
                    ):
                        sign = -1.0
                    else:
                        sign = 1.0
                    temp_offset = sign * val


            # Always clamp within safe physical bounds [-5.0, +5.0]
            temp_offset = max(-5.0, min(5.0, temp_offset))

            # Update intent based on resulting offset
            if temp_offset > 0.05:
                intent = ThermalIntent.TOO_COLD
            elif temp_offset < -0.05:
                intent = ThermalIntent.TOO_WARM
            else:
                intent = ThermalIntent.COMFORTABLE
        else:
            # Check for occupancy changes before nominal offset mapping
            occupancy_match = re.search(
                r"\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:more\s+)?(?:people|persons?|guys|girls|men|women)\s+(?:have\s+|just\s+)?(entered|left|walked in|walked out)\b",
                full_query
            )
            if occupancy_match:
                num_str = occupancy_match.group(1)
                action = occupancy_match.group(2)
                num = 1
                if num_str.isdigit():
                    num = int(num_str)
                else:
                    num = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}.get(num_str, 1)
                    
                if action in ["entered", "walked in"]:
                    temp_offset = -0.5 * num
                    intent = ThermalIntent.TOO_WARM
                else:
                    temp_offset = 0.5 * num
                    intent = ThermalIntent.TOO_COLD
                
                temp_offset = max(-5.0, min(5.0, temp_offset))
                
            elif not inversion_detected:
                # Nominal offset mapping
                if intent == ThermalIntent.TOO_COLD:
                    if urgency == UrgencyLevel.HIGH:
                        temp_offset = 2.5
                    elif urgency == UrgencyLevel.LOW:
                        temp_offset = 1.0
                    else:
                        temp_offset = 1.8
                elif intent == ThermalIntent.TOO_WARM:
                    if urgency == UrgencyLevel.HIGH:
                        temp_offset = -3.5 if zid == "server_room" or "spiking" in full_query else -3.0
                    elif urgency == UrgencyLevel.LOW:
                        temp_offset = -1.0
                    else:
                        temp_offset = -2.0
                elif intent == ThermalIntent.STUFFY:
                    temp_offset = -1.5 if urgency == UrgencyLevel.HIGH else -1.0
                    hum_offset = -5.0
                elif intent == ThermalIntent.TOO_HUMID:
                    hum_offset = -15.0 if urgency == UrgencyLevel.HIGH else -10.0
                    temp_offset = -0.5 if "sweltering" in full_query or "hot" in full_query else 0.0
                elif intent == ThermalIntent.TOO_DRY:
                    hum_offset = 15.0 if urgency == UrgencyLevel.HIGH else 10.0
                    temp_offset = 0.0
                elif intent == ThermalIntent.COMFORTABLE:
                    temp_offset = 0.0
                    hum_offset = 0.0

        # Special case for server_room priority cooling
        if zid == "server_room" and intent == ThermalIntent.TOO_WARM and urgency == UrgencyLevel.HIGH:
            temp_offset = min(temp_offset, -3.0)

        # 5. Confidence Assignment
        confidence = intent_confidence
        if any(a in clause for a in ZONE_ALIASES.get(zid, [])):
            confidence = min(1.0, confidence + 0.06)
        if urgency == UrgencyLevel.HIGH:
            confidence = min(1.0, confidence + 0.04)

        duration = 120 if urgency == UrgencyLevel.HIGH else (45 if urgency == UrgencyLevel.LOW else 60)

        return ZoneConstraint(
            zone_id=zid,
            intent=intent,
            temperature_offset_c=round(temp_offset, 2),
            humidity_offset_pct=round(hum_offset, 2),
            target_temp_bounds_c=None,
            urgency=urgency,
            duration_minutes=duration,
            confidence=round(confidence, 2),
            reasoning=f"Parsed rule for zone '{zid}' with intent '{intent.value}' and urgency '{urgency.value}' from text.",
        )

    @classmethod
    def _parse_single_clause_all_zones(
        cls, raw_query: str, q_lower: str
    ) -> List[ZoneConstraint]:
        """Creates synchronized constraints across all 4 zones for global complaints."""
        constraints = []
        for zid in sorted(ALLOWED_ZONE_IDS):
            zc = cls._extract_zone_constraint(zid, q_lower, q_lower)
            if zc:
                constraints.append(zc)
        return constraints
