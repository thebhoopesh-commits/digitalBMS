"""
Thread-safe closed-loop Simulation Coordinator.

Bridges between the FastAPI request loop (asyncio) and the synchronous
background simulation runner. Provides:
    * Lifecycle: start / pause / reset / set_speed
    * Chat -> NLP translation -> constraint injection pipeline
    * Snapshot accessors for /api/zones, /api/metrics, /api/stream
    * Subscriber registration for SSE broadcasts
"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from typing import Any, Callable, Deque, Dict, List, Optional, Tuple

from src.config import BuildingConfig, SimulationConfig, WeatherPreset
from src.nlp.schemas import SemanticTranslationResult
from src.nlp.translator import translate_complaint
from src.nlp.preprocessor import NLPPreprocessor
from src.simulation.dual_twin import DualTwinRunner
from src.simulation.telemetry import StepTelemetry, TelemetryBuffer

logger = logging.getLogger("hvac.api.coordinator")


class SimulationCoordinator:
    """Thread-safe coordinator linking web requests to the simulation loop."""

    def __init__(
        self,
        building_config: Optional[BuildingConfig] = None,
        sim_config: Optional[SimulationConfig] = None,
        weather_preset: WeatherPreset = WeatherPreset.SUMMER_HOT,
        seed: Optional[int] = 42,
        history_capacity: int = 1000,
        llm_api_key: Optional[str] = None,
    ) -> None:
        self._lock = threading.RLock()
        self.history_capacity = int(history_capacity)

        self.runner = DualTwinRunner(
            config=building_config or BuildingConfig(),
            seed=seed or 42,
        )

        # Independent telemetry buffer mirror so HTTP handlers always have
        # a stable read target even if the runner rebuilds itself.
        self.telemetry_buffer: TelemetryBuffer = TelemetryBuffer(capacity=self.history_capacity)

        # Lifecycle flags
        self._is_initialized: bool = False
        self._is_running: bool = False
        self._speed: float = 1.0

        # Background worker state
        self._worker_thread: Optional[threading.Thread] = None
        self._stop_event: threading.Event = threading.Event()

        # SSE subscriber registry: list of thread-safe queues
        self._subscribers: List["queue.Queue[Any]"] = []

        # LLM engine indicator (informational, surfaced via /api/status)
        self._llm_api_key = llm_api_key
        self._llm_engine_active: bool = bool(llm_api_key)


    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #

    def initialize(self) -> None:
        """Initializes the runner and resets all state."""
        with self._lock:
            latest = self.runner.reset()
            self.telemetry_buffer.clear()
            if latest is not None:
                self.telemetry_buffer.append(latest)

            self._is_initialized = True
            self._is_running = False
            self._stop_event.clear()
            if self._worker_thread is None or not self._worker_thread.is_alive():
                self._worker_thread = threading.Thread(
                    target=self._worker_loop, name="SimCoordinator-Worker", daemon=True
                )
                self._worker_thread.start()

    def is_initialized(self) -> bool:
        return self._is_initialized

    def is_running(self) -> bool:
        return self._is_running

    def get_speed(self) -> float:
        return float(self._speed)

    def shutdown(self) -> None:
        with self._lock:
            self._stop_event.set()
            self._is_running = False

    # ------------------------------------------------------------------ #
    # Control
    # ------------------------------------------------------------------ #

    def start(self) -> None:
        """Starts the background simulation worker (non-blocking)."""
        self._ensure_initialized()
        with self._lock:
            self._is_running = True
            logger.info("Background simulation worker started/resumed.")

    def pause(self) -> None:
        with self._lock:
            self._is_running = False
            logger.info("Simulation paused.")

    def set_speed(self, speed: float) -> float:
        s = float(speed)
        if s < 0:
            raise ValueError("speed must be non-negative")
        self._speed = max(0.0, min(50.0, s))
        return self._speed

    def reset(self) -> None:
        self._ensure_initialized()
        with self._lock:
            self._is_running = False
            latest = self.runner.reset()
            self.telemetry_buffer.clear()
            if latest is not None:
                self.telemetry_buffer.append(latest)
                self._broadcast(latest)

            logger.info("Simulation reset.")

    def step(self, num_steps: int = 1) -> Optional[StepTelemetry]:
        """Performs synchronous stepping (used by /api/simulation/control 'step')."""
        self._ensure_initialized()
        latest: Optional[StepTelemetry] = None
        for _ in range(max(1, int(num_steps))):
            latest = self.runner.step()
            if latest is not None:
                self.telemetry_buffer.append(latest)
                self._broadcast(latest)

        return latest

    # ------------------------------------------------------------------ #
    # Chat -> NLP -> Constraint bridge pipeline
    # ------------------------------------------------------------------ #

    def submit_chat_message(
        self,
        message: str,
        history: Optional[List[Dict[str, str]]] = None,
        current_time_minutes: Optional[float] = None,
    ) -> Tuple[SemanticTranslationResult, bool]:
        """Translates a chat message and injects any constraints into the simulator.

        Returns the NLPTranslationResult and a flag indicating whether the
        message was successfully translated into actionable constraints.
        """
        self._ensure_initialized()
        if current_time_minutes is None:
            current_time_minutes = self.get_current_sim_time_minutes()

        # Grab live state for context-aware NLP translation
        live_state = self.get_zone_states()
        latest_telemetry = self.get_latest_telemetry()
        outdoor_temp = latest_telemetry.outdoor_temp_c if latest_telemetry else 25.0

        # Layer 1 & 2: Preprocess text (Sanitize + Entity Resolution)
        processed_message = NLPPreprocessor.process(message)

        # 1. NLP translation (dual-engine; falls back automatically).
        translation = translate_complaint(
            text=processed_message,
            current_time=current_time_minutes,
            api_key=self._llm_api_key,
            live_building_state=live_state,
            outdoor_temp_c=outdoor_temp,
            history=history,
        )

        applied = False
        if translation.is_applicable and translation.events:
            # 2. Inject events into the runner via bridge.
            for c in translation.events:
                self.runner.inject_nlp_constraint(c)
            applied = True

        return translation, applied

    # ------------------------------------------------------------------ #
    # Telemetry snapshots
    # ------------------------------------------------------------------ #

    def get_latest_telemetry(self) -> Optional[StepTelemetry]:
        if not self._is_initialized:
            return None
        # Prefer buffer's most recent, falling back to runner.
        latest = self.telemetry_buffer.get_latest()
        if latest is not None:
            return latest
        return self.runner.get_latest_telemetry()

    def get_telemetry_history(self, limit: Optional[int] = None) -> List[StepTelemetry]:
        if not self._is_initialized:
            return []
        return self.telemetry_buffer.get_recent(limit if limit is not None else self.telemetry_buffer.capacity)

    def get_zone_states(self) -> Dict[str, Any]:
        """Returns the current RL-side zone states as plain dicts."""
        if not self._is_initialized:
            return {}
        latest = self.get_latest_telemetry()
        if latest is None:
            return {}
        return {
            zid: {
                "zone_id": zt.zone_id,
                "temperature_c": zt.temperature_c,
                "target_setpoint_c": zt.target_setpoint_c,
                "humidity_pct": zt.humidity_pct,
                "occupancy_count": zt.occupancy_count,
                "hvac_power_kw": zt.hvac_power_kw,
                "comfort_violation_c": zt.comfort_violation_c,
                "active_nlp_offset_c": zt.active_nlp_offset_c,
            }
            for zid, zt in latest.zones_rl.items()
        }

    def get_zone_ids(self) -> List[str]:
        if not self._is_initialized:
            return list(self.runner.config.zones.keys())
        return list(self.runner.config.zones.keys())

    def get_metrics_snapshot(self) -> Dict[str, Any]:
        """Returns the current cumulative metrics + latest telemetry snapshot."""
        latest = self.get_latest_telemetry()
        if latest is None:
            return {}
        return latest.model_dump()

    def get_summary(self) -> Dict[str, Any]:
        """Returns aggregate summary statistics over the buffered window."""
        if not self._is_initialized:
            return {"total_steps": 0}
        stats = self.telemetry_buffer.get_summary_stats()
        return stats

    def get_current_sim_time_minutes(self) -> float:
        if not self._is_initialized:
            return 0.0
        return float((self.runner.current_step * 300.0) / 60.0)

    def get_subscriber_count(self) -> int:
        return len(self._subscribers)

    # ------------------------------------------------------------------ #
    # SSE subscription registry
    # ------------------------------------------------------------------ #

    def register_subscriber(self) -> "_SseSubscriber":
        """Creates and registers a new SSE subscriber, returning its handle."""
        sub = _SseSubscriber()
        with self._lock:
            self._subscribers.append(sub.queue)
        return sub

    def unregister_subscriber(self, sub: "_SseSubscriber") -> None:
        with self._lock:
            try:
                self._subscribers.remove(sub.queue)
            except ValueError:
                pass

    def _broadcast(self, telemetry: StepTelemetry) -> None:
        """Pushes a telemetry snapshot to all subscribers."""
        if not self._subscribers:
            return
        payload = telemetry.model_dump_json()
        dead: List[Any] = []
        for q in self._subscribers:
            try:
                q.put_nowait(payload)
            except Exception:
                dead.append(q)
        for q in dead:
            try:
                self._subscribers.remove(q)
            except ValueError:
                pass

    # ------------------------------------------------------------------ #
    # Internal worker
    # ------------------------------------------------------------------ #

    def _worker_loop(self) -> None:
        """Background loop: steps the simulator at speed-adjusted cadence."""
        try:
            while not self._stop_event.is_set():
                if self._is_running:
                    try:
                        latest = self.runner.step()
                        if latest is not None:
                            self.telemetry_buffer.append(latest)
                            self._broadcast(latest)
                    except Exception as exc:  # pragma: no cover - defensive
                        logger.exception("Worker step failed: %s", exc)

                    # Sleep inversely proportional to speed.
                    # speed=1.0 -> sleep 1.0s (~1 step/sec)
                    # speed=50.0 -> sleep 0.02s (~50 steps/sec)
                    sleep_s = 1.0 / max(0.1, self._speed)
                    self._stop_event.wait(timeout=sleep_s)
                else:
                    self._stop_event.wait(timeout=0.1)
        finally:
            logger.info("Simulation worker exiting.")

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    def _ensure_initialized(self) -> None:
        if not self._is_initialized:
            self.initialize()


class _SseSubscriber:
    """Lightweight handle holding a bounded queue for SSE delivery."""

    def __init__(self) -> None:
        import queue as _queue

        self.queue: _queue.Queue[str] = _queue.Queue(maxsize=256)

    def get(self, timeout: float) -> Optional[str]:
        try:
            return self.queue.get(timeout=timeout)
        except Exception:
            return None

    def empty(self) -> bool:
        return self.queue.empty()


__all__ = ["SimulationCoordinator", "_SseSubscriber"]
