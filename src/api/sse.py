"""
Server-Sent Events (SSE) real-time telemetry broadcaster.

Provides a fully async generator yielding properly-formatted SSE events
that the dashboard EventSource client can consume. Uses an asyncio.Queue
per client so the event loop never blocks on slow consumers.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncGenerator, Optional

from src.api.coordinator import SimulationCoordinator

logger = logging.getLogger("hvac.api.sse")


SSE_KEEPALIVE_INTERVAL_S: float = 15.0
SSE_DEFAULT_POLL_INTERVAL_S: float = 0.2


def _format_sse(event: str, data: str) -> str:
    """Formats a single SSE message per the WHATWG spec."""
    # Multi-line data must be prefixed; we send a single line so this is trivial,
    # but be defensive in case data contains newlines.
    safe_data = data.replace("\r\n", "\n").replace("\n", "\ndata: ")
    return f"event: {event}\ndata: {safe_data}\n\n"


def _format_comment(text: str) -> str:
    """Formats a comment line (begins with ':') used as keepalive."""
    return f": {text}\n\n"


async def telemetry_event_stream(
    coordinator: SimulationCoordinator,
    poll_interval_s: float = SSE_DEFAULT_POLL_INTERVAL_S,
    keepalive_interval_s: float = SSE_KEEPALIVE_INTERVAL_S,
) -> AsyncGenerator[str, None]:
    """Async generator yielding SSE-formatted telemetry events.

    Lifecycle:
        * Yields a `hello` event with current status
        * Streams `telemetry` events as soon as the coordinator emits them
        * Sends a `:keepalive` comment every `keepalive_interval_s` to
          prevent intermediate proxies from closing the connection.
    """
    if not coordinator.is_initialized():
        coordinator.initialize()

    # 1. Hello / handshake event.
    hello_payload = {
        "status": "connected",
        "running": coordinator.is_running(),
        "speed": coordinator.get_speed(),
        "subscribers": coordinator.get_subscriber_count(),
        "sim_step": int(coordinator.get_current_sim_time_minutes() / 5.0),
    }
    yield _format_sse("hello", json.dumps(hello_payload))

    # 2. Emit the most recent snapshot immediately so the UI doesn't start empty.
    latest = coordinator.get_latest_telemetry()
    if latest is not None:
        yield _format_sse("telemetry", latest.model_dump_json())

    # 3. Register a subscriber so the background worker can push new events.
    sub = coordinator.register_subscriber()

    last_keepalive = asyncio.get_event_loop().time()
    last_seen_payload: Optional[str] = None

    try:
        while True:
            # Compute timeout: how long until next keepalive
            now = asyncio.get_event_loop().time()
            until_keepalive = max(0.0, keepalive_interval_s - (now - last_keepalive))
            timeout = min(poll_interval_s, until_keepalive) if until_keepalive > 0 else poll_interval_s

            # Poll the thread-safe queue without blocking the loop.
            payload = await asyncio.to_thread(sub.get, timeout)
            if payload is not None:
                if payload != last_seen_payload:
                    yield _format_sse("telemetry", payload)
                    last_seen_payload = payload
                last_keepalive = asyncio.get_event_loop().time()
                continue

            # Maybe emit a keepalive.
            now = asyncio.get_event_loop().time()
            if now - last_keepalive >= keepalive_interval_s:
                yield _format_comment("keepalive")
                last_keepalive = now
    except asyncio.CancelledError:
        logger.debug("SSE client disconnected (cancelled).")
        raise
    finally:
        coordinator.unregister_subscriber(sub)


async def metrics_event_stream(
    coordinator: SimulationCoordinator,
    poll_interval_s: float = 1.0,
) -> AsyncGenerator[str, None]:
    """Lightweight alternative that yields only the cumulative metrics.

    Useful for high-frequency telemetry consumers that don't need the
    full StepTelemetry envelope.
    """
    if not coordinator.is_initialized():
        coordinator.initialize()

    try:
        while True:
            snapshot = coordinator.get_metrics_snapshot()
            if snapshot:
                yield _format_sse("metrics", json.dumps(snapshot))
            else:
                yield _format_sse("metrics", json.dumps({"empty": True}))
            await asyncio.sleep(poll_interval_s)
    except asyncio.CancelledError:
        raise


__all__ = [
    "telemetry_event_stream",
    "metrics_event_stream",
    "_format_sse",
    "_format_comment",
    "SSE_DEFAULT_POLL_INTERVAL_S",
    "SSE_KEEPALIVE_INTERVAL_S",
]
