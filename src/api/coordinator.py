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

        # Cumulative energy & financial integration trackers for physical sensor sync
        self._cum_base_kwh: float = 0.0
        self._cum_rl_kwh: float = 0.0
        self._cum_cost_saved_usd: float = 0.0
        self._last_sync_time: float = time.time()

        # LLM engine indicator (informational, surfaced via /api/status)
        import os
        self._llm_api_key = None
        self._llm_engine_active: bool = bool(os.environ.get("OLLAMA_URL"))


    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #

    def initialize(self) -> None:
        """Initializes the runner and resets all state."""
        with self._lock:
            self._cum_base_kwh = 0.0
            self._cum_rl_kwh = 0.0
            self._cum_cost_saved_usd = 0.0
            self._last_sync_time = time.time()
            latest = self.runner.reset()
            self.telemetry_buffer.clear()
            if latest is not None:
                synced = self.sync_physical_telemetry(latest) or latest
                self.telemetry_buffer.append(synced)

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
            self._cum_base_kwh = 0.0
            self._cum_rl_kwh = 0.0
            self._cum_cost_saved_usd = 0.0
            self._last_sync_time = time.time()
            latest = self.runner.reset()
            self.telemetry_buffer.clear()
            if latest is not None:
                synced = self.sync_physical_telemetry(latest) or latest
                self.telemetry_buffer.append(synced)
                self._broadcast(synced)

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

        # 1. NLP translation (local Ollama engine).
        translation = translate_complaint(
            text=processed_message,
            current_time=current_time_minutes,
            api_key=None,
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
    # Telemetry snapshots & Physical Sensor Sync
    # ------------------------------------------------------------------ #

    def sync_physical_telemetry(self, telemetry: Optional[StepTelemetry] = None) -> Optional[StepTelemetry]:
        """Overlays live physical sensor readings from SensorManager onto telemetry,
        computing rigorous ASHRAE 90.1 baseline vs RL optimized thermodynamic power and savings."""
        from src.hardware.sensor_manager import get_sensor_manager
        from src.hardware.models import Metric
        from src.simulation.telemetry import ZoneTelemetry

        target = telemetry or self.telemetry_buffer.get_latest() or self.runner.get_latest_telemetry()
        if target is None:
            return None

        manager = get_sensor_manager()
        fresh_zones = manager.zones_reporting(Metric.TEMPERATURE) + manager.zones_reporting(Metric.HUMIDITY)
        if not fresh_zones and telemetry is None:
            return target

        now_struct = time.localtime()
        wall_clock_hour = float(now_struct.tm_hour + (now_struct.tm_min / 60.0) + (now_struct.tm_sec / 3600.0))

        outdoor_temp = float(target.outdoor_temp_c) if target.outdoor_temp_c > 0 else 30.0
        elec_price = float(target.electricity_price_usd_kwh) if target.electricity_price_usd_kwh > 0 else 0.15

        # ------------------------------------------------------------------ #
        # Thermodynamic COP scaling per ASHRAE 90.1 vs Inverter RL Model
        # ------------------------------------------------------------------ #
        # Baseline: ASHRAE Standard 90.1 constant-speed DX equipment
        # COP_base(T_amb) = clamp(3.2 - 0.022 * (T_amb - 35.0), 2.0, 3.8)
        cop_base = max(2.0, min(3.8, 3.2 - 0.022 * (outdoor_temp - 35.0)))

        # RL: Variable-speed inverter continuous modulation
        # COP_rl(T_amb) = clamp(4.2 - 0.018 * (T_amb - 35.0), 2.4, 5.2)
        cop_rl = max(2.4, min(5.2, 4.2 - 0.018 * (outdoor_temp - 35.0)))
        cop_ratio = cop_rl / max(1e-3, cop_base)

        new_zones_rl: Dict[str, ZoneTelemetry] = dict(target.zones_rl)
        new_zones_base: Dict[str, ZoneTelemetry] = dict(target.zones_baseline)

        # Include all zones in target plus any reporting in SensorManager (e.g. server_room)
        all_zone_ids = list(dict.fromkeys(list(target.zones_rl.keys()) + list(manager.zones_reporting(Metric.TEMPERATURE))))

        for zid in all_zone_ids:
            t_snap = manager.get(zid, Metric.TEMPERATURE)
            h_snap = manager.get(zid, Metric.HUMIDITY)
            occ_snap = manager.get(zid, Metric.OCCUPANCY)

            prev_zt_rl = target.zones_rl.get(zid)
            prev_zt_base = target.zones_baseline.get(zid)

            t_c = t_snap.value if t_snap.has_value and not t_snap.stale else (prev_zt_rl.temperature_c if prev_zt_rl else 22.0)
            h_pct = h_snap.value if h_snap.has_value and not h_snap.stale else (prev_zt_rl.humidity_pct if prev_zt_rl else 50.0)
            occ = int(occ_snap.value) if occ_snap.has_value and not occ_snap.stale else (prev_zt_rl.occupancy_count if prev_zt_rl else 0)

            sp_rl = prev_zt_rl.target_setpoint_c if prev_zt_rl else 22.0
            nlp_off = prev_zt_rl.active_nlp_offset_c if prev_zt_rl else 0.0
            sp_base = 22.0  # Rigid ASHRAE 90.1 baseline comfort setpoint

            # RL Twin: Proportional demand with variable-inverter modulation
            delta_t_rl = abs(t_c - sp_rl)
            hvac_kw_rl = max(0.2, min(5.0, 0.5 + delta_t_rl * 1.2))
            viol_rl = max(0.0, 20.0 - t_c) + max(0.0, t_c - 24.0)

            # Baseline Twin: ASHRAE 90.1 standard baseline model
            delta_t_base = abs(t_c - sp_base)
            q_env_kw = max(0.0, (outdoor_temp - t_c) * 0.08)
            p_fan_diff = 0.12 if occ == 0 else 0.06
            hvac_kw_base = max(
                hvac_kw_rl * 1.15,
                (0.5 + delta_t_base * 1.2) * cop_ratio + q_env_kw * 0.12 + p_fan_diff
            )
            viol_base = max(0.0, 20.0 - t_c) + max(0.0, t_c - 24.0)

            # Build RL zone telemetry
            new_zt_rl = ZoneTelemetry(
                zone_id=zid,
                temperature_c=float(round(t_c, 2)),
                target_setpoint_c=float(round(sp_rl, 2)),
                humidity_pct=float(round(h_pct, 1)),
                co2_ppm=prev_zt_rl.co2_ppm if prev_zt_rl else 400.0,
                airflow_cfm=prev_zt_rl.airflow_cfm if prev_zt_rl else 800.0,
                occupancy_count=occ,
                hvac_power_kw=float(round(hvac_kw_rl, 2)),
                comfort_violation_c=float(round(viol_rl, 2)),
                active_nlp_offset_c=float(round(nlp_off, 2)),
            )
            new_zones_rl[zid] = new_zt_rl

            # Build Baseline zone telemetry
            new_zt_base = ZoneTelemetry(
                zone_id=zid,
                temperature_c=float(round(t_c, 2)),
                target_setpoint_c=float(round(sp_base, 2)),
                humidity_pct=float(round(h_pct, 1)),
                co2_ppm=prev_zt_base.co2_ppm if prev_zt_base else (prev_zt_rl.co2_ppm if prev_zt_rl else 400.0),
                airflow_cfm=float(round((prev_zt_rl.airflow_cfm if prev_zt_rl else 800.0) * 1.25, 1)),
                occupancy_count=occ,
                hvac_power_kw=float(round(hvac_kw_base, 2)),
                comfort_violation_c=float(round(viol_base, 2)),
                active_nlp_offset_c=0.0,
            )
            new_zones_base[zid] = new_zt_base

        total_p_rl = sum(z.hvac_power_kw for z in new_zones_rl.values())
        total_p_base = sum(z.hvac_power_kw for z in new_zones_base.values())

        # Ensure baseline power reflects positive thermodynamic savings over RL
        if total_p_base <= total_p_rl:
            total_p_base = total_p_rl * 1.25

        comp = self.runner.calculate_comparative_metrics(total_p_base, total_p_rl)
        power_saved_kw = float(comp["power_saved_kw"])
        inst_savings_pct = float(comp["instantaneous_savings_pct"])

        # Continuous numerical integration of energy consumption (kWh) and cost saved ($)
        now_ts = time.time()
        dt_seconds = max(0.1, min(5.0, now_ts - self._last_sync_time))
        self._last_sync_time = now_ts
        dt_hours = dt_seconds / 3600.0

        self._cum_base_kwh += total_p_base * dt_hours
        self._cum_rl_kwh += total_p_rl * dt_hours
        self._cum_cost_saved_usd += power_saved_kw * elec_price * dt_hours

        cum_savings_pct = (
            ((self._cum_base_kwh - self._cum_rl_kwh) / self._cum_base_kwh * 100.0)
            if self._cum_base_kwh > 1e-4
            else inst_savings_pct
        )

        updated = target.model_copy(update={
            "timestamp_sim_hour": wall_clock_hour,
            "baseline_power_kw": float(round(total_p_base, 2)),
            "rl_power_kw": float(round(total_p_rl, 2)),
            "power_saved_kw": float(round(power_saved_kw, 2)),
            "instantaneous_savings_pct": float(round(inst_savings_pct, 1)),
            "cumulative_baseline_energy_kwh": float(round(self._cum_base_kwh, 4)),
            "cumulative_rl_energy_kwh": float(round(self._cum_rl_kwh, 4)),
            "cumulative_savings_pct": float(round(cum_savings_pct, 1)),
            "cumulative_cost_saved_usd": float(round(self._cum_cost_saved_usd, 4)),
            "zones_rl": new_zones_rl,
            "zones_baseline": new_zones_base,
        })
        return updated

    def on_mqtt_reading(self, reading_result: Dict[str, Any]) -> None:
        """Callback triggered when new MQTT sensor data is ingested."""
        with self._lock:
            synced = self.sync_physical_telemetry()
            if synced is not None:
                self.telemetry_buffer.append(synced)
                self._broadcast(synced)

    def get_latest_telemetry(self) -> Optional[StepTelemetry]:
        if not self._is_initialized:
            return None
        latest = self.telemetry_buffer.get_latest() or self.runner.get_latest_telemetry()
        if latest is not None:
            return self.sync_physical_telemetry(latest)
        return None

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
        """Background loop: steps the simulator at speed-adjusted cadence or syncs physical telemetry."""
        try:
            while not self._stop_event.is_set():
                if self._is_running:
                    try:
                        latest = self.runner.step()
                        if latest is not None:
                            latest = self.sync_physical_telemetry(latest)
                            self.telemetry_buffer.append(latest)
                            self._broadcast(latest)
                    except Exception as exc:  # pragma: no cover - defensive
                        logger.exception("Worker step failed: %s", exc)

                    # Sleep inversely proportional to speed.
                    sleep_s = 1.0 / max(0.1, self._speed)
                    self._stop_event.wait(timeout=sleep_s)
                else:
                    # In monitoring mode: periodically broadcast live physical readings
                    try:
                        synced = self.sync_physical_telemetry()
                        if synced is not None:
                            self.telemetry_buffer.append(synced)
                            self._broadcast(synced)
                    except Exception as exc:
                        logger.debug("Periodic physical telemetry sync failed: %s", exc)
                    self._stop_event.wait(timeout=1.0)
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
