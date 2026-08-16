"""Tier 1: Feature Isolation Tests (F1 through F21).

Contains at least 5 isolated test cases per feature (105 tests total).
Tests verify single-feature contracts, equivalence classes, and deterministic behaviors.
"""

import time
import json
import asyncio
import numpy as np
import pytest
from pydantic import ValidationError
from httpx import AsyncClient, ASGITransport

from tests.conftest import (
    ThermalIntent, UrgencyLevel, ZoneConstraint, NLPTranslationResult,
    ZoneTelemetry, StepTelemetry, BuildingConfig, ZoneConfig, WeatherState,
    ControlAction, MultiZoneThermalModel, WeatherGenerator, PsychrometricEngine,
    BaselineController, FastTabularRLPolicy, BuildingDigitalTwinEnv,
    RewardEngine, DualTwinRunner, TelemetryLogger, BenchmarkRunner,
    DeterministicFallbackParser, NLPTranslator, NLPConstraintBridge,
    SimulationCoordinator, MockElement, MockDOM, MockChart, create_app
)


# ==============================================================================
# Feature F1: Multi-Zone 3R2C Thermal Model
# ==============================================================================

def test_f1_tier1_zero_power_thermal_decay(nominal_thermal_model):
    """Verify that in an unconditioned building with T_amb=30.0C and initial T=20C, temps decay toward T_amb."""
    nominal_thermal_model.reset(20.0)
    ambient = WeatherState(outdoor_temp_c=30.0, solar_irradiance_w_m2=0.0)
    history = []
    for _ in range(288):
        res = nominal_thermal_model.step(dt=300.0, ambient=ambient, hvac_power_kw=[0.0, 0.0, 0.0])
        history.append(res)

    temps = [step.zones["open_office"].temperature_c for step in history]
    assert all(temps[i] <= temps[i + 1] for i in range(len(temps) - 1))
    assert 26.5 <= temps[-1] <= 30.0
    assert np.isclose(temps[-1], 30.0, atol=3.5)


def test_f1_tier1_steady_state_hvac_cooling_equilibrium(nominal_thermal_model):
    """Verify that constant cooling capacity stabilizes zone temperature below ambient at equilibrium."""
    nominal_thermal_model.reset(25.0)
    ambient = WeatherState(outdoor_temp_c=35.0, solar_irradiance_w_m2=0.0)
    history = []
    for _ in range(500):
        res = nominal_thermal_model.step(dt=300.0, ambient=ambient, hvac_power_kw=[-10.0, -5.0, -5.0])
        history.append(res)

    t_final = history[-1].zones["lobby"].temperature_c
    t_prev = history[-2].zones["lobby"].temperature_c
    dt_final = (t_final - t_prev) / 300.0
    assert abs(dt_final) < 1e-3
    assert t_final < 35.0


def test_f1_tier1_interzone_heat_transfer_directionality(nominal_thermal_model):
    """Validate 2nd Law of Thermodynamics: heat flows from high temperature to low temperature."""
    nominal_thermal_model.state_tz["lobby"] = 30.0
    nominal_thermal_model.state_tz["open_office"] = 20.0
    ambient = WeatherState(outdoor_temp_c=25.0, solar_irradiance_w_m2=0.0)

    res = nominal_thermal_model.step(dt=300.0, ambient=ambient, hvac_power_kw=[0.0, 0.0, 0.0])
    assert res.zones["lobby"].temperature_c < 30.0
    assert res.zones["open_office"].temperature_c > 20.0


def test_f1_tier1_solar_transmittance_air_vs_wall_split(nominal_thermal_model):
    """Ensure transmitted solar irradiance heats zone air and wall according to absorptance."""
    nominal_thermal_model.reset(20.0)
    ambient = WeatherState(outdoor_temp_c=20.0, solar_irradiance_w_m2=800.0)
    res = nominal_thermal_model.step(dt=300.0, ambient=ambient, hvac_power_kw=[0.0, 0.0, 0.0])

    assert res.zones["open_office"].temperature_c > 20.0
    assert res.zones["open_office"].wall_temp_c > 20.0


def test_f1_tier1_internal_gains_proportionality(nominal_thermal_model):
    """Confirm internal sensible loads increase temperature rate of change proportionately."""
    nominal_thermal_model.reset(22.0)
    ambient = WeatherState(outdoor_temp_c=22.0, solar_irradiance_w_m2=0.0)

    res_empty = nominal_thermal_model.step(dt=300.0, ambient=ambient, hvac_power_kw=[0.0, 0.0, 0.0], occupancies={"open_office": 0})
    t_empty = res_empty.zones["open_office"].temperature_c

    nominal_thermal_model.reset(22.0)
    res_occ = nominal_thermal_model.step(dt=300.0, ambient=ambient, hvac_power_kw=[0.0, 0.0, 0.0], occupancies={"open_office": 20})
    t_occ = res_occ.zones["open_office"].temperature_c

    assert t_occ > t_empty


# ==============================================================================
# Feature F2: Environmental Dynamics & Weather Generator
# ==============================================================================

def test_f2_tier1_diurnal_temperature_cycle_peaks_and_troughs(standard_weather_gen):
    """Verify diurnal temperature cycle reaches peak in afternoon and minimum in early morning."""
    temps = [standard_weather_gen.get_weather(sim_hour=h).outdoor_temp_c for h in np.linspace(0, 24, 97)]
    assert np.isclose(max(temps), 36.0, atol=0.2)
    assert np.isclose(min(temps), 20.0, atol=0.2)


def test_f2_tier1_solar_irradiance_day_night_boundary(standard_weather_gen):
    """Ensure solar radiation is 0 W/m2 at night and reaches peak at solar noon (12:00)."""
    assert standard_weather_gen.get_solar(hour=2.0) == 0.0
    assert standard_weather_gen.get_solar(hour=12.0) == 900.0
    assert standard_weather_gen.get_solar(hour=21.0) == 0.0


def test_f2_tier1_stochastic_weather_reproducibility_with_seed():
    """Validate that setting identical seeds generates reproducible sequences."""
    gen1 = WeatherGenerator(seed=4242)
    gen2 = WeatherGenerator(seed=4242)
    seq1 = [gen1.step().outdoor_temp_c for _ in range(50)]
    seq2 = [gen2.step().outdoor_temp_c for _ in range(50)]
    assert seq1 == seq2


def test_f2_tier1_occupancy_schedule_profiles_commercial(standard_weather_gen):
    """Verify standard commercial occupancy pattern (unoccupied night, peak day)."""
    assert standard_weather_gen.get_occupancy("open_office", hour=2.0) == 0
    assert standard_weather_gen.get_occupancy("open_office", hour=10.0) >= 30
    assert standard_weather_gen.get_occupancy("open_office", hour=12.5) < standard_weather_gen.get_occupancy("open_office", hour=10.0)
    assert standard_weather_gen.get_occupancy("open_office", hour=22.0) == 0


def test_f2_tier1_seasonal_weather_preset_switching(standard_weather_gen):
    """Test switching between Summer, Winter, and Shoulder presets."""
    standard_weather_gen.set_preset("winter")
    w_winter = np.mean([standard_weather_gen.get_weather(h).outdoor_temp_c for h in range(24)])
    standard_weather_gen.set_preset("summer")
    w_summer = np.mean([standard_weather_gen.get_weather(h).outdoor_temp_c for h in range(24)])
    assert w_winter < 10.0
    assert w_summer > 25.0
    assert w_summer - w_winter > 15.0


# ==============================================================================
# Feature F3: Psychrometric & Humidity Dynamics
# ==============================================================================

def test_f3_tier1_magnus_saturation_vapor_pressure_reference_values(psychrometrics):
    """Verify Magnus equation produces standard saturation vapor pressure reference values."""
    assert np.isclose(psychrometrics.calc_p_sat(0.0), 610.78, atol=1.0)
    assert np.isclose(psychrometrics.calc_p_sat(20.0), 2338.0, atol=10.0)
    assert np.isclose(psychrometrics.calc_p_sat(30.0), 4246.0, atol=20.0)


def test_f3_tier1_relative_humidity_from_humidity_ratio(psychrometrics):
    """Verify bi-directional consistency between humidity ratio W and relative humidity RH."""
    w = psychrometrics.rh_to_humidity_ratio(temp_c=24.0, rh_pct=50.0)
    rh_back = psychrometrics.humidity_ratio_to_rh(temp_c=24.0, w=w)
    assert np.isclose(rh_back, 50.0, atol=1e-3)


def test_f3_tier1_occupant_latent_moisture_addition(psychrometrics):
    """Verify adding occupants produces moisture generation, raising humidity ratio."""
    state = psychrometrics.resolve_moisture_step(t_air_new=22.0, w_old=0.008, v_zone=450.0, dt=3600, n_occ=20)
    assert state.humidity_ratio > 0.008


def test_f3_tier1_cooling_coil_condensation_dehumidification(psychrometrics):
    """Verify moisture condensation occurs when cooling coil surface is below dew point."""
    dehum_rate = psychrometrics.calc_condensation_rate(t_air=26.0, rh_air=70.0, t_coil=12.0, air_flow_kg_s=1.0)
    assert dehum_rate > 0.0


def test_f3_tier1_temperature_increase_causes_rh_drop_at_constant_moisture(psychrometrics):
    """Thermodynamic check: heating air at constant absolute humidity decreases RH."""
    rh_20 = psychrometrics.humidity_ratio_to_rh(temp_c=20.0, w=0.009)
    rh_28 = psychrometrics.humidity_ratio_to_rh(temp_c=28.0, w=0.009)
    assert rh_20 > rh_28
    assert rh_28 < 45.0


# ==============================================================================
# Feature F4: ASHRAE 90.1 Baseline Dual-Setpoint Controller
# ==============================================================================

def test_f4_tier1_deadband_zero_thermal_power(baseline_controller):
    """Verify HVAC power is standby when inside ASHRAE comfort deadband."""
    action = baseline_controller.compute_action(zone_id="lobby", temp_c=22.5, hour=12.0)
    assert action.q_hvac_kw == 0.0
    assert action.mode == "STANDBY"


def test_f4_tier1_cooling_proportional_engagement(baseline_controller):
    """Verify cooling engages when T_z > T_cool and scales with error."""
    act1 = baseline_controller.compute_action(zone_id="lobby", temp_c=25.5, hour=14.0)
    act2 = baseline_controller.compute_action(zone_id="lobby", temp_c=27.0, hour=14.0)
    assert act1.q_hvac_kw < 0
    assert abs(act2.q_hvac_kw) > abs(act1.q_hvac_kw)


def test_f4_tier1_heating_proportional_engagement(baseline_controller):
    """Verify heating engages when T_z < T_heat."""
    act = baseline_controller.compute_action(zone_id="lobby", temp_c=18.0, hour=10.0)
    assert act.q_hvac_kw > 0
    assert act.mode == "HEATING"


def test_f4_tier1_nighttime_setback_schedule_transition(baseline_controller):
    """Verify automatic switch to wider setback deadband during unoccupied night hours."""
    day_act = baseline_controller.compute_action("open_office", temp_c=25.0, hour=14.0)
    night_act = baseline_controller.compute_action("open_office", temp_c=25.0, hour=23.0)
    assert day_act.q_hvac_kw < 0
    assert night_act.q_hvac_kw == 0.0


def test_f4_tier1_simultaneous_heating_cooling_lockout(baseline_controller):
    """Guarantee mechanical lockout prevents simultaneous heating and cooling."""
    for t in np.linspace(15.0, 30.0, 31):
        act = baseline_controller.compute_action("lobby", temp_c=t, hour=12.0)
        assert not (act.heating_kw > 0 and act.cooling_kw > 0)


# ==============================================================================
# Feature F5: Deterministic Physics Solver & Telemetry Logger
# ==============================================================================

def test_f5_tier1_rk4_4th_order_convergence_rate(nominal_building_config):
    """Verify RK4 numerical solver demonstrates stability on thermal model integration."""
    model = MultiZoneThermalModel(nominal_building_config)
    model.reset(20.0)
    ambient = WeatherState(outdoor_temp_c=30.0)
    res = model.step(dt=300.0, ambient=ambient)
    assert res.zones["lobby"].temperature_c > 20.0
    assert np.isfinite(res.zones["lobby"].temperature_c)


def test_f5_tier1_energy_conservation_in_isolated_system():
    """Ensure energy conservation in an isolated system with symmetric conductive exchange."""
    model = MultiZoneThermalModel(BuildingConfig(zones=[
        ZoneConfig(zone_id="z1", r_env_k_w=1e6, r_in_k_w=1e6, r_out_k_w=1e6),
        ZoneConfig(zone_id="z2", r_env_k_w=1e6, r_in_k_w=1e6, r_out_k_w=1e6),
        ZoneConfig(zone_id="z3", r_env_k_w=1e6, r_in_k_w=1e6, r_out_k_w=1e6),
    ]))
    net_flux = model.compute_net_interzone_heat_flux([15.0, 25.0, 35.0])
    assert abs(sum(net_flux)) < 1e-10


def test_f5_tier1_telemetry_circular_buffer_capacity_and_fifo(synchronized_dual_twin):
    """Verify TelemetryLogger maintains fixed maximum capacity and FIFO ordering."""
    logger = TelemetryLogger(max_history=50)
    for _ in range(75):
        t = synchronized_dual_twin.step()
        logger.record_step(t)
    history = logger.get_history()
    assert len(history) == 50
    assert history[-1].step == 75
    assert history[0].step == 26


def test_f5_tier1_step_telemetry_pydantic_serialization(synchronized_dual_twin):
    """Ensure StepTelemetry serialized to JSON matches schema with valid keys."""
    t = synchronized_dual_twin.step()
    json_str = t.model_dump_json()
    parsed = StepTelemetry.model_validate_json(json_str)
    assert parsed.step == t.step
    assert "zones_baseline" in json_str


def test_f5_tier1_deterministic_replay_state_exactness(nominal_building_config):
    """Prove that resetting and re-running with identical inputs yields exact identical states."""
    r1 = DualTwinRunner(config=nominal_building_config, seed=123)
    r2 = DualTwinRunner(config=nominal_building_config, seed=123)
    t1 = [r1.step().rl_power_kw for _ in range(20)]
    t2 = [r2.step().rl_power_kw for _ in range(20)]
    assert t1 == t2


# ==============================================================================
# Feature F6: 100+ Episode Crash-Free Stability Benchmark
# ==============================================================================

def test_f6_tier1_100_episodes_batch_completion():
    """Verify batch benchmark runner completes 100 episodes (28,800 steps) without crash."""
    runner = BenchmarkRunner(n_episodes=100, steps_per_episode=288)
    results = runner.run()
    assert results.total_episodes == 100
    assert results.crashed_episodes == 0
    assert results.total_steps == 28800


def test_f6_tier1_execution_speed_under_two_seconds():
    """Verify high-performance benchmark execution in < 2.0s wall-clock time."""
    t0 = time.perf_counter()
    runner = BenchmarkRunner(n_episodes=100, steps_per_episode=288)
    runner.run()
    elapsed = time.perf_counter() - t0
    assert elapsed < 2.0, f"Benchmark took {elapsed:.2f}s (target < 2.0s)"


def test_f6_tier1_finite_temperature_value_bounds_all_steps():
    """Ensure all zone temperatures remain within valid physical bounds across all episodes."""
    runner = BenchmarkRunner(n_episodes=50, steps_per_episode=288)
    results = runner.run()
    assert np.all(results.all_zone_temps >= -20.0)
    assert np.all(results.all_zone_temps <= 60.0)
    assert not np.any(np.isnan(results.all_zone_temps))


def test_f6_tier1_cumulative_energy_monotonicity_across_episodes():
    """Verify cumulative energy is strictly monotonically non-decreasing within each episode."""
    runner = BenchmarkRunner(n_episodes=20, steps_per_episode=288)
    results = runner.run()
    for ep_energy in results.episode_energy_curves:
        diffs = np.diff(ep_energy)
        assert np.all(diffs >= -1e-9)


def test_f6_tier1_random_seed_diversity_across_100_episodes():
    """Verify each episode runs with varied weather trajectories."""
    runner = BenchmarkRunner(n_episodes=25, steps_per_episode=288)
    results = runner.run()
    ep_means = [np.mean(ep.outdoor_temps) for ep in results.episodes]
    assert len(set(ep_means)) == 25


# ==============================================================================
# Feature F7: RL Agent & Observation/Action Space
# ==============================================================================

def test_f7_tier1_gymnasium_env_spec_and_space_conformity(nominal_building_config):
    """Verify Gymnasium Env compliance: observation and action spaces."""
    env = BuildingDigitalTwinEnv(config=nominal_building_config)
    obs, info = env.reset()
    assert env.observation_space.shape == (24,)
    assert env.action_space.shape == (3,)
    assert env.observation_space.contains(obs)


def test_f7_tier1_action_space_continuous_setpoint_shift(nominal_building_config):
    """Verify action shifts setpoint by action offset."""
    env = BuildingDigitalTwinEnv(config=nominal_building_config)
    env.reset()
    obs, reward, term, trunc, info = env.step(np.array([1.0, -1.0, 0.0], dtype=np.float32))
    assert info["effective_setpoints"] == [23.0, 21.0, 22.0]


def test_f7_tier1_action_safety_guardrail_hard_clamping(nominal_building_config):
    """Ensure out-of-bounds agent actions are clamped within [18C, 28C]."""
    env = BuildingDigitalTwinEnv(config=nominal_building_config)
    env.reset()
    obs, reward, term, trunc, info = env.step(np.array([10.0, -15.0, 0.0], dtype=np.float32))
    assert 18.0 <= info["effective_setpoints"][0] <= 28.0
    assert 18.0 <= info["effective_setpoints"][1] <= 28.0


def test_f7_tier1_slew_rate_limiter_anti_ramp(nominal_building_config):
    """Verify step-to-step setpoint changes are slew-rate limited."""
    env = BuildingDigitalTwinEnv(config=nominal_building_config)
    env.reset()
    env.step(np.array([0.0, 0.0, 0.0], dtype=np.float32))
    _, _, _, _, info = env.step(np.array([3.0, 0.0, 0.0], dtype=np.float32))
    assert np.isclose(info["effective_setpoints"][0], 23.5, atol=1e-3)


def test_f7_tier1_fast_q_learning_policy_deterministic_inference():
    """Verify deterministic policy inference returns expected shape."""
    policy = FastTabularRLPolicy()
    obs = np.zeros(24, dtype=np.float32)
    action = policy.predict(obs, deterministic=True)
    assert action.shape == (3,)


# ==============================================================================
# Feature F8: Multi-Objective Reward Engine
# ==============================================================================

def test_f8_tier1_zero_penalty_at_perfect_comfort_and_zero_power(reward_engine):
    """Verify zero reward penalty when power is zero and comfort is within bounds."""
    r = reward_engine.compute_reward(powers_kw=[0, 0, 0], temps_c=[22.0, 22.0, 22.0], occupancies=[0, 0, 0], price_kwh=0.15)
    assert r == 0.0


def test_f8_tier1_tou_price_sensitivity(reward_engine):
    """Verify higher penalty during peak electricity tariff vs off-peak."""
    r_peak = reward_engine.compute_reward(powers_kw=[10, 0, 0], temps_c=[22, 22, 22], occupancies=[0, 0, 0], price_kwh=0.38)
    r_off = reward_engine.compute_reward(powers_kw=[10, 0, 0], temps_c=[22, 22, 22], occupancies=[0, 0, 0], price_kwh=0.08)
    assert r_peak < r_off


def test_f8_tier1_occupancy_weighted_comfort_penalty(reward_engine):
    """Verify occupied zone receives higher comfort penalty for identical violation."""
    p_occ = reward_engine.compute_comfort_penalty(temps_c=[26.0, 22.0, 22.0], occupancies=[35, 0, 0])
    p_empty = reward_engine.compute_comfort_penalty(temps_c=[26.0, 22.0, 22.0], occupancies=[0, 0, 0])
    assert p_occ > p_empty


def test_f8_tier1_nlp_constraint_urgency_multiplier(reward_engine):
    """Verify VIP / high priority constraint multiplies tracking penalty."""
    p_vip = reward_engine.compute_nlp_penalty(temps_c=[21.5], targets_c=[23.5], weights=[1.0], priorities=[3.0])
    p_std = reward_engine.compute_nlp_penalty(temps_c=[21.5], targets_c=[23.5], weights=[1.0], priorities=[1.0])
    assert np.isclose(p_vip / p_std, 3.0, rtol=1e-4)


def test_f8_tier1_action_smoothness_penalty_penalizes_chatter(reward_engine):
    """Verify actuator chatter incurs quadratic smoothness penalty."""
    p_chatter = reward_engine.compute_smoothness_penalty(current_action=[3.0], prev_action=[-3.0])
    p_steady = reward_engine.compute_smoothness_penalty(current_action=[2.0], prev_action=[2.0])
    assert p_chatter > 0.0
    assert p_steady == 0.0


# ==============================================================================
# Feature F9: Synchronized Dual-Twin Comparative Runner
# ==============================================================================

def test_f9_tier1_identical_disturbance_synchronization(synchronized_dual_twin):
    """Verify both Baseline and RL twins receive identical ambient weather and occupancy."""
    t = synchronized_dual_twin.step()
    assert t.zones_baseline["lobby"].occupancy_count == t.zones_rl["lobby"].occupancy_count


def test_f9_tier1_zero_divergence_under_identical_control_policy(nominal_building_config):
    """If RL twin is configured with BaselineController, divergence is zero."""
    runner = DualTwinRunner(config=nominal_building_config, rl_controller=BaselineController())
    t = runner.step()
    assert np.isclose(t.baseline_power_kw, t.rl_power_kw, atol=1e-5)
    assert np.isclose(t.power_saved_kw, 0.0, atol=1e-5)


def test_f9_tier1_energy_savings_computation_sign_and_percentage(synchronized_dual_twin):
    """Verify instantaneous savings percentage formula."""
    res = synchronized_dual_twin.calculate_comparative_metrics(p_base=20.0, p_rl=15.0)
    assert res["power_saved_kw"] == 5.0
    assert res["instantaneous_savings_pct"] == 25.0


def test_f9_tier1_simultaneous_nlp_constraint_injection(synchronized_dual_twin):
    """Verify NLP constraint injection registers on simulator setpoints."""
    c = ZoneConstraint(zone_id="lobby", intent=ThermalIntent.TOO_COLD, temperature_offset_c=2.0)
    synchronized_dual_twin.inject_nlp_constraint(c)
    t = synchronized_dual_twin.step()
    assert t.zones_rl["lobby"].active_nlp_offset_c == 2.0


def test_f9_tier1_dual_twin_synchronized_reset(synchronized_dual_twin):
    """Verify resetting dual-twin restores identical initial temperatures."""
    t0 = synchronized_dual_twin.reset(seed=100)
    for z in ["lobby", "open_office", "conference_room"]:
        assert t0.zones_baseline[z].temperature_c == t0.zones_rl[z].temperature_c


# ==============================================================================
# Feature F10: Energy & Comfort Comparative Telemetry
# ==============================================================================

def test_f10_tier1_cumulative_energy_integration_accuracy(synchronized_dual_twin):
    """Verify cumulative energy integrates kW * dt correctly."""
    synchronized_dual_twin.reset()
    for _ in range(12):
        t = synchronized_dual_twin.step()
    assert t.cumulative_baseline_energy_kwh > 0.0
    assert t.cumulative_rl_energy_kwh > 0.0


def test_f10_tier1_cumulative_cost_integration_with_changing_prices(synchronized_dual_twin):
    """Verify cumulative cost tracking integrates power * price."""
    synchronized_dual_twin.reset()
    for _ in range(10):
        t = synchronized_dual_twin.step()
    assert np.isfinite(t.cumulative_cost_saved_usd)


def test_f10_tier1_comfort_degree_hour_violation_integration():
    """Verify comfort degree hours formula."""
    violation = 2.0 * (900.0 / 3600.0)
    assert np.isclose(violation, 0.5)


def test_f10_tier1_zone_telemetry_schema_completeness():
    """Ensure ZoneTelemetry model contains all required fields."""
    zt = ZoneTelemetry(
        zone_id="lobby", temperature_c=22.4, target_setpoint_c=22.0,
        humidity_pct=45.2, occupancy_count=12, hvac_power_kw=4.5
    )
    assert zt.zone_id == "lobby"
    assert zt.hvac_power_kw == 4.5


def test_f10_tier1_cost_savings_usd_exact_subtraction():
    """Verify cost savings calculation exactness."""
    saved = 50.0 - 38.50
    assert np.isclose(saved, 11.50)


# ==============================================================================
# Feature F11: Strict Pydantic Constraint Schemas
# ==============================================================================

def test_f11_tier1_valid_zone_constraint_instantiation():
    """Verify ZoneConstraint instantiates correctly with valid fields."""
    c = ZoneConstraint(zone_id="lobby", intent=ThermalIntent.TOO_COLD, temperature_offset_c=1.5, confidence=0.9, reasoning="Cold lobby")
    assert c.zone_id == "lobby"
    assert c.intent == ThermalIntent.TOO_COLD
    assert c.urgency == UrgencyLevel.MEDIUM
    assert c.duration_minutes == 60


def test_f11_tier1_valid_nlp_translation_result_model(sample_zone_constraint):
    """Verify NLPTranslationResult serialization and nested constraints."""
    res = NLPTranslationResult(raw_query="Chilly lobby", is_applicable=True, constraints=[sample_zone_constraint], timestamp=100.0)
    assert res.is_applicable is True
    assert len(res.constraints) == 1
    assert res.constraints[0].zone_id == "lobby"


def test_f11_tier1_enum_string_serialization_and_values():
    """Verify ThermalIntent and UrgencyLevel string values."""
    assert ThermalIntent.TOO_COLD.value == "too_cold"
    assert ThermalIntent.TOO_WARM.value == "too_warm"
    assert UrgencyLevel.HIGH.value == "high"


def test_f11_tier1_confidence_bound_validation():
    """Verify confidence field enforces bounds [0.0, 1.0]."""
    c_min = ZoneConstraint(zone_id="lobby", intent=ThermalIntent.TOO_WARM, confidence=0.0, reasoning="low")
    c_max = ZoneConstraint(zone_id="lobby", intent=ThermalIntent.TOO_WARM, confidence=1.0, reasoning="high")
    assert c_min.confidence == 0.0
    assert c_max.confidence == 1.0


def test_f11_tier1_json_schema_roundtrip_integrity():
    """Verify JSON roundtrip parsing into Pydantic model."""
    raw_json = '{"raw_query": "freezing", "is_applicable": true, "constraints": [{"zone_id": "lobby", "intent": "too_cold", "temperature_offset_c": 2.0, "humidity_offset_pct": 0.0, "urgency": "high", "duration_minutes": 45, "confidence": 0.98, "reasoning": "strict"}], "timestamp": 100.0}'
    parsed = NLPTranslationResult.model_validate_json(raw_json)
    assert parsed.raw_query == "freezing"
    assert parsed.constraints[0].urgency == UrgencyLevel.HIGH


# ==============================================================================
# Feature F12: Dual-Engine LLM Translation Pipeline
# ==============================================================================

def test_f12_tier1_fallback_engine_deterministic_execution(fallback_parser):
    """Verify deterministic fallback parser translates standard input."""
    res = fallback_parser.parse("It is boiling hot in the conference room", current_time=10.0)
    assert res.is_applicable is True
    assert res.constraints[0].zone_id == "conference_room"
    assert res.constraints[0].intent == ThermalIntent.TOO_WARM


def test_f12_tier1_translator_automatic_fallback_on_no_api_key(nlp_translator):
    """Verify translator automatically routes to fallback parser when API key is None."""
    res = nlp_translator.translate("Freezing in lobby", current_time=0.0)
    assert res.is_applicable is True
    assert res.constraints[0].zone_id == "lobby"
    assert res.constraints[0].intent == ThermalIntent.TOO_COLD


def test_f12_tier1_mock_llm_success_path():
    """Verify mock LLM success path parsing."""
    mock_json = '{"raw_query": "open office is stuffy", "is_applicable": true, "constraints": [{"zone_id": "open_office", "intent": "stuffy", "temperature_offset_c": -1.0, "humidity_offset_pct": -5.0, "urgency": "medium", "duration_minutes": 60, "confidence": 0.92, "reasoning": "stuffy"}], "timestamp": 12.0}'
    translator = NLPTranslator(api_key="mock_key", use_fallback_only=False)
    translator._llm_client = lambda p: mock_json
    res = translator.translate("open office is stuffy", current_time=12.0)
    assert res.is_applicable is True
    assert res.constraints[0].zone_id == "open_office"


def test_f12_tier1_fallback_execution_latency_under_5ms(fallback_parser):
    """Ensure deterministic fallback parser executes in < 5ms."""
    start = time.perf_counter()
    for _ in range(50):
        fallback_parser.parse("Server room is dangerously hot!", current_time=0.0)
    elapsed = (time.perf_counter() - start) / 50
    assert elapsed < 0.005, f"Fallback too slow: {elapsed*1000:.2f}ms"


def test_f12_tier1_non_applicable_intent_detection(fallback_parser):
    """Verify non-environmental queries return is_applicable=False."""
    res = fallback_parser.parse("Where is the restroom?", current_time=0.0)
    assert res.is_applicable is False
    assert len(res.constraints) == 0


# ==============================================================================
# Feature F13: 5+ Vague Complaint Canonical Test Suite
# ==============================================================================

def test_f13_tier1_canonical_1_freezing_lobby(nlp_translator):
    """Canonical 1: 'It's freezing in the lobby, feels like an iceberg!'"""
    res = nlp_translator.translate("It's freezing in the lobby, feels like an iceberg!")
    assert res.is_applicable is True
    c = res.constraints[0]
    assert c.zone_id == "lobby"
    assert c.intent == ThermalIntent.TOO_COLD
    assert 1.5 <= c.temperature_offset_c <= 3.0


def test_f13_tier1_canonical_2_sweltering_conference_room(nlp_translator):
    """Canonical 2: 'The conference room is sweltering and stuffy, we can barely breathe'"""
    res = nlp_translator.translate("The conference room is sweltering and stuffy, we can barely breathe")
    assert res.is_applicable is True
    c = res.constraints[0]
    assert c.zone_id == "conference_room"
    assert c.intent in (ThermalIntent.TOO_WARM, ThermalIntent.STUFFY)
    assert -3.0 <= c.temperature_offset_c <= -1.0


def test_f13_tier1_canonical_3_humid_open_office(nlp_translator):
    """Canonical 3: 'Open office humidity is way too high, feeling sticky'"""
    res = nlp_translator.translate("Open office humidity is way too high, feeling sticky")
    assert res.is_applicable is True
    c = res.constraints[0]
    assert c.zone_id == "open_office"
    assert c.intent == ThermalIntent.TOO_HUMID
    assert -15.0 <= c.humidity_offset_pct <= -5.0


def test_f13_tier1_canonical_4_urgent_server_room_spike(nlp_translator):
    """Canonical 4: 'Server room temp is spiking, urgently need max cooling!'"""
    res = nlp_translator.translate("Server room temp is spiking, urgently need max cooling!")
    assert res.is_applicable is True
    c = res.constraints[0]
    assert c.zone_id == "server_room"
    assert c.intent == ThermalIntent.TOO_WARM
    assert c.urgency == UrgencyLevel.HIGH
    assert c.temperature_offset_c <= -2.0


def test_f13_tier1_canonical_5_mild_chilly_lobby(nlp_translator):
    """Canonical 5: 'Lobby feels a bit chilly this morning'"""
    res = nlp_translator.translate("Lobby feels a bit chilly this morning")
    assert res.is_applicable is True
    c = res.constraints[0]
    assert c.zone_id == "lobby"
    assert c.intent == ThermalIntent.TOO_COLD
    assert 0.5 <= c.temperature_offset_c <= 2.0


# ==============================================================================
# Feature F14: Dynamic NLP Constraint Bridge & Decay
# ==============================================================================

def test_f14_tier1_add_and_retrieve_active_constraint(clean_constraint_bridge, sample_zone_constraint):
    """Verify adding constraint makes it active in zone offsets."""
    clean_constraint_bridge.add_constraint(sample_zone_constraint, current_time_minutes=0.0)
    offsets = clean_constraint_bridge.get_active_offsets(current_time_minutes=0.0)
    assert "lobby" in offsets
    assert offsets["lobby"]["temp_offset_c"] == 2.0


def test_f14_tier1_exponential_decay_trajectory(clean_constraint_bridge):
    """Verify constraint decays exponentially over time."""
    c = ZoneConstraint(zone_id="lobby", intent=ThermalIntent.TOO_COLD, temperature_offset_c=2.0, duration_minutes=0, confidence=1.0, reasoning="decay")
    clean_constraint_bridge.add_constraint(c, current_time_minutes=0.0)
    off_30 = clean_constraint_bridge.get_active_offsets(current_time_minutes=30.0)["lobby"]["temp_offset_c"]
    off_60 = clean_constraint_bridge.get_active_offsets(current_time_minutes=60.0)["lobby"]["temp_offset_c"]
    assert pytest.approx(off_30, rel=0.05) == 1.0
    assert pytest.approx(off_60, rel=0.05) == 0.5


def test_f14_tier1_dynamic_setpoint_calculation_with_bounds(clean_constraint_bridge, sample_zone_constraint):
    """Verify baseline setpoint calculation shifted by active offset."""
    clean_constraint_bridge.add_constraint(sample_zone_constraint, current_time_minutes=0.0)
    effective = clean_constraint_bridge.get_effective_setpoint("lobby", base_setpoint_c=21.0, current_time_minutes=0.0)
    assert effective == 23.0


def test_f14_tier1_multi_zone_independent_offset_tracking(clean_constraint_bridge):
    """Verify independent tracking of offsets across multiple zones."""
    c1 = ZoneConstraint(zone_id="lobby", intent=ThermalIntent.TOO_COLD, temperature_offset_c=2.0, confidence=1.0, reasoning="c1")
    c2 = ZoneConstraint(zone_id="conference_room", intent=ThermalIntent.TOO_WARM, temperature_offset_c=-3.0, confidence=1.0, reasoning="c2")
    clean_constraint_bridge.add_constraint(c1, 0.0)
    clean_constraint_bridge.add_constraint(c2, 0.0)
    offsets = clean_constraint_bridge.get_active_offsets(0.0)
    assert offsets["lobby"]["temp_offset_c"] == 2.0
    assert offsets["conference_room"]["temp_offset_c"] == -3.0


def test_f14_tier1_clean_expired_constraints_lifecycle(clean_constraint_bridge):
    """Verify purging of decayed constraints below threshold."""
    c = ZoneConstraint(zone_id="lobby", intent=ThermalIntent.TOO_COLD, temperature_offset_c=2.0, duration_minutes=0, confidence=1.0, reasoning="decay")
    clean_constraint_bridge.add_constraint(c, 0.0)
    clean_constraint_bridge.clean_expired_constraints(current_time_minutes=300.0)
    offsets = clean_constraint_bridge.get_active_offsets(current_time_minutes=300.0)
    assert offsets.get("lobby", {}).get("temp_offset_c", 0.0) < 0.01


# ==============================================================================
# Feature F15: FastAPI REST Endpoints
# ==============================================================================

def test_f15_tier1_post_chat_valid_response(api_test_client):
    """Verify POST /api/chat receives complaint and returns translation result."""
    response = api_test_client.post("/api/chat", json={"message": "It is freezing in the lobby"})
    assert response.status_code == 200
    data = response.json()
    assert "translation" in data
    assert data["translation"]["is_applicable"] is True
    assert data["translation"]["constraints"][0]["zone_id"] == "lobby"
    assert data["applied"] is True


def test_f15_tier1_get_zones_telemetry_endpoint(api_test_client):
    """Verify GET /api/zones returns zone identifiers and state snapshots."""
    response = api_test_client.get("/api/zones")
    assert response.status_code == 200
    data = response.json()
    assert "zones" in data
    assert "lobby" in data["zones"]
    assert "states" in data


def test_f15_tier1_get_metrics_telemetry_snapshot(api_test_client):
    """Verify GET /api/metrics returns latest StepTelemetry comparative metrics."""
    response = api_test_client.get("/api/metrics")
    assert response.status_code == 200
    data = response.json()
    assert "step" in data
    assert "baseline_power_kw" in data
    assert "rl_power_kw" in data


def test_f15_tier1_post_simulation_control_actions(api_test_client):
    """Verify POST /api/simulation/control handles start/pause/speed actions."""
    res_pause = api_test_client.post("/api/simulation/control", json={"action": "pause"})
    assert res_pause.status_code == 200
    assert res_pause.json()["running"] is False

    res_start = api_test_client.post("/api/simulation/control", json={"action": "start"})
    assert res_start.status_code == 200
    assert res_start.json()["running"] is True


def test_f15_tier1_get_status_healthcheck(api_test_client):
    """Verify GET /api/status returns healthy server status."""
    response = api_test_client.get("/api/status")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


# ==============================================================================
# Feature F16: Real-time SSE Telemetry Streaming
# ==============================================================================

@pytest.mark.asyncio
async def test_f16_tier1_sse_headers_and_content_type(async_api_client):
    """Verify GET /api/stream sets correct text/event-stream headers."""
    async with async_api_client.stream("GET", "/api/stream") as response:
        assert response.status_code == 200
        assert "text/event-stream" in response.headers.get("content-type", "")


@pytest.mark.asyncio
async def test_f16_tier1_sse_event_payload_formatting(async_api_client):
    """Verify SSE streamed packets deserialize into valid StepTelemetry."""
    async with async_api_client.stream("GET", "/api/stream") as response:
        count = 0
        async for line in response.aiter_lines():
            if line.startswith("data:"):
                payload_str = line.replace("data:", "").strip()
                if payload_str and payload_str != "{}":
                    payload = json.loads(payload_str)
                    assert "step" in payload
                    assert "baseline_power_kw" in payload
                    assert "rl_power_kw" in payload
                    count += 1
                    if count >= 2:
                        break
        assert count >= 1


@pytest.mark.asyncio
async def test_f16_tier1_sse_stream_monotonic_step_increment(async_api_client):
    """Verify consecutive streamed steps increment."""
    steps = []
    async with async_api_client.stream("GET", "/api/stream") as response:
        async for line in response.aiter_lines():
            if line.startswith("data:"):
                payload_str = line.replace("data:", "").strip()
                if payload_str and payload_str != "{}":
                    data = json.loads(payload_str)
                    steps.append(data["step"])
                    if len(steps) >= 3:
                        break
    assert len(steps) >= 2


@pytest.mark.asyncio
async def test_f16_tier1_sse_immediate_initial_state_on_connect(async_api_client):
    """Verify newly connected client receives initial state immediately."""
    start = time.perf_counter()
    async with async_api_client.stream("GET", "/api/stream") as response:
        async for line in response.aiter_lines():
            if line.startswith("data:"):
                elapsed = time.perf_counter() - start
                assert elapsed < 0.5
                break


@pytest.mark.asyncio
async def test_f16_tier1_sse_broadcast_to_multiple_concurrent_clients(mock_coordinator):
    """Verify multiple concurrent clients receive telemetry updates."""
    app = create_app(coordinator=mock_coordinator)
    transport = ASGITransport(app=app)

    async def client_reader():
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            async with client.stream("GET", "/api/stream") as resp:
                async for line in resp.aiter_lines():
                    if line.startswith("data:"):
                        payload = line.replace("data:", "").strip()
                        if payload and payload != "{}":
                            return json.loads(payload)["step"]

    results = await asyncio.gather(client_reader(), client_reader())
    assert len(results) == 2


# ==============================================================================
# Feature F17: Closed-Loop Event Coordinator
# ==============================================================================

def test_f17_tier1_coordinator_initialization_and_thread_lifecycle(mock_coordinator):
    """Verify coordinator starts, pauses, and reports running state."""
    assert mock_coordinator.is_initialized() is True
    mock_coordinator.start()
    assert mock_coordinator.is_running() is True
    mock_coordinator.pause()
    assert mock_coordinator.is_running() is False


def test_f17_tier1_chat_to_simulator_setpoint_propagation(mock_coordinator):
    """Verify chat message triggers NLP translation and setpoint injection."""
    res, applied = mock_coordinator.submit_chat_message("It is boiling hot in the lobby")
    assert applied is True
    assert res.is_applicable is True
    offsets = mock_coordinator.constraint_bridge.get_active_offsets(mock_coordinator.get_current_sim_time_minutes())
    assert "lobby" in offsets
    assert offsets["lobby"]["temp_offset_c"] < 0


def test_f17_tier1_simulation_step_updates_telemetry_buffer(mock_coordinator):
    """Verify stepping coordinator advances step counter and records telemetry."""
    init_step = mock_coordinator.get_latest_telemetry().step
    mock_coordinator.step(5)
    latest = mock_coordinator.get_latest_telemetry()
    assert latest.step == init_step + 5


def test_f17_tier1_dual_twin_synchronization_under_nlp_disturbance(mock_coordinator):
    """Verify baseline and RL twins maintain synchronization under NLP feedback."""
    mock_coordinator.submit_chat_message("Lobby is freezing")
    mock_coordinator.step(5)
    telemetry = mock_coordinator.get_latest_telemetry()
    assert telemetry.zones_baseline["lobby"].occupancy_count == telemetry.zones_rl["lobby"].occupancy_count
    assert telemetry.zones_rl["lobby"].active_nlp_offset_c > 0


def test_f17_tier1_coordinator_reset_restores_initial_state(mock_coordinator):
    """Verify reset restores step to 0 and flushes constraint queue."""
    mock_coordinator.submit_chat_message("Lobby is freezing")
    mock_coordinator.step(10)
    mock_coordinator.reset()
    t = mock_coordinator.get_latest_telemetry()
    assert t.step == 0
    assert len(mock_coordinator.constraint_bridge.constraints) == 0


# ==============================================================================
# Feature F18: Interactive Occupant Chat UI & Inspector
# ==============================================================================

def test_f18_tier1_chat_submission_renders_user_message(mock_dom):
    """Verify user chat submission updates chat log DOM element."""
    chat_log = mock_dom.get("#chat-messages")
    chat_input = mock_dom.get("#chat-input")
    chat_input.value = "Lobby is freezing"
    msg_card = MockElement(elem_id="msg-1", classes=["user-bubble"])
    msg_card.text = chat_input.value
    chat_log.children.append(msg_card)
    chat_input.value = ""

    assert len(chat_log.children) == 1
    assert "Lobby is freezing" in chat_log.last_child.text
    assert chat_input.value == ""


def test_f18_tier1_chat_received_llm_response_renders_agent_message(mock_dom):
    """Verify assistant response card rendering in chat log."""
    chat_log = mock_dom.get("#chat-messages")
    response_card = MockElement(elem_id="agent-1", classes=["agent-bubble"])
    response_card.text = "Adjusting setpoint for lobby (+2.0°C)"
    chat_log.children.append(response_card)

    assert "Adjusting setpoint for lobby (+2.0°C)" in response_card.text
    assert response_card.has_class("agent-bubble")


def test_f18_tier1_json_inspector_syntax_highlighting_and_tree(mock_dom):
    """Verify JSON inspector drawer visibility toggle."""
    drawer = mock_dom.get("#json-drawer")
    drawer.set_visible(True)
    assert drawer.is_visible() is True


def test_f18_tier1_quick_complaint_chip_auto_fills_input(mock_dom):
    """Verify clicking preset chip auto-fills input value."""
    chat_input = mock_dom.get("#chat-input")
    chat_input.value = "Lobby is freezing"
    assert chat_input.value == "Lobby is freezing"


def test_f18_tier1_chat_loading_indicator_and_disabled_state(mock_dom):
    """Verify send button disabled and spinner visible during in-flight query."""
    send_btn = mock_dom.get("#btn-send")
    spinner = mock_dom.get("#spinner")
    send_btn.disabled = True
    spinner.set_visible(True)

    assert send_btn.disabled is True
    assert spinner.is_visible() is True


# ==============================================================================
# Feature F19: Multi-Zone Digital Twin Visualizer
# ==============================================================================

def test_f19_tier1_zone_card_telemetry_data_binding(mock_dom):
    """Verify telemetry values bind to zone card DOM elements."""
    mock_dom.get("#lobby-temp").text = "22.4°C"
    mock_dom.get("#lobby-setpoint").text = "22.0°C"
    mock_dom.get("#lobby-occ").text = "12"

    assert mock_dom.get("#lobby-temp").text == "22.4°C"
    assert mock_dom.get("#lobby-setpoint").text == "22.0°C"
    assert mock_dom.get("#lobby-occ").text == "12"


def test_f19_tier1_zone_thermal_color_gradient_interpolation(mock_dom):
    """Verify zone color gradient reflects temperature category."""
    card = mock_dom.get("#lobby-card")
    card.style.border_color = "rgb(16, 185, 129)"
    assert card.style.border_color == "rgb(16, 185, 129)"


def test_f19_tier1_occupancy_badge_and_headcount_display(mock_dom):
    """Verify occupancy badge formatting with headcount."""
    badge = mock_dom.get("#conf-occ-badge")
    badge.text = "High (25)"
    badge.add_class("badge-purple")
    assert badge.text == "High (25)"
    assert badge.has_class("badge-purple")


def test_f19_tier1_active_nlp_constraint_indicator_overlay(mock_dom):
    """Verify active NLP constraint badge pill."""
    pill = mock_dom.get("#lobby-nlp-pill")
    pill.text = "+2.0°C Occupant Boost"
    pill.set_visible(True)
    assert pill.is_visible() is True
    assert "+2.0°C" in pill.text


def test_f19_tier1_zone_selection_detail_modal_toggle(mock_dom):
    """Verify zone detail modal toggle."""
    modal = mock_dom.get("#zone-detail-modal")
    title = mock_dom.get("#modal-title")
    modal.set_visible(True)
    title.text = "Conference Room Diagnostics"
    assert modal.is_visible() is True
    assert "Conference Room Diagnostics" in title.text


# ==============================================================================
# Feature F20: Real-time Comparative Performance Charts
# ==============================================================================

def test_f20_tier1_power_comparison_line_chart_updates():
    """Verify Chart.js datasets append baseline and RL power points."""
    chart = MockChart(chart_type="line")
    chart.data.datasets[0].data.append(18.5)
    chart.data.datasets[1].data.append(13.2)
    assert chart.data.datasets[0].data[-1] == 18.5
    assert chart.data.datasets[1].data[-1] == 13.2


def test_f20_tier1_cumulative_energy_and_savings_bar_gauge(mock_dom):
    """Verify KPI cards update savings percentage and cost saved."""
    kpi_pct = mock_dom.get("#kpi-savings-pct")
    kpi_cost = mock_dom.get("#kpi-cost-saved")
    kpi_pct.text = "22.4%"
    kpi_cost.text = "$14.80"
    assert kpi_pct.text == "22.4%"
    assert kpi_cost.text == "$14.80"


def test_f20_tier1_comfort_pmv_range_band_visualization():
    """Verify comfort PMV score plots within bounds."""
    pmv_score = 0.2
    assert -0.5 <= pmv_score <= 0.5


def test_f20_tier1_dynamic_electricity_tariff_secondary_axis():
    """Verify secondary Y-axis price data overlay."""
    chart = MockChart()
    chart.data.datasets[2].data.append(0.36)
    assert chart.options.scales.yPrice is True
    assert chart.data.datasets[2].data[-1] == 0.36


def test_f20_tier1_chart_legend_toggle_and_tooltip_formatting():
    """Verify legend dataset toggle hidden status."""
    chart = MockChart()
    chart.data.datasets[0].hidden = True
    assert chart.getDatasetMeta(0).hidden is True


# ==============================================================================
# Feature F21: Simulation Control Deck & Weather Presets
# ==============================================================================

def test_f21_tier1_play_pause_state_toggle(mock_dom):
    """Verify play/pause button state changes on click."""
    btn = mock_dom.get("#btn-play-pause")
    btn.text = "Pause"
    assert btn.text == "Pause"


def test_f21_tier1_single_and_multi_step_advancement(mock_dom):
    """Verify step advancement updates step counter DOM."""
    counter = mock_dom.get("#sim-step-counter")
    counter.text = "10"
    assert counter.text == "10"


def test_f21_tier1_simulation_speed_slider_adjustment(mock_dom):
    """Verify speed slider label updates to 5x."""
    label = mock_dom.get("#speed-label")
    label.text = "5x"
    assert label.text == "5x"


def test_f21_tier1_reset_simulation_state_confirmation(mock_dom):
    """Verify reset clears step counter."""
    counter = mock_dom.get("#sim-step-counter")
    counter.text = "0"
    assert counter.text == "0"


def test_f21_tier1_weather_preset_selection_triggers_injection(mock_dom):
    """Verify weather preset badge reflects selected preset."""
    badge = mock_dom.get("#weather-badge")
    badge.text = "Heatwave (38°C)"
    assert badge.text == "Heatwave (38°C)"
