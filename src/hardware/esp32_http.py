"""
ESP32 <-> Raspberry Pi transport layer (HAL).

Supports both topologies declared in `hardware_architecture.md`:

1. PUSH (recommended) - the ESP32 POSTs JSON to `POST /api/sensors/ingest`
   on the Pi. Lowest latency, no Pi-side polling, the ESP32 handles its own
   reconnect/backoff. See `firmware/esp32_sensor_node/esp32_sensor_node.ino`.
2. POLL - the Pi runs `Esp32Poller` and GETs `http://<esp32>/sensors` every
   `SENSOR_POLL_SECONDS`. Useful when the ESP32 is behind NAT or you cannot
   edit its firmware.
3. MQTT (optional, matches the Mosquitto stack in the hardware doc) - subscribe
   to `SENSOR_MQTT_TOPIC` and feed payloads through the same
   `normalize_esp32_payload()` contract.

Every transport funnels through `normalize_esp32_payload()` then
`SensorManager.ingest_sample()`, so unit handling and QC live in one place.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from typing import Any, Dict, Iterable, List, Optional

from src.hardware.sensor_manager import SensorManager, get_sensor_manager

logger = logging.getLogger("hvac.hardware.esp32")

# Keys accepted for the provenance fields of a payload (first match wins).
_ZONE_KEYS = ("zone", "zone_id", "location", "room", "zoneId")
_DEVICE_KEYS = ("device_id", "deviceId", "device", "id", "sensor_id", "node")
_TIME_KEYS = ("captured_at", "timestamp", "ts", "time", "epoch")

# Direct scalar keys -> canonical metric name.
_SCALAR_METRIC_KEYS = {
    "temperature": "temperature",
    "temp": "temperature",
    "temperature_c": "temperature",
    "humidity": "humidity",
    "rh": "humidity",
    "humidity_pct": "humidity",
    "co2": "co2",
    "co2_ppm": "co2",
    "occupancy": "occupancy",
    "occupancy_count": "occupancy",
    "people": "occupancy",
    "distance": "distance",
    "distance_cm": "distance",
    "dist": "distance",
    "dist_cm": "distance",
}


def _first(payload: Dict[str, Any], keys: Iterable[str]) -> Optional[Any]:
    for key in keys:
        if key in payload and payload[key] not in (None, ""):
            return payload[key]
    return None


def _iter_samples(payload: Any) -> List[Dict[str, Any]]:
    """Accepts a single sample, a list of samples, or {"readings": [...]}."""
    if isinstance(payload, list):
        return [p for p in payload if isinstance(p, dict)]
    if isinstance(payload, dict):
        for list_key in ("readings", "samples", "data"):
            inner = payload.get(list_key)
            if isinstance(inner, list):
                merged: List[Dict[str, Any]] = []
                for item in inner:
                    if not isinstance(item, dict):
                        continue
                    # inherit device/zone/timestamp from the envelope
                    for meta in (_DEVICE_KEYS, _ZONE_KEYS, _TIME_KEYS):
                        value = _first(payload, meta)
                        if value is not None and _first(item, meta) is None:
                            item[meta[0]] = value
                    merged.append(item)
                return merged
        return [payload]
    return []


def _samples_from_scalars(sample: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Expands {"temperature": 23.4, "humidity": 45} into one row per metric."""
    rows: List[Dict[str, Any]] = []
    for key, metric in _SCALAR_METRIC_KEYS.items():
        if key in sample and isinstance(sample[key], (int, float)):
            row = dict(sample)
            row["metric"] = metric
            row["value"] = sample[key]
            rows.append(row)
    return rows


def normalize_esp32_payload(payload: Any) -> List[Dict[str, Any]]:
    """Converts any accepted ESP32 JSON shape into a list of ingest rows.

    Rows are shaped as {metric, value, zone, device_id, unit, captured_at}.
    Raises ValueError when the payload carries no readable samples.
    """
    if isinstance(payload, (bytes, bytearray)):
        payload = payload.decode("utf-8", errors="replace")
    if isinstance(payload, str):
        payload = json.loads(payload)

    rows: List[Dict[str, Any]] = []
    for sample in _iter_samples(payload):
        metric_field = sample.get("metric") or sample.get("sensor_type") or sample.get("type")
        if metric_field and "value" in sample:
            item = dict(sample)
            item["metric"] = metric_field
            candidates = [item]
        elif "distance_cm" in sample:
            try:
                dist_val = float(sample["distance_cm"])
            except (TypeError, ValueError):
                dist_val = 0.0
            s_dist = dict(sample)
            s_dist["metric"] = "distance"
            s_dist["value"] = dist_val
            s_dist["unit"] = "cm"

            # Derive occupancy count: if distance between 10cm and 200cm -> 1 person, else 0
            s_occ = dict(sample)
            s_occ["metric"] = "occupancy"
            s_occ["value"] = 1.0 if (10.0 <= dist_val <= 200.0) else 0.0
            s_occ["unit"] = "count"
            candidates = [s_dist, s_occ]
        else:
            candidates = _samples_from_scalars(sample)
            if not candidates:
                continue
        for candidate in candidates:
            captured_at = _first(candidate, _TIME_KEYS)
            try:
                captured_float = float(captured_at) if captured_at is not None else None
            except (TypeError, ValueError):
                captured_float = None
            if captured_float is not None and captured_float > 1e11:
                captured_float = captured_float / 1000.0  # device sent milliseconds
            rows.append({
                "metric": candidate.get("metric"),
                "value": candidate.get("value"),
                "zone": _first(candidate, _ZONE_KEYS),
                "device_id": str(_first(candidate, _DEVICE_KEYS) or "unknown"),
                "unit": candidate.get("unit") or candidate.get("units"),
                "captured_at": captured_float,
            })

    if not rows:
        raise ValueError("payload contained no readable sensor samples")
    return rows


def ingest_esp32_payload(payload: Any, manager: Optional[SensorManager] = None) -> Dict[str, Any]:
    """Normalizes + QC-checks + stores a payload. Never raises on bad rows."""
    mgr = manager or get_sensor_manager()
    accepted: List[Dict[str, Any]] = []
    rejected: List[str] = []

    try:
        rows = normalize_esp32_payload(payload)
    except Exception as exc:
        mgr.reject(f"payload parse failed: {exc}")
        return {"accepted": 0, "rejected": 1, "errors": [str(exc)], "readings": []}

    for row in rows:
        try:
            reading = mgr.ingest_sample(
                metric=row["metric"],
                value=row["value"],
                zone=row["zone"],
                device_id=row["device_id"],
                unit=row["unit"],
                captured_at=row["captured_at"],
            )
            accepted.append({
                "zone_id": reading.zone_id,
                "metric": str(reading.metric),
                "value": reading.value,
                "unit": reading.unit,
                "quality": reading.quality,
            })
        except Exception as exc:
            rejected.append(f"{row.get('metric')}={row.get('value')}: {exc}")
            mgr.reject(str(exc))

    return {"accepted": len(accepted), "rejected": len(rejected),
            "readings": accepted, "errors": rejected[:5]}


class Esp32Poller:
    """Background thread that GETs a JSON snapshot from the ESP32 on an interval.

    Runs off the event loop entirely (blocking `urllib`, no asyncio) so the
    chat endpoint can never be blocked by an unresponsive sensor node.
    """

    def __init__(
        self,
        url: str,
        interval_seconds: float = 10.0,
        timeout_seconds: float = 3.0,
        manager: Optional[SensorManager] = None,
        max_backoff_seconds: float = 60.0,
    ) -> None:
        self.url = url
        self.interval_seconds = float(interval_seconds)
        self.timeout_seconds = float(timeout_seconds)
        self.manager = manager or get_sensor_manager()
        self.max_backoff_seconds = float(max_backoff_seconds)
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.last_error: Optional[str] = None
        self.last_success_at: Optional[float] = None
        self.polls: int = 0

    def _fetch(self) -> Any:
        import urllib.request

        token = os.environ.get("SENSOR_INGEST_TOKEN")
        headers = {"Accept": "application/json"}
        if token:
            headers["X-Sensor-Token"] = token
        req = urllib.request.Request(self.url, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=self.timeout_seconds) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def poll_once(self) -> Dict[str, Any]:
        """Single poll; records errors instead of raising."""
        self.polls += 1
        try:
            payload = self._fetch()
            result = ingest_esp32_payload(payload, self.manager)
            self.last_success_at = time.time()
            self.last_error = None
            return result
        except Exception as exc:
            self.last_error = str(exc)
            logger.warning("ESP32 poll failed (%s): %s", self.url, exc)
            return {"accepted": 0, "rejected": 0, "errors": [str(exc)], "readings": []}

    def _run(self) -> None:
        backoff = self.interval_seconds
        while not self._stop.is_set():
            result = self.poll_once()
            if result["accepted"]:
                backoff = self.interval_seconds
            else:
                backoff = min(self.max_backoff_seconds, max(self.interval_seconds, backoff * 2))
            self._stop.wait(backoff)

    def start(self) -> "Esp32Poller":
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._run, name="Esp32Poller", daemon=True)
            self._thread.start()
            logger.info("ESP32 poller started: %s every %.1fs", self.url, self.interval_seconds)
        return self

    def stop(self) -> None:
        self._stop.set()

    def status(self) -> Dict[str, Any]:
        return {
            "url": self.url,
            "interval_seconds": self.interval_seconds,
            "polls": self.polls,
            "healthy": self.last_error is None,
            "last_error": self.last_error,
            "seconds_since_success": (round(time.time() - self.last_success_at, 1)
                                      if self.last_success_at else None),
        }


_POLLER: Optional[Esp32Poller] = None
_POLLER_LOCK = threading.Lock()


def ensure_poller_started() -> Optional[Esp32Poller]:
    """Starts the poller once, if SENSOR_POLL_URL is configured."""
    global _POLLER
    url = os.environ.get("SENSOR_POLL_URL")
    if not url:
        return None
    with _POLLER_LOCK:
        if _POLLER is None:
            _POLLER = Esp32Poller(
                url=url,
                interval_seconds=float(os.environ.get("SENSOR_POLL_SECONDS", "10")),
                timeout_seconds=float(os.environ.get("SENSOR_POLL_TIMEOUT_SECONDS", "3")),
            ).start()
        return _POLLER


def get_poller() -> Optional[Esp32Poller]:
    return _POLLER


__all__ = [
    "Esp32Poller",
    "ensure_poller_started",
    "get_poller",
    "ingest_esp32_payload",
    "normalize_esp32_payload",
]