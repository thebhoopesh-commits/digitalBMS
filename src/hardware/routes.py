"""
HAL REST endpoints: sensor ingest (ESP32 -> Pi) and state inspection.

    POST /api/sensors/ingest   ESP32 push (optional X-Sensor-Token auth)
    GET  /api/sensors          latest reading per (zone, metric) + staleness
    GET  /api/sensors/health   ingest counters, rejects, poller status
    POST /api/sensors/poll     force one poll of SENSOR_POLL_URL (debug)

These endpoints only write to the in-process registry; the chat path reads that
same registry, which is why the chatbot can answer instantly and can never hang
on an unresponsive sensor node.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from src.hardware.esp32_http import (
    ensure_poller_started,
    get_poller,
    ingest_esp32_payload,
)
from src.hardware.mqtt_client import get_mqtt_client
from src.hardware.sensor_manager import get_sensor_manager
from src.hardware.telemetry_tools import ENVIRONMENT_ZONES

logger = logging.getLogger("hvac.api.sensors")

router = APIRouter(prefix="/api/sensors", tags=["sensors"])


class SensorReadingOut(BaseModel):
    """One stored reading."""

    model_config = ConfigDict(extra="forbid")

    zone_id: str
    metric: str
    value: float
    unit: str
    sensor_id: str
    age_seconds: float
    stale: bool
    quality: float
    note: str = ""
    captured_at: Optional[float] = None


class SensorSnapshotResponse(BaseModel):
    """Body for GET /api/sensors."""

    model_config = ConfigDict(extra="forbid")

    readings: List[SensorReadingOut]
    ttl_seconds: float
    count: int


class IngestResponse(BaseModel):
    """Body for POST /api/sensors/ingest."""

    model_config = ConfigDict(extra="forbid")

    accepted: int
    rejected: int
    readings: List[Dict[str, Any]] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)


def _check_token(token: Optional[str]) -> None:
    """Guards the ingest endpoint when SENSOR_INGEST_TOKEN is configured."""
    expected = os.environ.get("SENSOR_INGEST_TOKEN")
    if not expected:
        return
    if token != expected:
        raise HTTPException(status_code=401, detail="invalid or missing X-Sensor-Token")


@router.post("/ingest", response_model=IngestResponse)
async def ingest_endpoint(
    request: Request,
    x_sensor_token: Optional[str] = Header(default=None, alias="X-Sensor-Token"),
) -> IngestResponse:
    """Accepts any of the supported ESP32 JSON shapes and QC-checks each sample."""
    _check_token(x_sensor_token)
    try:
        payload: Any = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"invalid JSON body: {exc}") from exc

    result = ingest_esp32_payload(payload)
    if result["accepted"] == 0 and result["rejected"] > 0:
        logger.warning("Sensor ingest rejected payload: %s", result.get("errors"))
    return IngestResponse(**result)


@router.get("", response_model=SensorSnapshotResponse)
async def sensors_endpoint() -> SensorSnapshotResponse:
    """Current registry contents (with staleness), for the UI/3D HUD and debugging."""
    manager = get_sensor_manager()
    readings = [SensorReadingOut(**row) for row in manager.snapshot()]
    return SensorSnapshotResponse(readings=readings,
                                  ttl_seconds=manager.ttl_seconds,
                                  count=len(readings))


@router.get("/health")
async def sensors_health_endpoint() -> Dict[str, Any]:
    """Ingest health + poller status + expected zone map for the environment."""
    health = get_sensor_manager().health()
    poller = get_poller()
    mqtt_sub = get_mqtt_client()
    health["poller"] = poller.status() if poller is not None else {
        "url": os.environ.get("SENSOR_POLL_URL"),
        "healthy": None,
        "note": "poller not configured (ESP32 push mode is expected)",
    }
    health["mqtt"] = mqtt_sub.status() if mqtt_sub is not None else {
        "connected": False,
        "note": "MQTT subscriber not initialized",
    }
    health["environments"] = ENVIRONMENT_ZONES
    return health


@router.post("/poll")
async def sensors_poll_endpoint() -> Dict[str, Any]:
    """Runs one ESP32 poll immediately (debug aid)."""
    poller = get_poller() or ensure_poller_started()
    if poller is None:
        raise HTTPException(status_code=409, detail="SENSOR_POLL_URL is not configured")
    return {"result": poller.poll_once(), "poller": poller.status()}


__all__ = ["router"]