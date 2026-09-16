"""
Hardware Abstraction Layer (HAL) for the DigitalBMS cyber-physical system.

Implements the inbound half of the architecture declared in
`hardware_architecture.md` section 2A (sensor telemetry ingest & cleaning) and
supplies the server-side "tool" the occupant chatbot uses to read real values
from the ESP32 sensor nodes attached to the Raspberry Pi gateway.

Modules:
    models           - SensorReading/SensorSnapshot contract (units, quality, provenance)
    sensor_manager   - thread-safe latest-value registry with TTL + twin fallback
    esp32_http       - ESP32 transport (HTTP push, HTTP poll, payload normalization)
    telemetry_tools  - deterministic intent/slot parsing + tool dispatch + rendering
    routes           - FastAPI endpoints for ingest/inspection

Typical wiring (environment variables):

    SENSOR_DEVICE_ZONES=esp32-01:lobby,esp32-02:open_office
    SENSOR_TTL_SECONDS=120
    SENSOR_INGEST_TOKEN=<shared-secret>          # optional but recommended
    SENSOR_POLL_URL=http://192.168.1.50/sensors  # only for poll mode
"""

from src.hardware.esp32_http import (
    Esp32Poller,
    ensure_poller_started,
    ingest_esp32_payload,
    normalize_esp32_payload,
)
from src.hardware.models import (
    Metric,
    MetricUnit,
    ReadingSource,
    SensorReading,
    SensorSnapshot,
    resolve_zone,
)
from src.hardware.sensor_manager import SensorManager, get_sensor_manager
from src.hardware.telemetry_tools import (
    ToolResult,
    answer_telemetry_query,
    parse_telemetry_query,
)
from src.hardware.mqtt_client import (
    MqttSubscriber,
    ensure_mqtt_started,
    get_mqtt_client,
)

__all__ = [
    "Esp32Poller",
    "Metric",
    "MetricUnit",
    "MqttSubscriber",
    "ReadingSource",
    "SensorManager",
    "SensorReading",
    "SensorSnapshot",
    "ToolResult",
    "answer_telemetry_query",
    "ensure_mqtt_started",
    "ensure_poller_started",
    "get_mqtt_client",
    "get_sensor_manager",
    "ingest_esp32_payload",
    "normalize_esp32_payload",
    "parse_telemetry_query",
    "resolve_zone",
]