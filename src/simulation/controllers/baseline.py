"""
ASHRAE 90.1 Industrial Baseline Dual-Setpoint HVAC Controller.
Vectorized implementation of dual-setpoint deadband logic [20.0°C, 24.0°C] with temperature-dependent
thermodynamic COP scaling and auxiliary supply fan power models.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple, Union
import numpy as np

from src.config import BuildingConfig, SimulationConfig, ZoneConfig


@dataclass
class ControllerOutput:
    """Output commands and electrical metrics produced by the baseline thermostat."""
    thermal_power_w: np.ndarray        # Heating > 0, Cooling < 0 (Watts, shape N)
    electrical_power_kw: np.ndarray   # Electrical power demand per zone (kW, shape N)
    comfort_violations_c: np.ndarray  # Degrees C outside deadband per zone (shape N)
    total_power_kw: float             # Sum of electrical power across all zones (kW)
    total_comfort_violation_c: float  # Sum of comfort violations across all zones (°C)


class ASHRAEBaselineController:
    """ASHRAE 90.1 Compliant Dual-Setpoint Deadband Thermostat Controller."""

    def __init__(
        self,
        config: Optional[BuildingConfig] = None,
        sim_config: Optional[SimulationConfig] = None,
        heating_setpoint_c: float = 20.0,
        cooling_setpoint_c: float = 24.0,
    ):
        self.config = config if config is not None else BuildingConfig()
        self.sim_config = sim_config if sim_config is not None else SimulationConfig()

        self.zone_ids = list(self.config.zones.keys())
        self.num_zones = len(self.zone_ids)

        self.heating_setpoint_c = heating_setpoint_c
        self.cooling_setpoint_c = cooling_setpoint_c
        self.nominal_setpoint_c = 22.0

        # Vectorized zone HVAC capabilities
        self.max_heat_w = np.array(
            [z.max_heating_power_w for z in self.config.zones.values()], dtype=np.float64
        )
        self.max_cool_w = np.array(
            [z.max_cooling_power_w for z in self.config.zones.values()], dtype=np.float64
        )
        self.kp_heat = np.array(
            [z.kp_heating_w_k for z in self.config.zones.values()], dtype=np.float64
        )
        self.kp_cool = np.array(
            [z.kp_cooling_w_k for z in self.config.zones.values()], dtype=np.float64
        )
        self.fan_max_kw = np.array(
            [z.fan_max_power_w / 1000.0 for z in self.config.zones.values()], dtype=np.float64
        )
        self.fan_standby_kw = np.array(
            [z.fan_standby_power_w / 1000.0 for z in self.config.zones.values()], dtype=np.float64
        )

        # Standby attribute for tests
        self.p_standby = self.fan_standby_kw

    def compute_cooling_cop(self, outdoor_temp_c: float) -> float:
        """Computes dynamic cooling COP as a function of outdoor ambient temperature.

        COP_cool(T_amb) = clamp(COP_rated - alpha * (T_amb - 35.0), 2.0, 5.2)
        """
        cop_rated = self.sim_config.cop_cooling_rated
        alpha = self.sim_config.cop_cooling_temp_coeff
        cop = cop_rated - alpha * (outdoor_temp_c - 35.0)
        return float(np.clip(cop, 2.0, 5.2))

    def compute_heating_cop(self, outdoor_temp_c: float) -> float:
        """Computes dynamic heating COP as a function of outdoor ambient temperature.

        COP_heat(T_amb) = clamp(COP_rated + beta * (T_amb - 7.0), 1.8, 4.2)
        """
        cop_rated = self.sim_config.cop_heating_rated
        beta = self.sim_config.cop_heating_temp_coeff
        cop = cop_rated + beta * (outdoor_temp_c - 7.0)
        return float(np.clip(cop, 1.8, 4.2))

    def compute_action(
        self,
        zone_temps_c: Union[List[float], np.ndarray],
        outdoor_temp_c: float,
        nlp_offsets_c: Optional[Union[List[float], np.ndarray]] = None,
    ) -> ControllerOutput:
        """Evaluates ASHRAE 90.1 dual-setpoint thermostat logic for all zones using fast vectorized ops."""
        t_z = np.asarray(zone_temps_c, dtype=np.float64)

        if nlp_offsets_c is not None:
            offsets = np.asarray(nlp_offsets_c, dtype=np.float64)
            t_heat_base = np.full(self.num_zones, self.heating_setpoint_c, dtype=np.float64)
            t_cool_base = np.full(self.num_zones, self.cooling_setpoint_c, dtype=np.float64)
            
            mask = ~np.isnan(offsets)
            safe_offsets = np.where(mask, offsets, 0.0)
            target_c = self.nominal_setpoint_c + safe_offsets
            
            t_heat = np.where(mask, target_c, t_heat_base)
            t_cool = np.where(mask, target_c, t_cool_base)
        else:
            t_heat = np.full(self.num_zones, self.heating_setpoint_c, dtype=np.float64)
            t_cool = np.full(self.num_zones, self.cooling_setpoint_c, dtype=np.float64)

        cop_cool = self.compute_cooling_cop(outdoor_temp_c)
        cop_heat = self.compute_heating_cop(outdoor_temp_c)

        # Heating error (when t_z < t_heat)
        e_heat = np.maximum(0.0, t_heat - t_z)
        # Cooling error (when t_z > t_cool)
        e_cool = np.maximum(0.0, t_z - t_cool)

        q_req_heat = np.minimum(self.max_heat_w, self.kp_heat * e_heat)
        q_req_cool = np.minimum(self.max_cool_w, self.kp_cool * e_cool)

        thermal_power_w = q_req_heat - q_req_cool
        comfort_viol_c = e_heat + e_cool

        # PLR calculation
        max_cap = np.where(thermal_power_w >= 0, self.max_heat_w, self.max_cool_w)
        plr = np.abs(thermal_power_w) / np.maximum(max_cap, 1.0)
        fan_power = self.fan_standby_kw + (self.fan_max_kw - self.fan_standby_kw) * (plr ** 0.7)

        cop = np.where(thermal_power_w >= 0, cop_heat, cop_cool)
        elec_power_kw = np.where(
            thermal_power_w != 0.0,
            (np.abs(thermal_power_w) / (cop * 1000.0)) + fan_power,
            self.fan_standby_kw,
        )

        total_kw = float(np.sum(elec_power_kw))
        total_viol = float(np.sum(comfort_viol_c))

        return ControllerOutput(
            thermal_power_w=thermal_power_w,
            electrical_power_kw=elec_power_kw,
            comfort_violations_c=comfort_viol_c,
            total_power_kw=total_kw,
            total_comfort_violation_c=total_viol,
        )

    def compute_control(
        self,
        T_z: Union[List[float], np.ndarray],
        T_amb: float,
        nlp_offsets_c: Optional[Union[List[float], np.ndarray]] = None,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Convenience method returning (thermal_power_w, electrical_power_kw)."""
        output = self.compute_action(zone_temps_c=T_z, outdoor_temp_c=T_amb, nlp_offsets_c=nlp_offsets_c)
        return output.thermal_power_w, output.electrical_power_kw
