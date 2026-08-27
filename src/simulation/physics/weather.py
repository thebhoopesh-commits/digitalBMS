"""
Stochastic Weather and Building Disturbance Generator.
Provides diurnal outdoor temperature, solar irradiance, relative humidity,
stochastic Ornstein-Uhlenbeck processes, commercial occupancy schedules,
and Time-of-Use (TOU) electricity pricing profiles with high-speed precomputed lookups.
"""

from dataclasses import dataclass
import math
from typing import Dict, List, Optional, Tuple, Union
import numpy as np

from src.config import BuildingConfig, WeatherPreset, ZoneConfig
from src.simulation.physics.psychrometrics import PsychrometricModel


@dataclass
class WeatherSnapshot:
    """Snapshot of ambient weather and building internal disturbance conditions."""
    sim_hour: float
    outdoor_temp_c: float
    outdoor_rh_pct: float
    humidity_ratio_w: float
    solar_irradiance_w_m2: float
    electricity_price_usd_kwh: float
    occupancy: np.ndarray
    internal_heat_gain_w: np.ndarray
    latent_moisture_kg_s: np.ndarray
    cloud_cover: float = 0.0



class OpenMeteoClient:
    """Fetches live weather data from Open-Meteo for the REAL_TIME preset."""
    def __init__(self, latitude=12.9184, longitude=79.1325):
        self.latitude = latitude
        self.longitude = longitude
        self._cache = None
        self._last_fetch_time = 0.0

    def fetch_24h_data(self):
        import time, urllib.request, json
        # Simple cache for 1 hour
        if self._cache and (time.time() - self._last_fetch_time < 3600):
            return self._cache

        url = f"https://api.open-meteo.com/v1/forecast?latitude={self.latitude}&longitude={self.longitude}&hourly=temperature_2m,relative_humidity_2m,shortwave_radiation"
        try:
            with urllib.request.urlopen(url) as response:
                data = json.loads(response.read().decode())
                hourly = data["hourly"]
                self._cache = {
                    "temps": hourly["temperature_2m"][:25],
                    "rh": hourly["relative_humidity_2m"][:25],
                    "solar": hourly["shortwave_radiation"][:25],
                }
                self._last_fetch_time = time.time()
                return self._cache
        except Exception as e:
            import logging
            logging.getLogger("hvac.weather").warning(f"Failed to fetch live weather: {e}")
            # Fallback data
            return {
                "temps": [22.0] * 25,
                "rh": [50.0] * 25,
                "solar": [0.0] * 25,
            }

    def get_interpolated_values(self, sim_hour: float):
        data = self.fetch_24h_data()
        h = sim_hour % 24.0
        idx1 = int(h)
        idx2 = (idx1 + 1) % 24
        t = h - idx1
        
        # Linear interpolation
        temp = data["temps"][idx1] * (1 - t) + data["temps"][idx2] * t
        rh = data["rh"][idx1] * (1 - t) + data["rh"][idx2] * t
        solar = data["solar"][idx1] * (1 - t) + data["solar"][idx2] * t
        return temp, rh, solar


class WeatherGenerator:
    """Diurnal and Stochastic Weather and Disturbance Engine."""

    # Diurnal & Envelope Preset Parameters
    PRESET_PARAMS: Dict[WeatherPreset, Dict[str, float]] = {
        WeatherPreset.SUMMER_HOT: {
            "t_mean": 30.0,
            "t_amp": 8.0,
            "rh_mean": 45.0,
            "rh_amp": 15.0,
            "i_max": 850.0,
            "cloud_cover": 0.1,
        },
        WeatherPreset.WINTER_COLD: {
            "t_mean": 2.0,
            "t_amp": 6.0,
            "rh_mean": 75.0,
            "rh_amp": 10.0,
            "i_max": 400.0,
            "cloud_cover": 0.4,
        },
        WeatherPreset.MILD_SPRING: {
            "t_mean": 18.0,
            "t_amp": 5.0,
            "rh_mean": 55.0,
            "rh_amp": 12.0,
            "i_max": 650.0,
            "cloud_cover": 0.2,
        },
        WeatherPreset.HEATWAVE_STRESS: {
            "t_mean": 38.0,
            "t_amp": 7.0,
            "rh_mean": 35.0,
            "rh_amp": 10.0,
            "i_max": 950.0,
            "cloud_cover": 0.05,
        },
        WeatherPreset.STORM_FRONT: {
            "t_mean": 15.0,
            "t_amp": 4.0,
            "rh_mean": 85.0,
            "rh_amp": 10.0,
            "i_max": 250.0,
            "cloud_cover": 0.8,
        },
    }

    def __init__(
        self,
        preset: WeatherPreset = WeatherPreset.SUMMER_HOT,
        seed: Optional[int] = None,
        enable_noise: bool = False,
        config: Optional[BuildingConfig] = None,
    ):
        self.preset = preset
        self.enable_noise = enable_noise
        self.live_weather_client = OpenMeteoClient()
        self.rng = np.random.default_rng(seed)
        self.config = config if config is not None else BuildingConfig()
        self.psychro = PsychrometricModel(config=self.config)

        self.num_zones = len(self.config.zones)
        self.max_occupancies = np.array(
            [z.max_occupancy for z in self.config.zones.values()], dtype=np.int32
        )
        self.base_equip = np.array(
            [z.base_equip_power_w for z in self.config.zones.values()],
            dtype=np.float64,
        )
        self.standby_equip = np.array(
            [z.standby_equip_power_w for z in self.config.zones.values()],
            dtype=np.float64,
        )

        # Ornstein-Uhlenbeck parameters
        self.ou_theta = 0.5
        self.ou_sigma = 0.3
        self.ou_state_temp = 0.0
        self.ou_state_rh = 0.0

        # TOU Tariff Array [24 hours]
        self.tou_price_table = np.zeros(24, dtype=np.float64)
        for h in range(24):
            if 14 <= h < 19:
                self.tou_price_table[h] = 0.28
            elif (6 <= h < 14) or (19 <= h < 22):
                self.tou_price_table[h] = 0.14
            else:
                self.tou_price_table[h] = 0.08

        # Current simulation time in seconds
        self.current_sim_time_sec = 0.0

        # Load preset parameters
        self._load_preset_params(preset)

        # Precompute 288 5-minute interval lookups for occupancy and equipment gains
        self._precompute_schedule_tables()

        # Persistent WeatherSnapshot instance to eliminate 28,800 object allocations
        self._snapshot = WeatherSnapshot(
            sim_hour=0.0,
            outdoor_temp_c=self.t_mean,
            outdoor_rh_pct=self.rh_mean,
            humidity_ratio_w=0.01,
            solar_irradiance_w_m2=0.0,
            electricity_price_usd_kwh=0.08,
            occupancy=self._occ_table[0],
            internal_heat_gain_w=self._gains_table[0],
            latent_moisture_kg_s=self._latent_table[0],
            cloud_cover=self.cloud_cover,
        )

    def _load_preset_params(self, preset: WeatherPreset) -> None:
        """Loads physical atmospheric parameters for the specified weather preset."""
        if preset == WeatherPreset.REAL_TIME:
            self.t_mean = 22.0
            self.t_amp = 0.0
            self.rh_mean = 50.0
            self.rh_amp = 0.0
            self.i_max = 800.0
            self.cloud_cover = 0.2
            self.solar_factor = 1.0
            return
        
        params = self.PRESET_PARAMS[preset]
        self.t_mean = params["t_mean"]
        self.t_amp = params["t_amp"]
        self.rh_mean = params["rh_mean"]
        self.rh_amp = params["rh_amp"]
        self.i_max = params["i_max"]
        self.cloud_cover = params["cloud_cover"]
        self.solar_factor = 1.0 - 0.75 * self.cloud_cover

    def _precompute_schedule_tables(self) -> None:
        """Precomputes lookup arrays for 288 timesteps in 24 hours (5-minute resolution)."""
        self._occ_table = np.zeros((288, self.num_zones), dtype=np.int32)
        self._gains_table = np.zeros((288, self.num_zones), dtype=np.float64)
        self._latent_table = np.zeros((288, self.num_zones), dtype=np.float64)

        for step in range(288):
            h = (step * 300.0) / 3600.0
            occ = self._calculate_occupancy_at_hour(h)
            gains, latent = self._calculate_gains_at_hour(occ, h)
            self._occ_table[step] = occ
            self._gains_table[step] = gains
            self._latent_table[step] = latent

    def reset(
        self,
        preset: Optional[WeatherPreset] = None,
        seed: Optional[int] = None,
        start_hour: float = 0.0,
    ) -> None:
        """Resets the weather generator to initial condition."""
        if seed is not None:
            self.rng = np.random.default_rng(seed)
        if preset is not None:
            self.preset = preset
            self._load_preset_params(preset)
            if hasattr(self, "_snapshot"):
                self._snapshot.cloud_cover = self.cloud_cover

        self.current_sim_time_sec = start_hour * 3600.0
        self.ou_state_temp = 0.0
        self.ou_state_rh = 0.0

    def step(self, dt_seconds: float = 300.0) -> WeatherSnapshot:
        """Advances weather simulation by dt_seconds and returns snapshot."""
        sim_hour = (self.current_sim_time_sec / 3600.0) % 24.0
        dt_hr = dt_seconds / 3600.0

        # 1. Update Ornstein-Uhlenbeck stochastic perturbations
        if self.enable_noise:
            xi_temp = self.rng.standard_normal()
            xi_rh = self.rng.standard_normal()
            self.ou_state_temp += (
                -self.ou_theta * self.ou_state_temp * dt_hr
                + self.ou_sigma * math.sqrt(dt_hr) * xi_temp
            )
            self.ou_state_rh += (
                -self.ou_theta * self.ou_state_rh * dt_hr
                + (self.ou_sigma * 2.0) * math.sqrt(dt_hr) * xi_rh
            )

        if self.preset == WeatherPreset.REAL_TIME:
            live_temp, live_rh, live_solar = self.live_weather_client.get_interpolated_values(sim_hour)
            outdoor_temp = float(live_temp + self.ou_state_temp)
            outdoor_rh = max(10.0, min(100.0, float(live_rh + self.ou_state_rh)))
            solar_irradiance = float(live_solar)
        else:
            # 2. Outdoor Ambient Temperature: sinusoidal peak at 15:00 (3 PM), min at 03:00 (3 AM)
            t_diurnal = self.t_mean + self.t_amp * math.sin(0.2617993877991494 * (sim_hour - 9.0))
            outdoor_temp = float(t_diurnal + self.ou_state_temp)
    
            # 3. Solar Irradiance: positive half-sine between 06:00 and 18:00
            if 6.0 <= sim_hour <= 18.0:
                solar_sin = math.sin(0.2617993877991494 * (sim_hour - 6.0))
                solar_irradiance = float(self.i_max * max(0.0, solar_sin) * self.solar_factor)
            else:
                solar_irradiance = 0.0
    
            # 4. Ambient Relative Humidity: inverse to temperature
            rh_diurnal = self.rh_mean - self.rh_amp * math.sin(0.2617993877991494 * (sim_hour - 9.0))
            outdoor_rh = max(10.0, min(100.0, float(rh_diurnal + self.ou_state_rh)))

        # 5. Outdoor Humidity Ratio
        p_sat = 610.78 * math.exp((17.27 * outdoor_temp) / (outdoor_temp + 237.3))
        p_v = min((outdoor_rh / 100.0) * p_sat, 101325.0 * 0.999)
        humidity_ratio = float(0.62198 * (p_v / (101325.0 - p_v)))

        # 6. Time-of-Use Electricity Price ($/kWh)
        elec_price = float(self.tou_price_table[int(sim_hour) % 24])

        # 7. Precomputed Occupancy & Internal Gains Fast Lookup
        step_idx = int(round(sim_hour * 12.0)) % 288
        occupancy = self._occ_table[step_idx]
        sensible_gains = self._gains_table[step_idx]
        latent_moisture = self._latent_table[step_idx]

        snap = self._snapshot
        snap.sim_hour = sim_hour
        snap.outdoor_temp_c = outdoor_temp
        snap.outdoor_rh_pct = outdoor_rh
        snap.humidity_ratio_w = humidity_ratio
        snap.solar_irradiance_w_m2 = solar_irradiance
        snap.electricity_price_usd_kwh = elec_price
        snap.occupancy = occupancy
        snap.internal_heat_gain_w = sensible_gains
        snap.latent_moisture_kg_s = latent_moisture

        self.current_sim_time_sec += dt_seconds
        return snap

    def get_electricity_price(self, sim_hour: float) -> float:
        """Determines TOU commercial electricity tariff rate ($/kWh)."""
        return float(self.tou_price_table[int(sim_hour) % 24])

    def _calculate_occupancy_at_hour(self, h: float) -> np.ndarray:
        """Helper to calculate occupancy at a given hour."""
        occ = np.zeros(self.num_zones, dtype=np.int32)
        if 7.5 <= h < 9.5:
            f0 = 0.85
        elif 11.5 <= h < 13.5:
            f0 = 0.70
        elif 16.5 <= h < 18.5:
            f0 = 0.80
        elif 9.5 <= h < 16.5:
            f0 = 0.35
        elif 18.5 <= h < 21.0:
            f0 = 0.10
        else:
            f0 = 0.0
        occ[0] = int(round(f0 * self.max_occupancies[0]))

        if self.num_zones > 1:
            if 8.0 <= h < 12.0:
                f1 = 0.95
            elif 12.0 <= h < 13.0:
                f1 = 0.60
            elif 13.0 <= h < 17.0:
                f1 = 0.90
            elif 17.0 <= h < 18.5:
                f1 = 0.30
            elif 7.0 <= h < 8.0 or 18.5 <= h < 20.0:
                f1 = 0.05
            else:
                f1 = 0.0
            occ[1] = int(round(f1 * self.max_occupancies[1]))

        if self.num_zones > 2:
            if 9.5 <= h < 11.5:
                f2 = 0.80
            elif 14.0 <= h < 16.0:
                f2 = 0.75
            elif 16.0 <= h < 17.5:
                f2 = 0.40
            else:
                f2 = 0.0
            occ[2] = int(round(f2 * self.max_occupancies[2]))
        return occ

    def _calculate_gains_at_hour(
        self, occupancy: np.ndarray, h: float
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Helper to calculate internal gains at a given hour."""
        is_work_hours = 7.0 <= h < 19.0
        q_occ_sensible = occupancy * 80.0
        equip_power = self.base_equip if is_work_hours else self.standby_equip
        equip_occ = occupancy * np.array([0.0, 100.0, 50.0][: self.num_zones], dtype=np.float64)
        total_sensible_gain = q_occ_sensible + equip_power + equip_occ
        latent_moisture = occupancy * (0.05 / 3600.0)
        return total_sensible_gain, latent_moisture

    def get_occupancy(self, sim_hour: float) -> np.ndarray:
        """Computes current zone occupant headcount from commercial schedules."""
        step_idx = int(round((sim_hour % 24.0) * 12.0)) % 288
        return self._occ_table[step_idx].copy()

    def get_internal_gains(
        self, occupancy: np.ndarray, sim_hour: float
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Calculates sensible heat gains (W) and latent moisture generation (kg/s)."""
        step_idx = int(round((sim_hour % 24.0) * 12.0)) % 288
        return self._gains_table[step_idx].copy(), self._latent_table[step_idx].copy()
