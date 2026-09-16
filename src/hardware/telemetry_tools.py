"""
Server-side "tool calling" for the occupant chatbot.

Why this exists
---------------
Tool calling normally means "the model emits a function call". That requires a
model with the `tools` capability - `gemma3:1b` does not have it (verified on
ollama.com: gemma3:1b carries only the `vision` badge, while qwen3:1.7b carries
`tools` + `thinking`).

Tool calling is a *dispatch pattern*, not a model feature. So here the SERVER
decides the tool and executes it, and the model is never asked to produce a
number:

    occupant text
      -> deterministic intent + slot extraction (this module)
      -> TelemetryToolRegistry.read_metric(zone, metric)     <- the "tool"
      -> SensorManager (cache kept warm by ESP32 push or Esp32Poller)
      -> a rendered sentence: "The temperature at the Open Office is 23.4 C"

Consequences that matter for correctness:
    * the number always comes from a sensor (or is explicitly labelled twin/stale)
    * the chat path performs no network I/O, so a dead ESP32 cannot hang the UI
    * the LLM is free to handle complaints/phrasing, but can never invent a value
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from src.hardware.models import Metric, ReadingSource, SensorSnapshot
from src.hardware.sensor_manager import SensorManager, get_sensor_manager
from src.nlp.schemas import ZONE_ALIAS_MAP

# Zones per 3D environment (mirrors ALLOWED_ZONE_IDS groupings).
ENVIRONMENT_ZONES: Dict[str, List[str]] = {
    "corporate": ["lobby", "open_office", "conference_room", "server_room"],
    "healthcare": ["hospital_lobby", "clinical_areas", "staff_areas", "support_hvac"],
}

# Twin (simulation) field names, used only as a clearly-labelled fallback.
_TWIN_FIELDS: Dict[str, str] = {
    Metric.TEMPERATURE.value: "temperature_c",
    Metric.HUMIDITY.value: "humidity_pct",
    Metric.CO2.value: "co2_ppm",
    Metric.OCCUPANCY.value: "occupancy_count",
}

# Metric detection: ordered so temperature wins ties in "temp and humidity" style asks.
_METRIC_PATTERNS: List[tuple] = [
    (Metric.TEMPERATURE, re.compile(
        r"\b(temperatures?|temps?|degrees?|degree\s?c|how\s+(hot|cold|warm)|"
        r"is\s+it\s+(hot|cold|warm)|too\s+(hot|cold|warm)|thermostat)\b")),
    (Metric.HUMIDITY, re.compile(
        r"\b(humidity|humid|relative\s+humidity|rh|sticky|muggy|damp|dryness|dry)\b")),
    (Metric.CO2, re.compile(r"\b(co2|c02|carbon\s+dioxide|air\s+quality|iaq|ppm)\b")),
    (Metric.OCCUPANCY, re.compile(
        r"\b(occupancy|occupied|how\s+many\s+people|head\s?count|people\s+count|"
        r"number\s+of\s+people|occupants?)\b")),
]

# Tokens that mark a request for live state rather than a comfort complaint.
_TELEMETRY_WORDS = re.compile(
    r"\b(read|reading|value|level|current|currently|right\s+now|now|live|"
    r"sensor|sensors|measure|measured|what\s+is|whats|show|tell|check|report|"
    r"status|inventory|which)\b")

# Interrogatives: a question must never be treated as an actionable complaint.
_INTERROGATIVE = re.compile(
    r"^\s*(what|whats|what's|how|is|are|was|were|does|do|did|where|when|which|"
    r"who|why|can|could|would|will|tell\s+me|show\s+me|give\s+me|list|any)\b")

_CONTRACTION_FIXES = (
    (re.compile(r"\bwhats\b"), "what is"),
    (re.compile(r"\bwheres\b"), "where is"),
    (re.compile(r"\bhows\b"), "how is"),
    (re.compile(r"\bwhat's\b"), "what is"),
    (re.compile(r"\btemp\b"), "temperature"),
    (re.compile(r"\brh\b"), "humidity"),
    (re.compile(r"\bdegrees\b"), "temperature"),
)


def normalize_query_text(text: Any) -> str:
    """Lowercases and repairs elisions/abbreviations so slots match reliably."""
    normalized = str(text or "").lower().strip()
    normalized = normalized.replace("\u00b0c", " degrees").replace("\u00b0f", " degrees")
    for pattern, replacement in _CONTRACTION_FIXES:
        normalized = pattern.sub(replacement, normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def detect_metrics(text: str) -> List[Metric]:
    """All metrics explicitly asked about, in canonical order (temperature first)."""
    low = normalize_query_text(text)
    return [metric for metric, pattern in _METRIC_PATTERNS if pattern.search(low)]


def is_interrogative(text: str) -> bool:
    """True for questions/status checks (these must never inject constraints)."""
    low = str(text or "").strip().lower()
    return bool(_INTERROGATIVE.search(low)) or low.endswith("?")


def resolve_zone_from_text(text: str, allowed: Sequence[str]) -> Optional[str]:
    """Longest-alias-first zone resolution over the shared ZONE_ALIAS_MAP."""
    low = normalize_query_text(text)
    for alias in sorted(ZONE_ALIAS_MAP, key=len, reverse=True):
        zone_id = ZONE_ALIAS_MAP[alias]
        if zone_id not in allowed:
            continue
        if re.search(rf"\b{re.escape(alias)}\b", low):
            return zone_id
    return None


def resolve_zone_from_history(history: Optional[Sequence[Dict[str, Any]]],
                             allowed: Sequence[str]) -> Optional[str]:
    """Carries the zone over from earlier turns ("what about the conference room?").

    Uses the client-supplied short-term history already sent by the UI
    (`app.js` keeps the last 5 turns) - no new session store required.
    """
    if not history:
        return None
    for turn in reversed(list(history)):
        content = turn.get("content") if isinstance(turn, dict) else None
        zone = resolve_zone_from_text(content or "", allowed)
        if zone:
            return zone
    return None


def zones_for_environment(environment_id: Optional[str]) -> List[str]:
    return ENVIRONMENT_ZONES.get(str(environment_id or "corporate").lower(),
                                 ENVIRONMENT_ZONES["corporate"])


def zone_display(zone_id: str) -> str:
    """'open_office' -> 'Open Office' (matches the dashboard wording)."""
    return str(zone_id).replace("_", " ").title()


def metric_word(metric: str) -> str:
    return {
        Metric.TEMPERATURE.value: "temperature",
        Metric.HUMIDITY.value: "humidity",
        Metric.CO2.value: "CO2 level",
        Metric.OCCUPANCY.value: "occupancy",
    }.get(str(metric), str(metric))


@dataclass
class TelemetryQuery:
    """Deterministically parsed occupant question."""

    raw: str
    metrics: List[Metric] = field(default_factory=list)
    zone_id: Optional[str] = None
    from_history: bool = False
    inventory_request: bool = False


@dataclass
class ToolResult:
    """Outcome of a server-side telemetry tool call."""

    text: str
    kind: str                      # "reading" | "clarification" | "inventory" | "no_data"
    zone_id: Optional[str] = None
    metrics: List[str] = field(default_factory=list)
    source: ReadingSource = ReadingSource.NONE
    values: Dict[str, Any] = field(default_factory=dict)

    def to_payload(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "kind": self.kind,
            "zone_id": self.zone_id,
            "metrics": self.metrics,
            "source": str(self.source),
            "values": self.values,
        }


class TelemetryToolRegistry:
    """The "tools" the chatbot may call. All of them read the local cache."""

    def __init__(self, manager: Optional[SensorManager] = None) -> None:
        self.manager = manager or get_sensor_manager()

    def _twin_value(self, zone_id: str, metric: Metric,
                    twin_states: Optional[Dict[str, Any]]) -> Optional[float]:
        if not twin_states:
            return None
        state = twin_states.get(zone_id) or {}
        field_name = _TWIN_FIELDS.get(metric.value)
        if not field_name:
            return None
        raw = state.get(field_name)
        try:
            return float(raw) if raw is not None else None
        except (TypeError, ValueError):
            return None

    def read_metric(self, zone_id: str, metric: Metric,
                    twin_states: Optional[Dict[str, Any]] = None) -> SensorSnapshot:
        """Tool: read one metric for one zone (sensor -> stale -> twin -> none)."""
        return self.manager.get(
            zone_id, metric, twin_value=self._twin_value(zone_id, metric, twin_states),
        )

    def zone_inventory(self, allowed: Sequence[str]) -> ToolResult:
        """Tool: list zones that currently have live sensor data."""
        live = [z for z in self.manager.zones_reporting(Metric.TEMPERATURE) if z in allowed]
        if not live:
            return ToolResult(
                text=("I have no live sensor data right now - the Pi gateway is not "
                      "receiving from the sensor nodes."),
                kind="no_data",
            )
        names = ", ".join(zone_display(z) for z in live)
        return ToolResult(
            text=f"I am receiving live sensor data for: {names}.",
            kind="inventory",
            metrics=[Metric.TEMPERATURE.value],
            source=ReadingSource.SENSOR,
            values={"zones": live},
        )

    def read_zone(self, zone_id: str, metrics: Sequence[Metric],
                  twin_states: Optional[Dict[str, Any]] = None) -> ToolResult:
        """Tool: read metrics for a zone and render the reply sentence."""
        snapshots: List[SensorSnapshot] = [
            self.read_metric(zone_id, metric, twin_states) for metric in metrics
        ]
        available = [s for s in snapshots if s.has_value]
        name = zone_display(zone_id)

        if not available:
            return ToolResult(
                text=(f"I have no live {self._metric_words(metrics)} reading for the {name} "
                      "right now, and the simulated twin has no value for it either."),
                kind="no_data",
                zone_id=zone_id,
                metrics=[m.value for m in metrics],
            )

        clauses = []
        for snap in available:
            word = metric_word(snap.metric)
            if len(available) == 1:
                clauses.append(f"{word} at the {name} is {snap.formatted_value()}")
            else:
                clauses.append(f"{word} is {snap.formatted_value()}")

        sentence = "The " + clauses[0]
        if len(clauses) > 1:
            sentence += " and " + " and ".join(clauses[1:])
        sentence += "."

        provenance_parts: List[str] = []
        for snap in available:
            text = snap.provenance_text()
            if text and text not in provenance_parts:
                provenance_parts.append(text)
        if provenance_parts:
            sentence += f" ({' / '.join(provenance_parts)})."

        return ToolResult(
            text=sentence,
            kind="reading",
            zone_id=zone_id,
            metrics=[s.metric for s in available],
            source=self._worst_source(available),
            values={s.metric: s.value for s in available},
        )

    @staticmethod
    def _metric_words(metrics: Sequence[Metric]) -> str:
        return " or ".join(metric_word(m.value) for m in metrics) if metrics else "sensor"

    @staticmethod
    def _worst_source(snapshots: Sequence[SensorSnapshot]) -> ReadingSource:
        """Reports the least-trustworthy source among the values shown."""
        order = [ReadingSource.SENSOR, ReadingSource.SENSOR_STALE, ReadingSource.TWIN,
                 ReadingSource.NONE]
        worst = ReadingSource.SENSOR
        for snap in snapshots:
            source = ReadingSource(snap.source)
            if order.index(source) > order.index(worst):
                worst = source
        return worst


def parse_telemetry_query(message: str, environment_id: Optional[str] = "corporate",
                          history: Optional[Sequence[Dict[str, Any]]] = None
                          ) -> Optional[TelemetryQuery]:
    """Returns a TelemetryQuery for status questions, else None (complaints -> LLM)."""
    if not message or not str(message).strip():
        return None
    if not is_interrogative(message):
        return None

    low = normalize_query_text(message)
    allowed = zones_for_environment(environment_id)
    metrics = detect_metrics(low)
    inventory = bool(re.search(r"\b(which|what|list)\b.*\b(zones?|rooms?|areas?)\b", low)) \
        and not metrics

    zone_id = resolve_zone_from_text(low, allowed)
    from_history = False
    if zone_id is None and not inventory:
        zone_id = resolve_zone_from_history(history, allowed)
        from_history = zone_id is not None

    if not metrics and not inventory:
        # No metric named: accept only if it still reads like a live-state request.
        if not _TELEMETRY_WORDS.search(low) or zone_id is None:
            return None
        metrics = [Metric.TEMPERATURE]  # "how is the open office?" -> temperature

    return TelemetryQuery(raw=str(message), metrics=metrics, zone_id=zone_id,
                          from_history=from_history, inventory_request=inventory)


def answer_telemetry_query(message: str, environment_id: str = "corporate",
                           twin_states: Optional[Dict[str, Any]] = None,
                           history: Optional[Sequence[Dict[str, Any]]] = None,
                           manager: Optional[SensorManager] = None
                           ) -> Optional[ToolResult]:
    """Dispatch a status question to the right tool. None => not a sensor read.

    Returning None means "leave this to the existing NLP/LLM path" (comfort
    complaints, small talk). Returning a ToolResult means the reply has already
    been rendered from real data and the caller must NOT inject any constraint.
    """
    query = parse_telemetry_query(message, environment_id, history)
    if query is None:
        return None

    registry = TelemetryToolRegistry(manager)
    allowed = zones_for_environment(environment_id)

    if query.inventory_request:
        return registry.zone_inventory(allowed)

    if query.zone_id is None:
        names = ", ".join(zone_display(z) for z in allowed)
        return ToolResult(
            text=f"Which zone should I check? I can read live sensors for: {names}.",
            kind="clarification",
            metrics=[m.value for m in query.metrics],
        )

    return registry.read_zone(query.zone_id, query.metrics, twin_states)


__all__ = [
    "ENVIRONMENT_ZONES",
    "TelemetryQuery",
    "TelemetryToolRegistry",
    "ToolResult",
    "answer_telemetry_query",
    "detect_metrics",
    "is_interrogative",
    "metric_word",
    "normalize_query_text",
    "parse_telemetry_query",
    "resolve_zone_from_history",
    "resolve_zone_from_text",
    "zone_display",
    "zones_for_environment",
]