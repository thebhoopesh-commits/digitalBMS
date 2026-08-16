"""
Psychrometric Calculations and Indoor Moisture Mass Balance Engine.
High-performance implementation of Magnus-Tetens saturation equations, vapor pressure,
relative humidity, dew point calculations, and continuous-time zone moisture ODE tracking.
"""

import math
from typing import Dict, List, Optional, Tuple, Union
import numpy as np

from src.config import BuildingConfig, SimulationConfig, ZoneConfig


class PsychrometricModel:
    """Thermodynamic Psychrometrics and Indoor Moisture Dynamics Engine."""

    def __init__(
        self,
        config: Optional[BuildingConfig] = None,
        sim_config: Optional[SimulationConfig] = None,
    ):
        self.config = config if config is not None else BuildingConfig()
        self.sim_config = sim_config if sim_config is not None else SimulationConfig()

        self.p_atm = self.sim_config.atmospheric_pressure_pa
        self.h_fg = self.sim_config.latent_heat_vaporization_j_kg
        self.shr = self.sim_config.sensible_heat_ratio

        # Calibrated occupant moisture emission rate: 50 g/h/person = 1.3889e-5 kg/s/person
        self.g_occ = 0.05 / 3600.0

        # Vectorized zone parameters
        self.zone_ids = list(self.config.zones.keys())
        self.num_zones = len(self.zone_ids)
        self.air_mass = np.array(
            [z.air_mass_kg for z in self.config.zones.values()], dtype=np.float64
        )
        self.ach = np.array(
            [z.infiltration_ach for z in self.config.zones.values()], dtype=np.float64
        )
        # Infiltration mass flow rate (kg/s) = air_mass * (ACH / 3600)
        self.m_dot_inf = self.air_mass * (self.ach / 3600.0)
        self.inv_air_mass = 1.0 / self.air_mass

    def saturation_vapor_pressure(self, temp_c: Union[float, np.ndarray]) -> Union[float, np.ndarray]:
        """Calculates saturation vapor pressure P_sat (Pascals) using Magnus-Tetens formula.

        P_sat(T) = 610.78 * exp( (17.27 * T) / (T + 237.3) )
        """
        if isinstance(temp_c, np.ndarray):
            return 610.78 * np.exp((17.27 * temp_c) / (temp_c + 237.3))
        return 610.78 * math.exp((17.27 * temp_c) / (temp_c + 237.3))

    def partial_vapor_pressure(
        self, w: Union[float, np.ndarray], p_atm: Optional[float] = None
    ) -> Union[float, np.ndarray]:
        """Calculates partial water vapor pressure P_v (Pascals) from humidity ratio w (kg/kg).

        P_v = (w * P_atm) / (0.62198 + w)
        """
        p = p_atm if p_atm is not None else self.p_atm
        if isinstance(w, np.ndarray):
            w_clamped = np.maximum(0.0, w)
            return (w_clamped * p) / (0.62198 + w_clamped)
        w_clamped = max(0.0, float(w))
        return (w_clamped * p) / (0.62198 + w_clamped)

    def relative_humidity(
        self,
        temp_c: Union[float, np.ndarray],
        w: Union[float, np.ndarray],
        p_atm: Optional[float] = None,
    ) -> Union[float, np.ndarray]:
        """Calculates Relative Humidity (%) clamped to [0.0%, 100.0%].

        RH = (P_v / P_sat(T)) * 100%
        """
        p = p_atm if p_atm is not None else self.p_atm
        if isinstance(temp_c, np.ndarray) or isinstance(w, np.ndarray):
            t_arr = np.asarray(temp_c, dtype=np.float64)
            w_arr = np.asarray(w, dtype=np.float64)
            p_sat = 610.78 * np.exp((17.27 * t_arr) / (t_arr + 237.3))
            w_clamped = np.maximum(0.0, w_arr)
            p_v = (w_clamped * p) / (0.62198 + w_clamped)
            rh = (p_v / np.maximum(p_sat, 1e-6)) * 100.0
            return np.clip(rh, 0.0, 100.0)

        p_sat = 610.78 * math.exp((17.27 * temp_c) / (temp_c + 237.3))
        w_clamped = max(0.0, float(w))
        p_v = (w_clamped * p) / (0.62198 + w_clamped)
        rh = (p_v / max(p_sat, 1e-6)) * 100.0
        return max(0.0, min(100.0, rh))

    def humidity_ratio_from_rh(
        self,
        temp_c: Union[float, np.ndarray],
        rh_pct: Union[float, np.ndarray],
        p_atm: Optional[float] = None,
    ) -> Union[float, np.ndarray]:
        """Calculates humidity ratio w (kg water / kg dry air) from Relative Humidity (%)."""
        p = p_atm if p_atm is not None else self.p_atm

        if isinstance(rh_pct, np.ndarray) or isinstance(temp_c, np.ndarray):
            t_arr = np.asarray(temp_c, dtype=np.float64)
            rh_arr = np.asarray(rh_pct, dtype=np.float64)
            p_sat = 610.78 * np.exp((17.27 * t_arr) / (t_arr + 237.3))
            rh_clamped = np.clip(rh_arr, 0.0, 100.0)
            p_v = (rh_clamped / 100.0) * p_sat
            p_v = np.minimum(p_v, p * 0.999)
            return 0.62198 * (p_v / (p - p_v))

        p_sat = 610.78 * math.exp((17.27 * temp_c) / (temp_c + 237.3))
        rh_clamped = max(0.0, min(100.0, float(rh_pct)))
        p_v = (rh_clamped / 100.0) * p_sat
        p_v = min(p_v, p * 0.999)
        return 0.62198 * (p_v / (p - p_v))

    def dew_point(
        self,
        temp_c: Union[float, np.ndarray],
        rh_pct: Union[float, np.ndarray],
    ) -> Union[float, np.ndarray]:
        """Calculates Dew Point temperature (°C) using Magnus-Tetens inverse."""
        if isinstance(temp_c, np.ndarray) or isinstance(rh_pct, np.ndarray):
            t_arr = np.asarray(temp_c, dtype=np.float64)
            rh_arr = np.asarray(rh_pct, dtype=np.float64)
            rh_safe = np.clip(rh_arr, 1e-4, 100.0)
            alpha = (17.27 * t_arr) / (237.3 + t_arr) + np.log(rh_safe / 100.0)
            return (237.3 * alpha) / (17.27 - alpha)

        rh_safe = max(1e-4, min(100.0, float(rh_pct)))
        alpha = (17.27 * temp_c) / (237.3 + temp_c) + math.log(rh_safe / 100.0)
        return (237.3 * alpha) / (17.27 - alpha)

    def step_moisture(
        self,
        w_z: Union[float, np.ndarray],
        w_amb: float,
        N_occ: Union[int, np.ndarray],
        m_dehum: Union[float, np.ndarray] = 0.0,
        dt: float = 300.0,
        air_mass: Optional[Union[float, np.ndarray]] = None,
        ach: Optional[Union[float, np.ndarray]] = None,
    ) -> Union[float, np.ndarray]:
        """Steps the moisture mass balance ODE over interval dt."""
        if air_mass is None:
            m_air = self.air_mass if isinstance(w_z, np.ndarray) else self.air_mass[0]
            inv_m_air = self.inv_air_mass if isinstance(w_z, np.ndarray) else self.inv_air_mass[0]
        else:
            m_air = air_mass
            inv_m_air = 1.0 / air_mass

        if ach is None:
            m_inf = self.m_dot_inf if isinstance(w_z, np.ndarray) else self.m_dot_inf[0]
        else:
            m_inf = m_air * (ach / 3600.0)

        m_occ = N_occ * self.g_occ
        dw_dt = inv_m_air * (m_inf * (w_amb - w_z) + m_occ - m_dehum)

        w_next = w_z + dw_dt * dt
        if isinstance(w_next, np.ndarray):
            return np.maximum(0.0, w_next)
        return max(0.0, float(w_next))

    def step_moisture_with_condensation(
        self,
        w_z: Union[float, np.ndarray],
        temp_c: Union[float, np.ndarray],
        w_amb: float,
        N_occ: Union[int, np.ndarray],
        dt: float = 300.0,
        air_mass: Optional[Union[float, np.ndarray]] = None,
        ach: Optional[Union[float, np.ndarray]] = None,
        m_dehum: Union[float, np.ndarray] = 0.0,
    ) -> Tuple[Union[float, np.ndarray], Union[float, np.ndarray]]:
        """Steps moisture balance and extracts liquid condensation if saturation limit is exceeded."""
        w_stepped = self.step_moisture(
            w_z=w_z,
            w_amb=w_amb,
            N_occ=N_occ,
            m_dehum=m_dehum,
            dt=dt,
            air_mass=air_mass,
            ach=ach,
        )

        w_sat = self.humidity_ratio_from_rh(temp_c, 100.0)

        if air_mass is None:
            m_air = self.air_mass if isinstance(w_z, np.ndarray) else self.air_mass[0]
        else:
            m_air = air_mass

        if isinstance(w_stepped, np.ndarray):
            excess_w = np.maximum(0.0, w_stepped - w_sat)
            condensed_kg = excess_w * m_air
            w_final = np.minimum(w_stepped, w_sat)
            return w_final, condensed_kg

        excess_w = max(0.0, w_stepped - w_sat)
        condensed_kg = excess_w * m_air
        w_final = min(w_stepped, w_sat)
        return w_final, condensed_kg

    def compute_dehumidification_rate(
        self, Q_hvac_cooling_w: Union[float, np.ndarray]
    ) -> Union[float, np.ndarray]:
        """Calculates moisture condensation extraction rate m_dehum (kg/s) by cooling coil."""
        mult = (1.0 - self.shr) / self.h_fg
        if isinstance(Q_hvac_cooling_w, np.ndarray):
            q_cool = np.maximum(0.0, -Q_hvac_cooling_w)
            return q_cool * mult

        q_cool = max(0.0, -float(Q_hvac_cooling_w))
        return q_cool * mult
