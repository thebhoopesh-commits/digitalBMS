"""
MQTT Telemetry Subscriber for Raspberry Pi & ESP32 Sensor Ingestion.

Connects to the Mosquitto MQTT broker on the Raspberry Pi (default: 10.100.177.51:1883),
subscribes to digitalbms/sensors/#, and feeds live payloads into SensorManager.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from typing import Any, Callable, Dict, List, Optional

import paho.mqtt.client as mqtt

from src.hardware.esp32_http import ingest_esp32_payload
from src.hardware.sensor_manager import SensorManager, get_sensor_manager

logger = logging.getLogger("hvac.hardware.mqtt")

DEFAULT_BROKER_HOST = "10.100.177.51"
DEFAULT_BROKER_PORT = 1883
DEFAULT_TOPICS = ["digitalbms/sensors/#"]


class MqttSubscriber:
    """Thread-safe MQTT client that subscribes to physical sensor topics."""

    def __init__(
        self,
        broker_host: str = DEFAULT_BROKER_HOST,
        broker_port: int = DEFAULT_BROKER_PORT,
        topics: Optional[List[str]] = None,
        manager: Optional[SensorManager] = None,
        client_id: Optional[str] = None,
        on_reading_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> None:
        import uuid
        self.broker_host = broker_host
        self.broker_port = int(broker_port)
        self.topics = topics or list(DEFAULT_TOPICS)
        self.manager = manager or get_sensor_manager()
        base_id = client_id or "digitaltwin_dashboard"
        self.client_id = f"{base_id}_{os.getpid()}_{uuid.uuid4().hex[:6]}"
        self.on_reading_callback = on_reading_callback

        self._lock = threading.RLock()
        self._is_connected: bool = False
        self._is_running: bool = False
        self._messages_received: int = 0
        self._last_message_at: Optional[float] = None
        self._last_error: Optional[str] = None

        # Configure paho-mqtt client (v2 callback API)
        try:
            self._client = mqtt.Client(
                callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                client_id=self.client_id,
            )
        except (AttributeError, TypeError):
            # Fallback for older paho-mqtt versions
            self._client = mqtt.Client(client_id=self.client_id)

        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message

    def _on_connect(self, client: Any, userdata: Any, flags: Any, rc: Any, properties: Any = None) -> None:
        rc_code = getattr(rc, "value", rc)
        with self._lock:
            if rc_code == 0:
                self._is_connected = True
                self._last_error = None
                logger.info(
                    "Connected to MQTT broker at %s:%d (client_id=%s)",
                    self.broker_host, self.broker_port, self.client_id
                )
                for topic in self.topics:
                    client.subscribe(topic)
                    logger.info("Subscribed to MQTT topic: %s", topic)
            else:
                self._is_connected = False
                self._last_error = f"Connect failed with code {rc_code}"
                logger.warning("MQTT connection failed with code: %s", rc_code)

    def _on_disconnect(self, client: Any, userdata: Any, flags: Any, rc: Any = 0, properties: Any = None) -> None:
        rc_code = getattr(rc, "value", rc)
        with self._lock:
            self._is_connected = False
            if rc_code != 0:
                logger.warning("Disconnected from MQTT broker (rc=%s)", rc)
            else:
                logger.info("Disconnected cleanly from MQTT broker")

    def _on_message(self, client: Any, userdata: Any, msg: Any) -> None:
        try:
            payload_str = msg.payload.decode("utf-8", errors="replace")
            payload_json = json.loads(payload_str)
        except Exception as exc:
            logger.debug("Failed to decode MQTT message on topic %s: %s", msg.topic, exc)
            return

        with self._lock:
            self._messages_received += 1
            self._last_message_at = time.time()

        # Ingest through HAL pipeline
        result = ingest_esp32_payload(payload_json, self.manager)

        # Notify any listener (e.g. coordinator for immediate broadcast)
        if self.on_reading_callback is not None and result.get("accepted", 0) > 0:
            try:
                self.on_reading_callback(result)
            except Exception as exc:
                logger.debug("Error in MQTT on_reading_callback: %s", exc)

    def start(self) -> "MqttSubscriber":
        """Starts the MQTT network loop in a background thread."""
        with self._lock:
            if not self._is_running:
                try:
                    self._client.connect_async(self.broker_host, self.broker_port, keepalive=60)
                    self._client.loop_start()
                    self._is_running = True
                    logger.info("MQTT background loop started for %s:%d", self.broker_host, self.broker_port)
                except Exception as exc:
                    self._last_error = str(exc)
                    logger.error("Failed to start MQTT subscriber: %s", exc)
        return self

    def stop(self) -> None:
        """Stops the MQTT client loop and disconnects."""
        with self._lock:
            if self._is_running:
                try:
                    self._client.loop_stop()
                    self._client.disconnect()
                except Exception as exc:
                    logger.debug("Error stopping MQTT subscriber: %s", exc)
                self._is_running = False
                self._is_connected = False
                logger.info("MQTT subscriber stopped.")

    def is_connected(self) -> bool:
        with self._lock:
            return self._is_connected

    def status(self) -> Dict[str, Any]:
        now = time.time()
        with self._lock:
            return {
                "broker_host": self.broker_host,
                "broker_port": self.broker_port,
                "topics": self.topics,
                "connected": self._is_connected,
                "running": self._is_running,
                "messages_received": self._messages_received,
                "last_message_at": self._last_message_at,
                "seconds_since_last_message": (
                    round(now - self._last_message_at, 1) if self._last_message_at else None
                ),
                "last_error": self._last_error,
            }


_MQTT_SUBSCRIBER: Optional[MqttSubscriber] = None
_MQTT_LOCK = threading.Lock()


def get_mqtt_client() -> Optional[MqttSubscriber]:
    return _MQTT_SUBSCRIBER


def ensure_mqtt_started(
    on_reading_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Optional[MqttSubscriber]:
    """Starts the process-wide MQTT subscriber using environment configuration."""
    global _MQTT_SUBSCRIBER

    host = os.environ.get("MQTT_BROKER_HOST", DEFAULT_BROKER_HOST)
    port = int(os.environ.get("MQTT_BROKER_PORT", str(DEFAULT_BROKER_PORT)))
    raw_topics = os.environ.get("MQTT_TOPICS")
    topics = [t.strip() for t in raw_topics.split(",")] if raw_topics else DEFAULT_TOPICS

    with _MQTT_LOCK:
        if _MQTT_SUBSCRIBER is None:
            _MQTT_SUBSCRIBER = MqttSubscriber(
                broker_host=host,
                broker_port=port,
                topics=topics,
                on_reading_callback=on_reading_callback,
            ).start()
        return _MQTT_SUBSCRIBER


__all__ = ["MqttSubscriber", "get_mqtt_client", "ensure_mqtt_started"]
