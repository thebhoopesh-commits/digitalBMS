from typing import Optional, List, Dict, Any
import numpy as np

from src.config import BuildingConfig, ZoneConfig
from src.simulation.physics.thermal_model import MultiZoneThermalModel
from src.simulation.physics.psychrometrics import PsychrometricModel
from src.simulation.physics.weather import WeatherGenerator, WeatherSnapshot
from src.simulation.controllers.baseline import ASHRAEBaselineController
from src.simulation.controllers.rl_agent import FastTabularRLPolicy, RewardEngine
from src.simulation.telemetry import StepTelemetry, ZoneTelemetry
from src.nlp.schemas import ZoneConstraint

class StatefulTwin:
    def __init__(self, config: BuildingConfig, psychro: PsychrometricModel):
        self.config = config
        self.model = MultiZoneThermalModel(config)
        self.psychro = psychro
        self.state: Optional[np.ndarray] = None
        self.state_tz: Dict[str, float] = {}
        self.state_w: Dict[str, float] = {}
        self.reset(22.0)

    def reset(self, t_init: float = 22.0):
        self.state = self.model.init_state(t_init, t_init)
        # 50% RH at 22C is approx 0.008 humidity ratio
        self.state_tz = {z.zone_id: t_init for z in self.config.zones.values()}
        self.state_w = {z.zone_id: 0.008 for z in self.config.zones.values()}

    def step(self, dt: float, w: WeatherSnapshot, q_hvac: Dict[str, float], occupancies: Dict[str, int]):
        q_arr = np.zeros(len(self.config.zones))
        for i, z in enumerate(self.config.zones.values()):
            q_arr[i] = q_hvac.get(z.zone_id, 0.0) * 1000.0 # kW to W
        
        occ_arr = np.array([occupancies.get(z.zone_id, 0) for z in self.config.zones.values()])
        
        self.state = self.model.step(
            state=self.state,
            T_amb=w.outdoor_temp_c,
            I_solar=w.solar_irradiance_w_m2,
            Q_hvac=q_arr,
            dt=dt
        )
        t_air_arr = self.model.get_air_temperatures(self.state)
        
        w_curr = np.array([self.state_w[z.zone_id] for z in self.config.zones.values()])
        w_amb = self.psychro.humidity_ratio_from_rh(w.outdoor_temp_c, w.outdoor_rh_pct)
        w_new = self.psychro.step_moisture(
            w_z=w_curr,
            w_amb=w_amb,
            N_occ=occ_arr,
            dt=dt
        )
        
        for i, z in enumerate(self.config.zones.values()):
            self.state_tz[z.zone_id] = float(t_air_arr[i])
            self.state_w[z.zone_id] = float(w_new[i])

class DualTwinRunner:
    """Synchronized Dual-Twin comparative execution runner."""

    def __init__(self, config: Optional[BuildingConfig] = None,
                 baseline_controller: Optional[Any] = None,
                 rl_controller: Optional[Any] = None, seed: int = 42):
        if config is None:
            config = BuildingConfig()
        self.config = config
        self.baseline_controller = baseline_controller or ASHRAEBaselineController(config)
        self.rl_controller = rl_controller or FastTabularRLPolicy()
        self.reward_engine = RewardEngine()
        self.psychro = PsychrometricModel(config)
        self.twin_a = StatefulTwin(config, self.psychro)
        self.twin_b = StatefulTwin(config, self.psychro)
        self.weather = WeatherGenerator(seed=seed)
        
        # Store previous state/action for RL update
        self._prev_obs_b: Optional[np.ndarray] = None
        self._prev_action_b: Optional[np.ndarray] = None
        self._prev_nlp_b: Optional[List[float]] = None
        self.current_step = 0
        self.cum_base_kwh = 0.0
        self.cum_rl_kwh = 0.0
        self.cum_cost_saved = 0.0
        self.active_nlp_offsets = {z.zone_id: np.nan for z in self.config.zones.values()}
        self.latest_telemetry: Optional[StepTelemetry] = None

    def reset(self, seed: int = 42) -> StepTelemetry:
        self.weather.reset(seed=seed)
        self.twin_a.reset(22.0)
        self.twin_b.reset(22.0)
        self.current_step = 0
        self.cum_base_kwh = 0.0
        self.cum_rl_kwh = 0.0
        self.cum_cost_saved = 0.0
        self.active_nlp_offsets = {z.zone_id: np.nan for z in self.config.zones.values()}
        return self._generate_telemetry(0.0, 0.0, 0.15, self.weather._snapshot)

    def inject_nlp_constraint(self, constraint: ZoneConstraint):
        self.active_nlp_offsets[constraint.zone_id] = constraint.temperature_offset_c

    def calculate_comparative_metrics(self, p_base: float, p_rl: float) -> Dict[str, float]:
        saved_kw = p_base - p_rl
        pct = (saved_kw / p_base * 100.0) if p_base > 1e-6 else (0.0 if abs(p_rl) < 1e-6 else -400.0)
        return {
            "power_saved_kw": saved_kw,
            "instantaneous_savings_pct": pct
        }

    def step(self, rl_action: Optional[List[float]] = None) -> StepTelemetry:
        self.current_step += 1
        sim_hour = (self.current_step * 300.0) / 3600.0
        w = self.weather.step(300.0)
        occ_array = self.weather.get_occupancy(sim_hour)
        occupancies = {z.zone_id: occ_array[i] for i, z in enumerate(self.config.zones.values())}

        # Step Twin A (Baseline)
        if hasattr(self.baseline_controller, "compute_action"):
            # Real ASHRAE controller
            temps = [self.twin_a.state_tz[z.zone_id] for z in self.config.zones.values()]
            out = self.baseline_controller.compute_action(temps, w.outdoor_temp_c)
            q_base = {z.zone_id: out.thermal_power_w[i] / 1000.0 for i, z in enumerate(self.config.zones.values())}
            p_base = out.total_power_kw
        else:
            # Mock controller
            actions_base = self.baseline_controller.compute_multi_zone_actions(self.twin_a.state_tz, sim_hour)
            q_base = {z.zone_id: actions_base[z.zone_id].q_hvac_kw for z in self.config.zones.values()}
            p_base = sum(actions_base[z.zone_id].power_kw for z in self.config.zones.values())
        self.twin_a.step(300.0, w, q_base, occupancies)

        # Step Twin B (RL / Optimizer Twin)
        temps_b = [self.twin_b.state_tz[z.zone_id] for z in self.config.zones.values()]
        obs_b = np.array(temps_b)
        nlp_offsets_b = [self.active_nlp_offsets.get(z.zone_id, np.nan) for z in self.config.zones.values()]
        
        # Compute RL action
        if rl_action is None:
            rl_action = self.rl_controller.compute_action(obs_b, nlp_offsets_b).tolist()
            
        offsets_b = []
        for i, z in enumerate(self.config.zones.values()):
            off = nlp_offsets_b[i]
            if i < len(rl_action):
                if np.isnan(off):
                    off = 0.0
                off += rl_action[i]
            offsets_b.append(off)

        if hasattr(self.baseline_controller, "compute_action"):
            out_b = self.baseline_controller.compute_action(
                temps_b, w.outdoor_temp_c, nlp_offsets_c=offsets_b
            )
            q_rl = {z.zone_id: out_b.thermal_power_w[i] / 1000.0 for i, z in enumerate(self.config.zones.values())}
            p_rl = out_b.total_power_kw
        else:
            q_rl = {z.zone_id: 0.0 for z in self.config.zones.values()}
            p_rl = 0.05 * len(self.config.zones)

        self.twin_b.step(300.0, w, q_rl, occupancies)
        
        # RL Update
        next_temps_b = [self.twin_b.state_tz[z.zone_id] for z in self.config.zones.values()]
        next_obs_b = np.array(next_temps_b)
        
        # Compute Reward
        reward = self.reward_engine.compute_reward(
            powers_kw=[p_rl], # We only have total power here for simplification
            temps_c=next_temps_b,
            occupancies=list(occupancies.values()),
            price_kwh=w.electricity_price_usd_kwh
        )
        
        if self._prev_obs_b is not None and self._prev_action_b is not None and self._prev_nlp_b is not None:
            self.rl_controller.update(self._prev_obs_b, self._prev_action_b, reward, next_obs_b, self._prev_nlp_b)
            
        self._prev_obs_b = obs_b
        self._prev_action_b = np.array(rl_action)
        self._prev_nlp_b = nlp_offsets_b

        dt_hours = 300.0 / 3600.0
        self.cum_base_kwh += p_base * dt_hours
        self.cum_rl_kwh += p_rl * dt_hours
        self.cum_cost_saved += (p_base - p_rl) * w.electricity_price_usd_kwh * dt_hours

        return self._generate_telemetry(p_base, p_rl, w.electricity_price_usd_kwh, w)

    def _generate_telemetry(self, p_base: float, p_rl: float, price: float, w: WeatherSnapshot) -> StepTelemetry:
        comp = self.calculate_comparative_metrics(p_base, p_rl)
        cum_sav_pct = ((self.cum_base_kwh - self.cum_rl_kwh) / max(1e-6, self.cum_base_kwh)) * 100.0 if self.cum_base_kwh > 0 else 0.0

        zones_base_map = {}
        zones_rl_map = {}
        occ_array = self.weather.get_occupancy((self.current_step * 300) / 3600.0)
        for i, z in enumerate(self.config.zones.values()):
            rh_a = self.psychro.relative_humidity(self.twin_a.state_tz[z.zone_id], self.twin_a.state_w[z.zone_id])
            rh_b = self.psychro.relative_humidity(self.twin_b.state_tz[z.zone_id], self.twin_b.state_w[z.zone_id])
            raw_off = self.active_nlp_offsets.get(z.zone_id, np.nan)
            safe_off = 0.0 if np.isnan(raw_off) else raw_off
            
            zones_base_map[z.zone_id] = ZoneTelemetry(
                zone_id=z.zone_id,
                temperature_c=self.twin_a.state_tz[z.zone_id],
                target_setpoint_c=22.0,
                humidity_pct=rh_a,
                occupancy_count=int(occ_array[i]),
                hvac_power_kw=p_base / len(self.config.zones) if len(self.config.zones) > 0 else 0.0,
                comfort_violation_c=0.0,
                active_nlp_offset_c=0.0
            )
            zones_rl_map[z.zone_id] = ZoneTelemetry(
                zone_id=z.zone_id,
                temperature_c=self.twin_b.state_tz[z.zone_id],
                target_setpoint_c=22.0 + safe_off,
                humidity_pct=rh_b,
                occupancy_count=int(occ_array[i]),
                hvac_power_kw=p_rl / len(self.config.zones) if len(self.config.zones) > 0 else 0.0,
                comfort_violation_c=0.0,
                active_nlp_offset_c=safe_off
            )

        telemetry = StepTelemetry(
            step=self.current_step,
            timestamp_sim_hour=(self.current_step * 300.0) / 3600.0,
            outdoor_temp_c=w.outdoor_temp_c,
            outdoor_humidity_pct=w.outdoor_rh_pct,
            solar_irradiance_w_m2=w.solar_irradiance_w_m2,
            electricity_price_usd_kwh=price,
            baseline_power_kw=p_base,
            rl_power_kw=p_rl,
            power_saved_kw=comp["power_saved_kw"],
            instantaneous_savings_pct=comp["instantaneous_savings_pct"],
            cumulative_baseline_energy_kwh=self.cum_base_kwh,
            cumulative_rl_energy_kwh=self.cum_rl_kwh,
            cumulative_savings_pct=cum_sav_pct,
            cumulative_cost_saved_usd=self.cum_cost_saved,
            baseline_comfort_violation_total=0.0,
            rl_comfort_violation_total=0.0,
            zones_baseline=zones_base_map,
            zones_rl=zones_rl_map
        )
        self.latest_telemetry = telemetry
        return telemetry

    def get_latest_telemetry(self) -> StepTelemetry:
        if self.latest_telemetry is None:
            return self.reset()
        return self.latest_telemetry

    def get_telemetry_at_step(self, step: int) -> StepTelemetry:
        return self.get_latest_telemetry()
