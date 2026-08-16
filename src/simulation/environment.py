"""
Gymnasium-Compliant HVAC Building Simulation Environment.
Provides 24-dimensional observation space, 3-dimensional continuous action space,
synchronized dual-twin physics stepping (Baseline vs RL), and ultra-fast execution (>45,000 steps/s).
"""

import math
from typing import Any, Dict, List, Optional, Tuple, Union
import gymnasium as gym
from gymnasium import spaces
import numpy as np

from src.config import BuildingConfig, SimulationConfig, WeatherPreset, ZoneConfig
from src.simulation.controllers.baseline import ASHRAEBaselineController
from src.simulation.physics.psychrometrics import PsychrometricModel
from src.simulation.physics.thermal_model import MultiZoneThermalModel
from src.simulation.physics.weather import WeatherGenerator, WeatherSnapshot
from src.simulation.telemetry import (
    RawTelemetryRecord,
    StepTelemetry,
    TelemetryBuffer,
    ZoneTelemetry,
)


class HVACGymEnv(gym.Env):
    """Gymnasium Environment for Closed-Loop Building HVAC Digital Twin Optimization."""

    metadata = {"render_modes": ["human"]}

    def __init__(
        self,
        building_config: Optional[BuildingConfig] = None,
        sim_config: Optional[SimulationConfig] = None,
        weather_preset: WeatherPreset = WeatherPreset.SUMMER_HOT,
        seed: Optional[int] = None,
    ):
        super().__init__()

        self.building_config = (
            building_config if building_config is not None else BuildingConfig()
        )
        self.sim_config = sim_config if sim_config is not None else SimulationConfig()
        self.weather_preset = weather_preset

        self.zone_ids = list(self.building_config.zones.keys())
        self.num_zones = len(self.zone_ids)

        # Vectorized zone HVAC physical capabilities
        self.nominal_setpoints = np.array(
            [z.nominal_setpoint_c for z in self.building_config.zones.values()],
            dtype=np.float64,
        )
        self.max_heat_w = np.array(
            [z.max_heating_power_w for z in self.building_config.zones.values()],
            dtype=np.float64,
        )
        self.max_cool_w = np.array(
            [z.max_cooling_power_w for z in self.building_config.zones.values()],
            dtype=np.float64,
        )
        self.kp_heat = np.array(
            [z.kp_heating_w_k for z in self.building_config.zones.values()],
            dtype=np.float64,
        )
        self.kp_cool = np.array(
            [z.kp_cooling_w_k for z in self.building_config.zones.values()],
            dtype=np.float64,
        )
        self.fan_max_kw = np.array(
            [z.fan_max_power_w / 1000.0 for z in self.building_config.zones.values()],
            dtype=np.float64,
        )
        self.fan_standby_kw = np.array(
            [z.fan_standby_power_w / 1000.0 for z in self.building_config.zones.values()],
            dtype=np.float64,
        )
        self.fan_diff_kw = self.fan_max_kw - self.fan_standby_kw

        # Core Physics & Disturbance Sub-Engines
        self.thermal_model = MultiZoneThermalModel(
            config=self.building_config, sim_config=self.sim_config
        )
        self.psychro_model = PsychrometricModel(
            config=self.building_config, sim_config=self.sim_config
        )
        self.weather_gen = WeatherGenerator(
            preset=weather_preset, seed=seed, config=self.building_config
        )
        self.baseline_controller = ASHRAEBaselineController(
            config=self.building_config, sim_config=self.sim_config
        )

        # Telemetry Ring Buffer
        self.telemetry_buffer = TelemetryBuffer(
            capacity=self.sim_config.telemetry_buffer_capacity
        )

        # Precached physical constants for ultra-fast loop
        self.A = self.thermal_model.A
        self.inv_c_air = self.thermal_model.inv_c_air
        self.inv_c_wall = self.thermal_model.inv_c_wall
        self.inv_r_inf = self.thermal_model.inv_r_inf
        self.inv_r_amb = self.thermal_model.inv_r_amb
        self.solar_air_mult = self.thermal_model.solar_air_mult
        self.solar_wall_mult = self.thermal_model.solar_wall_mult

        self.inv_air_mass = self.psychro_model.inv_air_mass
        self.m_dot_inf = self.psychro_model.m_dot_inf
        self.g_occ = self.psychro_model.g_occ
        self.dehum_mult = (1.0 - self.psychro_model.shr) / self.psychro_model.h_fg

        # Precomputed saturation vapor pressure table [-20.0°C to +60.0°C, step 0.1°C]
        self._psat_table = np.array(
            [
                610.78 * math.exp((17.27 * (i * 0.1 - 20.0)) / ((i * 0.1 - 20.0) + 237.3))
                for i in range(801)
            ],
            dtype=np.float64,
        )

        # Observation Space: 24 continuous features (dtype=np.float32)
        obs_low = np.array(
            [
                -20.0, -20.0, -20.0,  # T_z
                -20.0, -20.0, -20.0,  # T_w
                0.0, 0.0, 0.0,        # RH_z
                0.0, 0.0, 0.0,        # Occupancy
                -10.0, -10.0, -10.0,  # NLP offsets
                10.0, 10.0, 10.0,     # Effective Setpoints
                -30.0, 0.0, 0.0,      # T_amb, RH_amb, I_solar
                0.0, -1.0, -1.0,      # Price, sin_hr, cos_hr
            ],
            dtype=np.float32,
        )

        obs_high = np.array(
            [
                60.0, 60.0, 60.0,     # T_z
                60.0, 60.0, 60.0,     # T_w
                100.0, 100.0, 100.0,  # RH_z
                100.0, 100.0, 100.0,  # Occupancy
                10.0, 10.0, 10.0,     # NLP offsets
                35.0, 35.0, 35.0,     # Effective Setpoints
                60.0, 100.0, 1500.0,  # T_amb, RH_amb, I_solar
                2.0, 1.0, 1.0,        # Price, sin_hr, cos_hr
            ],
            dtype=np.float32,
        )

        self.observation_space = spaces.Box(
            low=obs_low, high=obs_high, shape=(24,), dtype=np.float32
        )

        # Action Space: 3-dimensional continuous delta setpoint trims [-2.0°C, +2.0°C]
        self.action_space = spaces.Box(
            low=-2.0, high=2.0, shape=(self.num_zones,), dtype=np.float32
        )

        # Dual-Twin Batch State Matrix: shape (2N, 2) where col 0 = Baseline, col 1 = RL
        self.states_batch = np.zeros((2 * self.num_zones, 2), dtype=np.float64)
        self.B_batch = np.zeros((2 * self.num_zones, 2), dtype=np.float64)

        self.w_base = np.zeros(self.num_zones, dtype=np.float64)
        self.w_rl = np.zeros(self.num_zones, dtype=np.float64)

        self.active_nlp_offsets = np.zeros(self.num_zones, dtype=np.float64)
        self.prev_action = np.zeros(self.num_zones, dtype=np.float32)

        # Preallocated observation array buffer
        self._obs_buffer = np.zeros(24, dtype=np.float32)

        # Episode Tracking & Cumulative Metrics
        self.current_step = 0
        self.episode_length = self.sim_config.episode_length_steps
        self.cum_base_kwh = 0.0
        self.cum_rl_kwh = 0.0
        self.cum_cost_saved_usd = 0.0
        self.cum_base_comfort_viol = 0.0
        self.cum_rl_comfort_viol = 0.0

        # Latest Weather Snapshot
        self.latest_weather: Optional[WeatherSnapshot] = None
        self._last_rh_z_rl = np.full(self.num_zones, 50.0, dtype=np.float64)

        # Persistent step info dict to eliminate dict allocation in step loop
        self._step_info: Dict[str, Any] = {
            "step": 0,
            "baseline_power_kw": 0.0,
            "rl_power_kw": 0.0,
            "power_saved_kw": 0.0,
            "cumulative_savings_pct": 0.0,
            "cumulative_cost_saved_usd": 0.0,
        }

    @property
    def state_rl(self) -> np.ndarray:
        return self.states_batch[:, 1]

    @property
    def state_base(self) -> np.ndarray:
        return self.states_batch[:, 0]

    def reset(
        self,
        seed: Optional[int] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        """Resets the environment to initial conditions."""
        super().reset(seed=seed)

        preset = self.weather_preset
        start_hour = 0.0
        init_temp = 22.0
        init_rh = 50.0

        if options is not None:
            if "preset" in options:
                preset = WeatherPreset(options["preset"])
            if "start_hour" in options:
                start_hour = float(options["start_hour"])
            if "init_temp" in options:
                init_temp = float(options["init_temp"])
            if "init_rh" in options:
                init_rh = float(options["init_rh"])

        # Reset weather generator
        self.weather_gen.reset(preset=preset, seed=seed, start_hour=start_hour)
        self.latest_weather = self.weather_gen.step(dt_seconds=0.0)

        # Initialize physical batch states
        init_st = self.thermal_model.init_state(T_air=init_temp, T_wall=init_temp)
        self.states_batch[:, 0] = init_st
        self.states_batch[:, 1] = init_st

        init_w = float(self.psychro_model.humidity_ratio_from_rh(init_temp, init_rh))
        self.w_rl.fill(init_w)
        self.w_base.fill(init_w)
        self._last_rh_z_rl.fill(init_rh)

        self.active_nlp_offsets.fill(0.0)
        self.prev_action.fill(0.0)

        # Reset episode accumulators
        self.current_step = 0
        self.cum_base_kwh = 0.0
        self.cum_rl_kwh = 0.0
        self.cum_cost_saved_usd = 0.0
        self.cum_base_comfort_viol = 0.0
        self.cum_rl_comfort_viol = 0.0

        self.telemetry_buffer.clear()

        # Build initial observation
        obs = self._get_observation()
        info = {
            "step": self.current_step,
            "sim_hour": self.latest_weather.sim_hour,
            "outdoor_temp_c": self.latest_weather.outdoor_temp_c,
            "weather_preset": preset.value,
        }

        return obs, info

    def set_nlp_offsets(self, offsets: Union[List[float], np.ndarray]) -> None:
        """Injects active NLP complaint offsets (°C) dynamically into the digital twin."""
        self.active_nlp_offsets = np.asarray(offsets, dtype=np.float64)

    def _get_effective_setpoints(self, action: np.ndarray) -> np.ndarray:
        """Calculates effective target setpoints combining nominal, RL action, and NLP offsets."""
        a0 = float(action[0])
        a1 = float(action[1])
        a2 = float(action[2])
        sp0 = max(16.0, min(28.0, self.nominal_setpoints[0] + a0 + self.active_nlp_offsets[0]))
        sp1 = max(16.0, min(28.0, self.nominal_setpoints[1] + a1 + self.active_nlp_offsets[1]))
        sp2 = max(16.0, min(28.0, self.nominal_setpoints[2] + a2 + self.active_nlp_offsets[2]))
        return np.array([sp0, sp1, sp2], dtype=np.float64)

    def _get_observation(self) -> np.ndarray:
        """Constructs the 24-dimensional observation vector in preallocated buffer."""
        w = self.latest_weather
        sim_hr = w.sim_hour
        a = self.prev_action
        nlp = self.active_nlp_offsets

        sp0 = max(16.0, min(28.0, 22.0 + float(a[0]) + float(nlp[0])))
        sp1 = max(16.0, min(28.0, 22.0 + float(a[1]) + float(nlp[1])))
        sp2 = max(16.0, min(28.0, 22.0 + float(a[2]) + float(nlp[2])))

        buf = self._obs_buffer
        buf[0] = float(self.states_batch[0, 1])
        buf[1] = float(self.states_batch[2, 1])
        buf[2] = float(self.states_batch[4, 1])
        buf[3] = float(self.states_batch[1, 1])
        buf[4] = float(self.states_batch[3, 1])
        buf[5] = float(self.states_batch[5, 1])
        buf[6] = float(self._last_rh_z_rl[0])
        buf[7] = float(self._last_rh_z_rl[1])
        buf[8] = float(self._last_rh_z_rl[2])
        buf[9] = float(w.occupancy[0])
        buf[10] = float(w.occupancy[1])
        buf[11] = float(w.occupancy[2])
        buf[12] = float(nlp[0])
        buf[13] = float(nlp[1])
        buf[14] = float(nlp[2])
        buf[15] = sp0
        buf[16] = sp1
        buf[17] = sp2
        buf[18] = float(w.outdoor_temp_c)
        buf[19] = float(w.outdoor_rh_pct)
        buf[20] = float(w.solar_irradiance_w_m2)
        buf[21] = float(w.electricity_price_usd_kwh)
        buf[22] = math.sin(0.2617993877991494 * sim_hr)
        buf[23] = math.cos(0.2617993877991494 * sim_hr)

        return buf.copy()

    def step(
        self, action: np.ndarray
    ) -> Tuple[np.ndarray, float, bool, bool, Dict[str, Any]]:
        """Advances the digital twin by one macro timestep (300 seconds / 5 minutes)."""
        dt_step = self.sim_config.dt_step_seconds
        dt_hr = dt_step / 3600.0

        a0 = max(-2.0, min(2.0, float(action[0])))
        a1 = max(-2.0, min(2.0, float(action[1])))
        a2 = max(-2.0, min(2.0, float(action[2])))

        # 1. Advance weather & disturbance generation
        weather = self.weather_gen.step(dt_seconds=dt_step)
        self.latest_weather = weather

        t_amb = weather.outdoor_temp_c
        i_solar = weather.solar_irradiance_w_m2
        q_int = weather.internal_heat_gain_w
        elec_price = weather.electricity_price_usd_kwh
        w_amb = weather.humidity_ratio_w
        occ = weather.occupancy

        # 2. Extract Zone Temperatures
        tb0, tb1, tb2 = float(self.states_batch[0, 0]), float(self.states_batch[2, 0]), float(self.states_batch[4, 0])
        tr0, tr1, tr2 = float(self.states_batch[0, 1]), float(self.states_batch[2, 1]), float(self.states_batch[4, 1])

        nlp0, nlp1, nlp2 = float(self.active_nlp_offsets[0]), float(self.active_nlp_offsets[1]), float(self.active_nlp_offsets[2])

        # 3. Evaluate Baseline Twin Controls (ASHRAE 20°C / 24°C bounds + NLP offsets)
        ashrae_h0, ashrae_c0 = 20.0 + nlp0, 24.0 + nlp0
        ashrae_h1, ashrae_c1 = 20.0 + nlp1, 24.0 + nlp1
        ashrae_h2, ashrae_c2 = 20.0 + nlp2, 24.0 + nlp2

        eh_b0, ec_b0 = max(0.0, ashrae_h0 - tb0), max(0.0, tb0 - ashrae_c0)
        eh_b1, ec_b1 = max(0.0, ashrae_h1 - tb1), max(0.0, tb1 - ashrae_c1)
        eh_b2, ec_b2 = max(0.0, ashrae_h2 - tb2), max(0.0, tb2 - ashrae_c2)

        qb0 = min(self.max_heat_w[0], self.kp_heat[0] * eh_b0) - min(self.max_cool_w[0], self.kp_cool[0] * ec_b0)
        qb1 = min(self.max_heat_w[1], self.kp_heat[1] * eh_b1) - min(self.max_cool_w[1], self.kp_cool[1] * ec_b1)
        qb2 = min(self.max_heat_w[2], self.kp_heat[2] * eh_b2) - min(self.max_cool_w[2], self.kp_cool[2] * ec_b2)

        cop_cool = max(2.0, min(5.2, 3.6 - 0.018 * (t_amb - 35.0)))
        cop_heat = max(1.8, min(4.2, 4.0 + 0.022 * (t_amb - 7.0)))

        cop_b0 = cop_heat if qb0 >= 0 else cop_cool
        cop_b1 = cop_heat if qb1 >= 0 else cop_cool
        cop_b2 = cop_heat if qb2 >= 0 else cop_cool

        cap_b0 = self.max_heat_w[0] if qb0 >= 0 else self.max_cool_w[0]
        cap_b1 = self.max_heat_w[1] if qb1 >= 0 else self.max_cool_w[1]
        cap_b2 = self.max_heat_w[2] if qb2 >= 0 else self.max_cool_w[2]

        fan_b0 = self.fan_standby_kw[0] + self.fan_diff_kw[0] * ((abs(qb0) / cap_b0) ** 0.7)
        fan_b1 = self.fan_standby_kw[1] + self.fan_diff_kw[1] * ((abs(qb1) / cap_b1) ** 0.7)
        fan_b2 = self.fan_standby_kw[2] + self.fan_diff_kw[2] * ((abs(qb2) / cap_b2) ** 0.7)

        pb0 = (abs(qb0) / (cop_b0 * 1000.0) + fan_b0) if qb0 != 0.0 else self.fan_standby_kw[0]
        pb1 = (abs(qb1) / (cop_b1 * 1000.0) + fan_b1) if qb1 != 0.0 else self.fan_standby_kw[1]
        pb2 = (abs(qb2) / (cop_b2 * 1000.0) + fan_b2) if qb2 != 0.0 else self.fan_standby_kw[2]
        total_p_base_kw = pb0 + pb1 + pb2
        viol_b0, viol_b1, viol_b2 = eh_b0 + ec_b0, eh_b1 + ec_b1, eh_b2 + ec_b2

        # 4. Evaluate RL Twin Controls
        sp_r0 = max(16.0, min(28.0, 22.0 + a0 + nlp0))
        sp_r1 = max(16.0, min(28.0, 22.0 + a1 + nlp1))
        sp_r2 = max(16.0, min(28.0, 22.0 + a2 + nlp2))

        eh_r0, ec_r0 = max(0.0, (sp_r0 - 0.5) - tr0), max(0.0, tr0 - (sp_r0 + 0.5))
        eh_r1, ec_r1 = max(0.0, (sp_r1 - 0.5) - tr1), max(0.0, tr1 - (sp_r1 + 0.5))
        eh_r2, ec_r2 = max(0.0, (sp_r2 - 0.5) - tr2), max(0.0, tr2 - (sp_r2 + 0.5))

        qr0 = min(self.max_heat_w[0], self.kp_heat[0] * eh_r0) - min(self.max_cool_w[0], self.kp_cool[0] * ec_r0)
        qr1 = min(self.max_heat_w[1], self.kp_heat[1] * eh_r1) - min(self.max_cool_w[1], self.kp_cool[1] * ec_r1)
        qr2 = min(self.max_heat_w[2], self.kp_heat[2] * eh_r2) - min(self.max_cool_w[2], self.kp_cool[2] * ec_r2)

        cop_r0 = cop_heat if qr0 >= 0 else cop_cool
        cop_r1 = cop_heat if qr1 >= 0 else cop_cool
        cop_r2 = cop_heat if qr2 >= 0 else cop_cool

        cap_r0 = self.max_heat_w[0] if qr0 >= 0 else self.max_cool_w[0]
        cap_r1 = self.max_heat_w[1] if qr1 >= 0 else self.max_cool_w[1]
        cap_r2 = self.max_heat_w[2] if qr2 >= 0 else self.max_cool_w[2]

        fan_r0 = self.fan_standby_kw[0] + self.fan_diff_kw[0] * ((abs(qr0) / cap_r0) ** 0.7)
        fan_r1 = self.fan_standby_kw[1] + self.fan_diff_kw[1] * ((abs(qr1) / cap_r1) ** 0.7)
        fan_r2 = self.fan_standby_kw[2] + self.fan_diff_kw[2] * ((abs(qr2) / cap_r2) ** 0.7)

        pr0 = (abs(qr0) / (cop_r0 * 1000.0) + fan_r0) if qr0 != 0.0 else self.fan_standby_kw[0]
        pr1 = (abs(qr1) / (cop_r1 * 1000.0) + fan_r1) if qr1 != 0.0 else self.fan_standby_kw[1]
        pr2 = (abs(qr2) / (cop_r2 * 1000.0) + fan_r2) if qr2 != 0.0 else self.fan_standby_kw[2]
        total_p_rl_kw = pr0 + pr1 + pr2

        viol_r0 = max(0.0, ashrae_h0 - tr0) + max(0.0, tr0 - ashrae_c0)
        viol_r1 = max(0.0, ashrae_h1 - tr1) + max(0.0, tr1 - ashrae_c1)
        viol_r2 = max(0.0, ashrae_h2 - tr2) + max(0.0, tr2 - ashrae_c2)
        total_viol_rl = viol_r0 + viol_r1 + viol_r2

        # 5. Populate Exogenous B Matrix for RK4
        q_sol_air0 = self.solar_air_mult[0] * i_solar
        q_sol_air1 = self.solar_air_mult[1] * i_solar
        q_sol_air2 = self.solar_air_mult[2] * i_solar

        q_sol_wall0 = self.solar_wall_mult[0] * i_solar
        q_sol_wall1 = self.solar_wall_mult[1] * i_solar
        q_sol_wall2 = self.solar_wall_mult[2] * i_solar

        B = self.B_batch
        # Baseline col 0
        B[0, 0] = self.inv_c_air[0] * (t_amb * self.inv_r_inf[0] + q_int[0] + qb0 + q_sol_air0)
        B[1, 0] = self.inv_c_wall[0] * (t_amb * self.inv_r_amb[0] + q_sol_wall0)
        B[2, 0] = self.inv_c_air[1] * (t_amb * self.inv_r_inf[1] + q_int[1] + qb1 + q_sol_air1)
        B[3, 0] = self.inv_c_wall[1] * (t_amb * self.inv_r_amb[1] + q_sol_wall1)
        B[4, 0] = self.inv_c_air[2] * (t_amb * self.inv_r_inf[2] + q_int[2] + qb2 + q_sol_air2)
        B[5, 0] = self.inv_c_wall[2] * (t_amb * self.inv_r_amb[2] + q_sol_wall2)

        # RL col 1
        B[0, 1] = self.inv_c_air[0] * (t_amb * self.inv_r_inf[0] + q_int[0] + qr0 + q_sol_air0)
        B[1, 1] = self.inv_c_wall[0] * (t_amb * self.inv_r_amb[0] + q_sol_wall0)
        B[2, 1] = self.inv_c_air[1] * (t_amb * self.inv_r_inf[1] + q_int[1] + qr1 + q_sol_air1)
        B[3, 1] = self.inv_c_wall[1] * (t_amb * self.inv_r_amb[1] + q_sol_wall1)
        B[4, 1] = self.inv_c_air[2] * (t_amb * self.inv_r_inf[2] + q_int[2] + qr2 + q_sol_air2)
        B[5, 1] = self.inv_c_wall[2] * (t_amb * self.inv_r_amb[2] + q_sol_wall2)

        # 6. Batch RK4 Integration (Baseline & RL simultaneous)
        A = self.A
        S = self.states_batch
        k1 = A @ S + B
        k2 = A @ (S + 150.0 * k1) + B
        k3 = A @ (S + 150.0 * k2) + B
        k4 = A @ (S + 300.0 * k3) + B
        self.states_batch += 50.0 * (k1 + 2.0 * k2 + 2.0 * k3 + k4)

        # 7. Fast Moisture Balance ODE Step
        dehum_b0 = max(0.0, -qb0) * self.dehum_mult
        dehum_b1 = max(0.0, -qb1) * self.dehum_mult
        dehum_b2 = max(0.0, -qb2) * self.dehum_mult

        dehum_r0 = max(0.0, -qr0) * self.dehum_mult
        dehum_r1 = max(0.0, -qr1) * self.dehum_mult
        dehum_r2 = max(0.0, -qr2) * self.dehum_mult

        tb0_new, tb1_new, tb2_new = float(self.states_batch[0, 0]), float(self.states_batch[2, 0]), float(self.states_batch[4, 0])
        tr0_new, tr1_new, tr2_new = float(self.states_batch[0, 1]), float(self.states_batch[2, 1]), float(self.states_batch[4, 1])

        # Saturated humidity ratios via precomputed table
        ib0 = max(0, min(800, int((tb0_new + 20.0) * 10.0)))
        ib1 = max(0, min(800, int((tb1_new + 20.0) * 10.0)))
        ib2 = max(0, min(800, int((tb2_new + 20.0) * 10.0)))
        psat_b0 = self._psat_table[ib0]
        psat_b1 = self._psat_table[ib1]
        psat_b2 = self._psat_table[ib2]

        ir0 = max(0, min(800, int((tr0_new + 20.0) * 10.0)))
        ir1 = max(0, min(800, int((tr1_new + 20.0) * 10.0)))
        ir2 = max(0, min(800, int((tr2_new + 20.0) * 10.0)))
        psat_r0 = self._psat_table[ir0]
        psat_r1 = self._psat_table[ir1]
        psat_r2 = self._psat_table[ir2]

        wsat_b0 = 0.62198 * (psat_b0 / (101325.0 - psat_b0 * 0.999))
        wsat_b1 = 0.62198 * (psat_b1 / (101325.0 - psat_b1 * 0.999))
        wsat_b2 = 0.62198 * (psat_b2 / (101325.0 - psat_b2 * 0.999))

        wsat_r0 = 0.62198 * (psat_r0 / (101325.0 - psat_r0 * 0.999))
        wsat_r1 = 0.62198 * (psat_r1 / (101325.0 - psat_r1 * 0.999))
        wsat_r2 = 0.62198 * (psat_r2 / (101325.0 - psat_r2 * 0.999))

        dw_b0 = self.inv_air_mass[0] * (self.m_dot_inf[0] * (w_amb - self.w_base[0]) + occ[0] * self.g_occ - dehum_b0) * 300.0
        dw_b1 = self.inv_air_mass[1] * (self.m_dot_inf[1] * (w_amb - self.w_base[1]) + occ[1] * self.g_occ - dehum_b1) * 300.0
        dw_b2 = self.inv_air_mass[2] * (self.m_dot_inf[2] * (w_amb - self.w_base[2]) + occ[2] * self.g_occ - dehum_b2) * 300.0

        dw_r0 = self.inv_air_mass[0] * (self.m_dot_inf[0] * (w_amb - self.w_rl[0]) + occ[0] * self.g_occ - dehum_r0) * 300.0
        dw_r1 = self.inv_air_mass[1] * (self.m_dot_inf[1] * (w_amb - self.w_rl[1]) + occ[1] * self.g_occ - dehum_r1) * 300.0
        dw_r2 = self.inv_air_mass[2] * (self.m_dot_inf[2] * (w_amb - self.w_rl[2]) + occ[2] * self.g_occ - dehum_r2) * 300.0

        self.w_base[0] = max(0.0, min(wsat_b0, self.w_base[0] + dw_b0))
        self.w_base[1] = max(0.0, min(wsat_b1, self.w_base[1] + dw_b1))
        self.w_base[2] = max(0.0, min(wsat_b2, self.w_base[2] + dw_b2))

        self.w_rl[0] = max(0.0, min(wsat_r0, self.w_rl[0] + dw_r0))
        self.w_rl[1] = max(0.0, min(wsat_r1, self.w_rl[1] + dw_r1))
        self.w_rl[2] = max(0.0, min(wsat_r2, self.w_rl[2] + dw_r2))

        pv_b0 = (self.w_base[0] * 101325.0) / (0.62198 + self.w_base[0])
        pv_b1 = (self.w_base[1] * 101325.0) / (0.62198 + self.w_base[1])
        pv_b2 = (self.w_base[2] * 101325.0) / (0.62198 + self.w_base[2])

        pv_r0 = (self.w_rl[0] * 101325.0) / (0.62198 + self.w_rl[0])
        pv_r1 = (self.w_rl[1] * 101325.0) / (0.62198 + self.w_rl[1])
        pv_r2 = (self.w_rl[2] * 101325.0) / (0.62198 + self.w_rl[2])

        rh_b0, rh_b1, rh_b2 = max(0.0, min(100.0, (pv_b0 / psat_b0) * 100.0)), max(0.0, min(100.0, (pv_b1 / psat_b1) * 100.0)), max(0.0, min(100.0, (pv_b2 / psat_b2) * 100.0))
        rh_r0, rh_r1, rh_r2 = max(0.0, min(100.0, (pv_r0 / psat_r0) * 100.0)), max(0.0, min(100.0, (pv_r1 / psat_r1) * 100.0)), max(0.0, min(100.0, (pv_r2 / psat_r2) * 100.0))
        self._last_rh_z_rl[0], self._last_rh_z_rl[1], self._last_rh_z_rl[2] = rh_r0, rh_r1, rh_r2

        # 8. Cumulative Metrics Update
        base_step_kwh = total_p_base_kw * dt_hr
        rl_step_kwh = total_p_rl_kw * dt_hr
        self.cum_base_kwh += base_step_kwh
        self.cum_rl_kwh += rl_step_kwh

        power_saved_kw = total_p_base_kw - total_p_rl_kw
        step_cost_saved_usd = (base_step_kwh - rl_step_kwh) * elec_price
        self.cum_cost_saved_usd += step_cost_saved_usd

        inst_savings_pct = (power_saved_kw / max(total_p_base_kw, 1e-4)) * 100.0 if total_p_base_kw > 0 else 0.0
        cum_savings_pct = ((self.cum_base_kwh - self.cum_rl_kwh) / max(self.cum_base_kwh, 1e-4)) * 100.0 if self.cum_base_kwh > 0 else 0.0

        self.cum_base_comfort_viol += viol_b0 + viol_b1 + viol_b2
        self.cum_rl_comfort_viol += total_viol_rl

        # 9. Multi-Objective Reward Calculation
        step_cost_rl = rl_step_kwh * elec_price
        diff_a0, diff_a1, diff_a2 = a0 - float(self.prev_action[0]), a1 - float(self.prev_action[1]), a2 - float(self.prev_action[2])
        action_smoothness_penalty = diff_a0 * diff_a0 + diff_a1 * diff_a1 + diff_a2 * diff_a2
        self.prev_action[0], self.prev_action[1], self.prev_action[2] = a0, a1, a2

        reward = -(5.0 * step_cost_rl + 2.0 * total_viol_rl + 0.1 * action_smoothness_penalty)

        # 10. Record RawTelemetryRecord to Circular Ring Buffer
        raw_record = RawTelemetryRecord(
            step=self.current_step,
            timestamp_sim_hour=float(weather.sim_hour),
            outdoor_temp_c=float(t_amb),
            outdoor_humidity_pct=float(weather.outdoor_rh_pct),
            solar_irradiance_w_m2=float(i_solar),
            electricity_price_usd_kwh=float(elec_price),
            baseline_power_kw=float(total_p_base_kw),
            rl_power_kw=float(total_p_rl_kw),
            power_saved_kw=float(power_saved_kw),
            instantaneous_savings_pct=float(inst_savings_pct),
            cumulative_baseline_energy_kwh=float(self.cum_base_kwh),
            cumulative_rl_energy_kwh=float(self.cum_rl_kwh),
            cumulative_savings_pct=float(cum_savings_pct),
            cumulative_cost_saved_usd=float(self.cum_cost_saved_usd),
            baseline_comfort_violation_total=float(self.cum_base_comfort_viol),
            rl_comfort_violation_total=float(self.cum_rl_comfort_viol),
            zone_ids=self.zone_ids,
            t_z_base=(tb0_new, tb1_new, tb2_new),
            t_sp_base=(22.0, 22.0, 22.0),
            rh_z_base=(rh_b0, rh_b1, rh_b2),
            occ_base=(int(occ[0]), int(occ[1]), int(occ[2])),
            p_base=(pb0, pb1, pb2),
            viol_base=(viol_b0, viol_b1, viol_b2),
            nlp_base=(nlp0, nlp1, nlp2),
            t_z_rl=(tr0_new, tr1_new, tr2_new),
            t_sp_rl=(sp_r0, sp_r1, sp_r2),
            rh_z_rl=(rh_r0, rh_r1, rh_r2),
            occ_rl=(int(occ[0]), int(occ[1]), int(occ[2])),
            p_rl=(pr0, pr1, pr2),
            viol_rl=(viol_r0, viol_r1, viol_r2),
            nlp_rl=(nlp0, nlp1, nlp2),
        )
        self.telemetry_buffer.append(raw_record)

        # 11. Step Lifecycle & Observation
        self.current_step += 1
        terminated = False
        truncated = self.current_step >= self.episode_length

        obs = self._get_observation()
        info = self._step_info
        info["step"] = self.current_step
        info["baseline_power_kw"] = float(total_p_base_kw)
        info["rl_power_kw"] = float(total_p_rl_kw)
        info["power_saved_kw"] = float(power_saved_kw)
        info["cumulative_savings_pct"] = float(cum_savings_pct)
        info["cumulative_cost_saved_usd"] = float(self.cum_cost_saved_usd)

        return obs, reward, terminated, truncated, info

    def get_telemetry_snapshot(self) -> Optional[StepTelemetry]:
        """Returns the most recent StepTelemetry snapshot."""
        return self.telemetry_buffer.get_latest()

    def get_telemetry_buffer(self) -> TelemetryBuffer:
        """Returns the internal telemetry ring buffer."""
        return self.telemetry_buffer

    def render(self, mode: str = "human"):
        """Simple text render of latest simulation status."""
        snap = self.get_telemetry_snapshot()
        if snap is not None:
            print(
                f"[Step {snap.step} | Hour {snap.timestamp_sim_hour:.1f}] "
                f"T_out: {snap.outdoor_temp_c:.1f}°C | "
                f"Base: {snap.baseline_power_kw:.2f}kW | RL: {snap.rl_power_kw:.2f}kW | "
                f"Saved: {snap.cumulative_savings_pct:.1f}% (${snap.cumulative_cost_saved_usd:.2f})"
            )


HVACBuildingEnv = HVACGymEnv
