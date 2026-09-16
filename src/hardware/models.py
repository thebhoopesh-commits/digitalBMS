"""
Hardware Abstraction Layer (HAL) - inbound sensor telemetry models.

Implements the "Inbound Telemetry Pipeline" contract declared in
`hardware_architecture.md` section 2A: unit normalization, range sanity,
explicit provenance and staleness.

The provenance fields exist so the chatbot can never present a point-sensor
reading as something it is not (see `docs/spatial-temperature-estimation-research.md`
section 1, "measurement identity"): every value carries its zone, its metric,
its unit, its device, and its age.
"""

from __future__ import annotations

import time
from enum import Enum
from typing import Any, Dict, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field, field_validator

from src.nlp.schemas import ALLOWED_ZONE_IDS, ZONE_ALIAS_MAP

# Readings older than this are reported as stale (never silently presented as live).
DEFAULT_TTL_SECONDS: float = 120.0

# Plausibility envelopes per metric, in canonical units.
RANGE_BOUNDS: Dict[str, Tuple[float, float]] = {
    "temperature": (-20.0, 60.0),
    "humidity": (0.0, 100.0),
    "co2": (300.0, 5000.0),
    "occupancy": (0.0, 500.0),
    "distance": (0.0, 500.0),
}

# Values beyond these hard limits are rejected outright (sensor fault / wiring).
HARD_REJECT_BOUNDS: Dict[str, Tuple[float, float]] = {
    "temperature": (-60.0, 150.0),
    "humidity": (-5.0, 120.0),
    "co2": (100.0, 40000.0),
    "occupancy": (-1.0, 5000.0),
    "distance": (0.0, 2000.0),
}


class Metric(str, Enum):
    """Physical quantities the HAL can ingest."""

    TEMPERATURE = "temperature"
    HUMIDITY = "humidity"
    CO2 = "co2"
    OCCUPANCY = "occupancy"
    DISTANCE = "distance"


class MetricUnit(str, Enum):
    """Canonical units stored by the HAL."""

    CELSIUS = "C"
    PERCENT_RH = "%RH"
    PPM = "ppm"
    COUNT = "count"
    CENTIMETER = "cm"


class ReadingSource(str, Enum):
    """Where a value came from - surfaced verbatim in the chat reply."""

    SENSOR = "sensor"              # fresh physical reading from the ESP32
    SENSOR_STALE = "sensor_stale"  # physical reading older than the TTL
    TWIN = "twin"                  # simulated twin fallback (clearly labelled)
    NONE = "none"                  # no data at all


_METRIC_ALIASES: Dict[str, Metric] = {
    "temperature": Metric.TEMPERATURE,
    "temp": Metric.TEMPERATURE,
    "t": Metric.TEMPERATURE,
    "temperature_c": Metric.TEMPERATURE,
    "air_temperature": Metric.TEMPERATURE,
    "humidity": Metric.HUMIDITY,
    "rh": Metric.HUMIDITY,
    "relative_humidity": Metric.HUMIDITY,
    "humidity_pct": Metric.HUMIDITY,
    "co2": Metric.CO2,
    "co2_ppm": Metric.CO2,
    "eco2": Metric.CO2,
    "occupancy": Metric.OCCUPANCY,
    "occupancy_count": Metric.OCCUPANCY,
    "people": Metric.OCCUPANCY,
    "headcount": Metric.OCCUPANCY,
    "distance": Metric.DISTANCE,
    "distance_cm": Metric.DISTANCE,
    "dist": Metric.DISTANCE,
    "dist_cm": Metric.DISTANCE,
    "ultrasonic": Metric.DISTANCE,
}

_UNIT_ALIASES: Dict[str, str] = {
    "c": "C", "degc": "C", "celsius": "C", "\u00b0c": "C", "degreecelsius": "C",
    "f": "F", "degf": "F", "fahrenheit": "F", "\u00b0f": "F", "degreefahrenheit": "F",
    "k": "K", "kelvin": "K",
    "%": "%RH", "%rh": "%RH", "rh": "%RH", "percent": "%RH", "pct": "%RH",
    "ppm": "ppm", "partspermillion": "ppm",
    "count": "count", "people": "count", "persons": "count", "cnt": "count",
    "cm": "cm", "centimeter": "cm", "centimeters": "cm", "m": "cm",
}


def normalize_metric(raw: Any) -> Metric:
    """Maps a device-reported metric key onto a canonical Metric."""
    if isinstance(raw, Metric):
        return raw
    key = str(raw or "").strip().lower().replace(" ", "_")
    if key in _METRIC_ALIASES:
        return _METRIC_ALIASES[key]
    raise ValueError(f"unsupported metric '{raw}'")


def default_unit_for(metric: Metric) -> MetricUnit:
    return {
        Metric.TEMPERATURE: MetricUnit.CELSIUS,
        Metric.HUMIDITY: MetricUnit.PERCENT_RH,
        Metric.CO2: MetricUnit.PPM,
        Metric.OCCUPANCY: MetricUnit.COUNT,
        Metric.DISTANCE: MetricUnit.CENTIMETER,
    }[metric]


def normalize_unit(raw: Any, metric: Metric) -> MetricUnit:
    """Maps a device-reported unit onto a canonical MetricUnit."""
    if raw is None or str(raw).strip() == "":
        return default_unit_for(metric)
    key = str(raw).strip().lower().replace(" ", "")
    canonical = _UNIT_ALIASES.get(key)
    if canonical is None:
        return default_unit_for(metric)
    if canonical in ("C", "F", "K"):
        return MetricUnit.CELSIUS  # temperature is always stored in Celsius
    if canonical == "%RH":
        return MetricUnit.PERCENT_RH
    if canonical == "ppm":
        return MetricUnit.PPM
    if canonical == "cm":
        return MetricUnit.CENTIMETER
    return MetricUnit.COUNT


def to_canonical(metric: Metric, value: float, unit_hint: Any = None) -> float:
    """Converts a raw reading into the canonical unit for its metric."""
    if metric == Metric.TEMPERATURE:
        hint = str(unit_hint or "").strip().lower().replace(" ", "")
        if hint in ("f", "degf", "fahrenheit", "\u00b0f", "degreefahrenheit"):
            return (value - 32.0) * 5.0 / 9.0
        if hint in ("k", "kelvin"):
            return value - 273.15
        return value
    if metric == Metric.HUMIDITY and 0.0 < value <= 1.0:
        return value * 100.0  # fractional RH reported by some drivers
    return value


def resolve_zone(raw: Any) -> Optional[str]:
    """Resolves an occupant/device zone reference onto a canonical zone id."""
    if raw is None:
        return None
    norm = str(raw).strip().lower().replace("-", "_")
    canonical = ZONE_ALIAS_MAP.get(norm, ZONE_ALIAS_MAP.get(norm.replace("_", " "), norm))
    if canonical in ALLOWED_ZONE_IDS:
        return canonical
    return None


class SensorReading(BaseModel):
    """A single validated, unit-normalized sensor sample."""

    model_config = ConfigDict(extra="forbid", use_enum_values=True)

    zone_id: str = Field(description="Canonical zone identifier")
    metric: Metric = Field(description="Physical quantity")
    value: float = Field(description="Value in canonical units")
    unit: MetricUnit = Field(description="Canonical unit")
    sensor_id: str = Field(default="unknown", description="Reporting device id")
    captured_at: float = Field(default_factory=time.time, description="Sample epoch seconds (device clock)")
    received_at: float = Field(default_factory=time.time, description="Ingest epoch seconds (Pi clock)")
    quality: float = Field(default=1.0, ge=0.0, le=1.0, description="Data-quality score from ingest checks")
    note: str = Field(default="", description="Quality/annotation trail")

    @field_validator("zone_id", mode="before")
    @classmethod
    def _validate_zone(cls, v: Any) -> str:
        zone = resolve_zone(v)
        if zone is None:
            raise ValueError(f"invalid zone_id '{v}'. Must resolve to one of {sorted(ALLOWED_ZONE_IDS)}")
        return zone

    def age_seconds(self, now: Optional[float] = None) -> float:
        return max(0.0, (now if now is not None else time.time()) - float(self.captured_at))


class SensorSnapshot(BaseModel):
    """A read result: value plus provenance, age and staleness."""

    model_config = ConfigDict(extra="forbid")

    zone_id: str
    metric: str
    reading: Optional[SensorReading] = None
    source: ReadingSource = ReadingSource.NONE
    age_seconds: float = 0.0
    stale: bool = False

    @property
    def has_value(self) -> bool:
        return self.reading is not None

    @property
    def value(self) -> Optional[float]:
        return self.reading.value if self.reading is not None else None

    def formatted_value(self) -> str:
        """Renders the value with its canonical unit, e.g. '23.4 \u00b0C'."""
        if self.reading is None:
            return "unknown"
        v = float(self.reading.value)
        if self.metric == Metric.TEMPERATURE.value:
            return f"{v:.1f} \u00b0C"
        if self.metric == Metric.HUMIDITY.value:
            return f"{v:.0f} %RH"
        if self.metric == Metric.CO2.value:
            return f"{v:.0f} ppm"
        if self.metric == Metric.DISTANCE.value:
            return f"{v:.1f} cm"
        return f"{int(round(v))}"

    def provenance_text(self) -> str:
        """Short provenance clause used in chat replies (empty when no reading)."""
        if self.reading is None:
            return ""
        if self.source in (ReadingSource.SENSOR, ReadingSource.SENSOR.value):
            return f"live sensor {self.reading.sensor_id}, {self.age_seconds:.0f} s ago"
        if self.source in (ReadingSource.SENSOR_STALE, ReadingSource.SENSOR_STALE.value):
            return (f"last sensor reading {self.age_seconds / 60.0:.1f} min ago - "
                    "live data unavailable")
        return "simulated twin value - no live sensor data"


__all__ = [
    "DEFAULT_TTL_SECONDS",
    "HARD_REJECT_BOUNDS",
    "RANGE_BOUNDS",
    "Metric",
    "MetricUnit",
    "ReadingSource",
    "SensorReading",
    "SensorSnapshot",
    "default_unit_for",
    "normalize_metric",
    "normalize_unit",
    "resolve_zone",
    "to_canonical",
]