"""
Real-Time Telemetry Models and High-Throughput Thread-Safe Circular Ring Buffer.
Conforms strictly to PROJECT.md schemas (ZoneTelemetry, StepTelemetry).
"""

from collections import deque
from dataclasses import dataclass
import threading
from typing import Any, Dict, List, Optional, Tuple, Union
import numpy as np
from pydantic import BaseModel, ConfigDict, Field


class ZoneTelemetry(BaseModel):
    """Real-time physical and operational telemetry for a single zone."""
    model_config = ConfigDict(extra="forbid")

    zone_id: str = Field(description="Zone unique identifier")
    temperature_c: float = Field(description="Indoor dry-bulb air temperature (°C)")
    target_setpoint_c: float = Field(description="Active target temperature setpoint (°C)")
    humidity_pct: float = Field(description="Indoor relative humidity (%)")
    occupancy_count: int = Field(description="Current occupant headcount")
    hvac_power_kw: float = Field(description="Active HVAC electrical power consumption (kW)")
    comfort_violation_c: float = Field(description="Deviation outside comfort bounds (°C)")
    active_nlp_offset_c: float = Field(description="Current NLP constraint temperature offset (°C)")


class StepTelemetry(BaseModel):
    """Comprehensive snapshot of building, weather, and dual-twin performance at a single timestep."""
    model_config = ConfigDict(extra="forbid")

    step: int = Field(description="Simulation macro step index")
    timestamp_sim_hour: float = Field(description="Time of day in simulation hours [0.0, 24.0)")
    outdoor_temp_c: float = Field(description="Outdoor ambient dry-bulb temperature (°C)")
    outdoor_humidity_pct: float = Field(description="Outdoor ambient relative humidity (%)")
    solar_irradiance_w_m2: float = Field(description="Global horizontal solar irradiance (W/m^2)")
    electricity_price_usd_kwh: float = Field(description="Time-of-Use electricity price ($/kWh)")

    # Instantaneous Power Comparison
    baseline_power_kw: float = Field(description="Baseline twin total electrical power (kW)")
    rl_power_kw: float = Field(description="RL twin total electrical power (kW)")
    power_saved_kw: float = Field(description="Instantaneous electrical power saved (kW)")
    instantaneous_savings_pct: float = Field(description="Instantaneous energy savings percentage (%)")

    # Cumulative Metrics
    cumulative_baseline_energy_kwh: float = Field(description="Cumulative baseline HVAC energy consumed (kWh)")
    cumulative_rl_energy_kwh: float = Field(description="Cumulative RL HVAC energy consumed (kWh)")
    cumulative_savings_pct: float = Field(description="Cumulative energy savings percentage (%)")
    cumulative_cost_saved_usd: float = Field(description="Cumulative financial electricity cost saved ($)")

    # Cumulative Comfort Violations
    baseline_comfort_violation_total: float = Field(description="Cumulative baseline comfort violation integral (°C·step)")
    rl_comfort_violation_total: float = Field(description="Cumulative RL comfort violation integral (°C·step)")

    # Multi-Zone Breakdowns
    zones_baseline: Dict[str, ZoneTelemetry] = Field(description="Zone telemetry mapping for baseline twin")
    zones_rl: Dict[str, ZoneTelemetry] = Field(description="Zone telemetry mapping for RL twin")


@dataclass
class RawTelemetryRecord:
    """Lightweight in-memory record for high-speed simulation stepping (>30,000 steps/s)."""
    step: int
    timestamp_sim_hour: float
    outdoor_temp_c: float
    outdoor_humidity_pct: float
    solar_irradiance_w_m2: float
    electricity_price_usd_kwh: float
    baseline_power_kw: float
    rl_power_kw: float
    power_saved_kw: float
    instantaneous_savings_pct: float
    cumulative_baseline_energy_kwh: float
    cumulative_rl_energy_kwh: float
    cumulative_savings_pct: float
    cumulative_cost_saved_usd: float
    baseline_comfort_violation_total: float
    rl_comfort_violation_total: float
    zone_ids: List[str]
    t_z_base: Tuple[float, ...]
    t_sp_base: Tuple[float, ...]
    rh_z_base: Tuple[float, ...]
    occ_base: Tuple[int, ...]
    p_base: Tuple[float, ...]
    viol_base: Tuple[float, ...]
    nlp_base: Tuple[float, ...]
    t_z_rl: Tuple[float, ...]
    t_sp_rl: Tuple[float, ...]
    rh_z_rl: Tuple[float, ...]
    occ_rl: Tuple[int, ...]
    p_rl: Tuple[float, ...]
    viol_rl: Tuple[float, ...]
    nlp_rl: Tuple[float, ...]

    def to_step_telemetry(self) -> StepTelemetry:
        """Converts raw record into validated Pydantic StepTelemetry instance."""
        zones_base = {
            zid: ZoneTelemetry(
                zone_id=zid,
                temperature_c=float(self.t_z_base[i]),
                target_setpoint_c=float(self.t_sp_base[i]),
                humidity_pct=float(self.rh_z_base[i]),
                occupancy_count=int(self.occ_base[i]),
                hvac_power_kw=float(self.p_base[i]),
                comfort_violation_c=float(self.viol_base[i]),
                active_nlp_offset_c=float(self.nlp_base[i]),
            )
            for i, zid in enumerate(self.zone_ids)
        }

        zones_rl = {
            zid: ZoneTelemetry(
                zone_id=zid,
                temperature_c=float(self.t_z_rl[i]),
                target_setpoint_c=float(self.t_sp_rl[i]),
                humidity_pct=float(self.rh_z_rl[i]),
                occupancy_count=int(self.occ_rl[i]),
                hvac_power_kw=float(self.p_rl[i]),
                comfort_violation_c=float(self.viol_rl[i]),
                active_nlp_offset_c=float(self.nlp_rl[i]),
            )
            for i, zid in enumerate(self.zone_ids)
        }

        return StepTelemetry(
            step=self.step,
            timestamp_sim_hour=self.timestamp_sim_hour,
            outdoor_temp_c=self.outdoor_temp_c,
            outdoor_humidity_pct=self.outdoor_humidity_pct,
            solar_irradiance_w_m2=self.solar_irradiance_w_m2,
            electricity_price_usd_kwh=self.electricity_price_usd_kwh,
            baseline_power_kw=self.baseline_power_kw,
            rl_power_kw=self.rl_power_kw,
            power_saved_kw=self.power_saved_kw,
            instantaneous_savings_pct=self.instantaneous_savings_pct,
            cumulative_baseline_energy_kwh=self.cumulative_baseline_energy_kwh,
            cumulative_rl_energy_kwh=self.cumulative_rl_energy_kwh,
            cumulative_savings_pct=self.cumulative_savings_pct,
            cumulative_cost_saved_usd=self.cumulative_cost_saved_usd,
            baseline_comfort_violation_total=self.baseline_comfort_violation_total,
            rl_comfort_violation_total=self.rl_comfort_violation_total,
            zones_baseline=zones_base,
            zones_rl=zones_rl,
        )


class TelemetryBuffer:
    """High-throughput thread-safe circular ring buffer for real-time telemetry streaming."""

    def __init__(self, capacity: int = 1000):
        self.capacity = capacity
        self._buffer: deque[Union[StepTelemetry, RawTelemetryRecord, dict]] = deque(
            maxlen=capacity
        )
        self._lock = threading.RLock()
        self._latest_json_cache: Optional[str] = None

    def _to_step_telemetry(
        self, item: Union[StepTelemetry, RawTelemetryRecord, dict]
    ) -> StepTelemetry:
        """Converts buffer entry into StepTelemetry."""
        if isinstance(item, StepTelemetry):
            return item
        if isinstance(item, RawTelemetryRecord):
            return item.to_step_telemetry()
        if isinstance(item, dict):
            return StepTelemetry.model_validate(item)
        raise TypeError(f"Unsupported telemetry item type: {type(item)}")

    def append(self, item: Union[StepTelemetry, RawTelemetryRecord, dict]) -> None:
        """Appends a new telemetry snapshot to the circular buffer (atomic C-level deque)."""
        self._buffer.append(item)
        self._latest_json_cache = None

    def get_latest(self) -> Optional[StepTelemetry]:
        """Returns the most recent StepTelemetry snapshot, or None if buffer is empty."""
        with self._lock:
            if not self._buffer:
                return None
            item = self._buffer[-1]
            if isinstance(item, StepTelemetry):
                return item
            model = self._to_step_telemetry(item)
            self._buffer[-1] = model
            return model

    def get_recent(self, n: int = 100) -> List[StepTelemetry]:
        """Returns the n most recent StepTelemetry snapshots in chronological order."""
        with self._lock:
            if not self._buffer:
                return []
            slice_n = min(n, len(self._buffer))
            raw_slice = list(self._buffer)[-slice_n:]
            return [self._to_step_telemetry(item) for item in raw_slice]

    def get_all(self) -> List[StepTelemetry]:
        """Returns all snapshots currently stored in the ring buffer."""
        with self._lock:
            return [self._to_step_telemetry(item) for item in self._buffer]

    def get_latest_json(self) -> str:
        """Returns the serialized JSON string of the latest snapshot with fast caching."""
        with self._lock:
            if self._latest_json_cache is not None:
                return self._latest_json_cache
            latest = self.get_latest()
            if latest is None:
                return "{}"
            self._latest_json_cache = latest.model_dump_json()
            return self._latest_json_cache

    def clear(self) -> None:
        """Clears all stored snapshots in the buffer."""
        with self._lock:
            self._buffer.clear()
            self._latest_json_cache = None

    def get_summary_stats(self) -> Dict[str, Any]:
        """Calculates aggregate statistics over the currently buffered simulation window."""
        with self._lock:
            if not self._buffer:
                return {
                    "total_steps": 0,
                    "cumulative_saved_kwh": 0.0,
                    "cumulative_cost_saved_usd": 0.0,
                    "average_savings_pct": 0.0,
                    "max_instantaneous_savings_pct": 0.0,
                }

            latest = self.get_latest()
            if latest is None:
                return {}
            saved_kwh = (
                latest.cumulative_baseline_energy_kwh
                - latest.cumulative_rl_energy_kwh
            )
            return {
                "total_steps": len(self._buffer),
                "cumulative_saved_kwh": float(saved_kwh),
                "cumulative_cost_saved_usd": float(latest.cumulative_cost_saved_usd),
                "cumulative_savings_pct": float(latest.cumulative_savings_pct),
                "latest_baseline_power_kw": float(latest.baseline_power_kw),
                "latest_rl_power_kw": float(latest.rl_power_kw),
                "latest_outdoor_temp_c": float(latest.outdoor_temp_c),
            }

    def __len__(self) -> int:
        with self._lock:
            return len(self._buffer)

    def __iter__(self):
        with self._lock:
            return iter([self._to_step_telemetry(item) for item in self._buffer])
