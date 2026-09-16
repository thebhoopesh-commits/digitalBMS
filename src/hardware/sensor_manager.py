"""
Hardware Abstraction Layer (HAL) - sensor registry.

Thread-safe store of the latest validated reading per (zone, metric), with:
    * data-quality checks (unit normalization, range plausibility, quality score)
    * freshness tracking (TTL -> `SENSOR_STALE` instead of a silent lie)
    * last-known-good retention so a reply can state the age of the value
    * an explicit twin fallback path (`SIMULATION_MODE` "simulated"/"hybrid")

Design rule: reads never touch the network. A background poller or the ESP32
push keeps this cache warm, so `POST /api/chat` stays fast and can never block
on a sleeping ESP32.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from src.hardware.models import (
    DEFAULT_TTL_SECONDS,
    HARD_REJECT_BOUNDS,
    RANGE_BOUNDS,
    Metric,
    ReadingSource,
    SensorReading,
    SensorSnapshot,
    default_unit_for,
    normalize_metric,
    normalize_unit,
    resolve_zone,
    to_canonical,
)

logger = logging.getLogger("hvac.hardware.sensors")


def _parse_device_zone_map(raw: Optional[str]) -> Dict[str, str]:
    """Parses SENSOR_DEVICE_ZONES='esp32-01:lobby,esp32-02:open_office'."""
    mapping: Dict[str, str] = {}
    for pair in str(raw or "").split(","):
        if ":" not in pair:
            continue
        device, zone = pair.split(":", 1)
        device = device.strip().lower()
        zone_id = resolve_zone(zone)
        if device and zone_id:
            mapping[device] = zone_id
        elif device:
            logger.warning("Ignoring unknown zone '%s' for device '%s'", zone.strip(), device)
    return mapping


class SensorManager:
    """Latest-value registry for physical sensor telemetry."""

    def __init__(
        self,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
        device_zone_map: Optional[Dict[str, str]] = None,
    ) -> None:
        self._lock = threading.RLock()
        self.ttl_seconds = float(ttl_seconds)
        self._readings: Dict[Tuple[str, str], SensorReading] = {}
        self._device_zone_map: Dict[str, str] = {
            k.lower(): v for k, v in (device_zone_map or {}).items()
        }
        self._rejects: List[str] = []
        self._ingest_count: int = 0
        self._last_ingest_at: Optional[float] = None

    def set_device_zone_map(self, mapping: Dict[str, str]) -> None:
        with self._lock:
            self._device_zone_map = {k.lower(): v for k, v in mapping.items()}

    def device_zone(self, device_id: str) -> Optional[str]:
        return self._device_zone_map.get(str(device_id or "").lower())

    def ingest_reading(self, reading: SensorReading) -> SensorReading:
        """Stores a validated reading, replacing any older sample for that key."""
        with self._lock:
            self._readings[(reading.zone_id, str(reading.metric))] = reading
            self._ingest_count += 1
            self._last_ingest_at = time.time()
        logger.debug(
            "Sensor ingest %s/%s = %s (device=%s quality=%.2f)",
            reading.zone_id, reading.metric, reading.value, reading.sensor_id, reading.quality,
        )
        return reading

    def ingest_sample(
        self,
        *,
        metric: Any,
        value: Any,
        zone: Any = None,
        device_id: str = "unknown",
        unit: Any = None,
        captured_at: Optional[float] = None,
        now: Optional[float] = None,
    ) -> SensorReading:
        """Validates/QC-checks one raw sample and stores it. Raises ValueError if unusable."""
        now_ts = now if now is not None else time.time()
        metric_enum = normalize_metric(metric)

        try:
            numeric = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"non-numeric value for {metric_enum.value}: {value!r}") from exc

        hard_min, hard_max = HARD_REJECT_BOUNDS[metric_enum.value]
        if not (hard_min <= numeric <= hard_max):
            raise ValueError(
                f"implausible {metric_enum.value} {numeric} outside [{hard_min}, {hard_max}]"
            )

        zone_id = resolve_zone(zone) or self.device_zone(device_id)
        quality = 1.0
        notes: List[str] = []

        canonical = to_canonical(metric_enum, numeric, unit)
        lo, hi = RANGE_BOUNDS[metric_enum.value]
        if not (lo <= canonical <= hi):
            quality -= 0.4
            notes.append(f"out-of-range {canonical:.1f} (expected {lo}..{hi})")

        if zone_id is None:
            quality -= 0.3
            notes.append("zone unresolved at ingest; device map/zone field missing")

        stamp = float(captured_at) if captured_at else now_ts
        if stamp > now_ts + 5.0:
            quality -= 0.2
            notes.append("device clock ahead of Pi clock; using Pi time")
            stamp = now_ts
        elif (now_ts - stamp) > 10.0 * self.ttl_seconds:
            quality -= 0.2
            notes.append("very old sample")

        reading = SensorReading(
            zone_id=zone_id if zone_id is not None else "open_office",
            metric=metric_enum,
            value=canonical,
            unit=normalize_unit(None, metric_enum),
            sensor_id=str(device_id or "unknown"),
            captured_at=stamp,
            received_at=now_ts,
            quality=max(0.0, min(1.0, quality)),
            note="; ".join(notes),
        )
        return self.ingest_reading(reading)

    def reject(self, reason: str) -> None:
        with self._lock:
            self._rejects.append(reason)
            self._rejects = self._rejects[-50:]
        logger.warning("Sensor sample rejected: %s", reason)

    def get(
        self,
        zone_id: str,
        metric: Any,
        twin_value: Optional[float] = None,
        now: Optional[float] = None,
    ) -> SensorSnapshot:
        """Returns the freshest value for (zone, metric), degrading honestly.

        Ladder: live sensor -> last-known-good (marked stale) -> twin value
        (marked `TWIN`) -> nothing at all. Never invents a number.
        """
        now_ts = now if now is not None else time.time()
        zone = resolve_zone(zone_id) or str(zone_id)
        metric_enum = normalize_metric(metric)

        with self._lock:
            reading = self._readings.get((zone, metric_enum.value))

        if reading is not None:
            age = reading.age_seconds(now_ts)
            if age <= self.ttl_seconds or twin_value is None:
                return SensorSnapshot(
                    zone_id=zone, metric=metric_enum.value, reading=reading,
                    source=(ReadingSource.SENSOR if age <= self.ttl_seconds
                            else ReadingSource.SENSOR_STALE),
                    age_seconds=age, stale=age > self.ttl_seconds,
                )

        if twin_value is not None:
            twin_reading = SensorReading(
                zone_id=zone, metric=metric_enum, value=float(twin_value),
                unit=default_unit_for(metric_enum), sensor_id="digital-twin",
                captured_at=now_ts, received_at=now_ts, quality=0.5,
                note="simulated twin fallback",
            )
            return SensorSnapshot(
                zone_id=zone, metric=metric_enum.value, reading=twin_reading,
                source=ReadingSource.TWIN, age_seconds=0.0, stale=False,
            )

        return SensorSnapshot(zone_id=zone, metric=metric_enum.value, source=ReadingSource.NONE)

    def zones_reporting(self, metric: Any = Metric.TEMPERATURE,
                        now: Optional[float] = None) -> List[str]:
        """Zones with a fresh reading (used for honest clarification replies)."""
        now_ts = now if now is not None else time.time()
        metric_enum = normalize_metric(metric)
        with self._lock:
            pairs = [
                (zone, reading) for (zone, m), reading in self._readings.items()
                if m == metric_enum.value and reading.age_seconds(now_ts) <= self.ttl_seconds
            ]
        return sorted({zone for zone, _ in pairs})

    def snapshot(self) -> List[Dict[str, Any]]:
        """All latest readings (for GET /api/sensors)."""
        now_ts = time.time()
        with self._lock:
            rows = list(self._readings.items())
        out: List[Dict[str, Any]] = []
        for (zone, metric), reading in sorted(rows):
            age = reading.age_seconds(now_ts)
            out.append({
                "zone_id": zone,
                "metric": metric,
                "value": reading.value,
                "unit": reading.unit,
                "sensor_id": reading.sensor_id,
                "age_seconds": round(age, 1),
                "stale": age > self.ttl_seconds,
                "quality": reading.quality,
                "note": reading.note,
                "captured_at": reading.captured_at,
            })
        return out

    def health(self) -> Dict[str, Any]:
        """Ingest-level health summary (for GET /api/sensors/health)."""
        now_ts = time.time()
        with self._lock:
            count = len(self._readings)
            ingest_count = self._ingest_count
            last = self._last_ingest_at
            rejects = list(self._rejects[-10:])
        fresh = [r for r in self.snapshot() if not r["stale"]]
        return {
            "ttl_seconds": self.ttl_seconds,
            "keys_tracked": count,
            "fresh_readings": len(fresh),
            "stale_readings": count - len(fresh),
            "ingest_count": ingest_count,
            "seconds_since_last_ingest": (round(now_ts - last, 1) if last else None),
            "device_zone_map": dict(self._device_zone_map),
            "recent_rejects": rejects,
        }

    def reset(self) -> None:
        with self._lock:
            self._readings.clear()
            self._rejects.clear()
            self._ingest_count = 0
            self._last_ingest_at = None


_SENSOR_MANAGER: Optional[SensorManager] = None
_MANAGER_LOCK = threading.Lock()


def get_sensor_manager(reset: bool = False) -> SensorManager:
    """Process-wide SensorManager, configured from the environment."""
    global _SENSOR_MANAGER
    with _MANAGER_LOCK:
        if _SENSOR_MANAGER is None or reset:
            ttl = float(os.environ.get("SENSOR_TTL_SECONDS", DEFAULT_TTL_SECONDS))
            device_map = _parse_device_zone_map(os.environ.get("SENSOR_DEVICE_ZONES"))
            _SENSOR_MANAGER = SensorManager(ttl_seconds=ttl, device_zone_map=device_map)
            logger.info(
                "SensorManager initialized (ttl=%.0fs, %d device->zone mappings)",
                ttl, len(device_map),
            )
        return _SENSOR_MANAGER


__all__ = ["SensorManager", "get_sensor_manager"]