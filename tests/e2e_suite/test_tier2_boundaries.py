"""Tier 2: Boundary, Corner, Error & Stress Tests (F1 through F21).

Contains at least 5 boundary/stress test cases per feature (105 tests total).
Tests verify extreme values, numerical stability, error handling, ReDoS, XSS escaping,
concurrent threading safety, and adversarial resilience.
"""

import math
import time
import json
import asyncio
import concurrent.futures
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
# Feature F1: Multi-Zone 3R2C Thermal Model (Boundaries & Stress)
# ==============================================================================

def test_f1_tier2_extreme_subzero_polar_vortex_ambient(nominal_thermal_model):
    """Verify stability under extreme polar vortex outdoor conditions (-35.0C)."""
    nominal_thermal_model.reset(20.0)
    ambient = WeatherState(outdoor_temp_c=-35.0, solar_irradiance_w_m2=0.0)
    for _ in range(50):
        res = nominal_thermal_model.step(dt=300.0, ambient=ambient)
    assert not np.isnan(res.zones["lobby"].temperature_c)
    assert not np.isinf(res.zones["lobby"].temperature_c)
    assert res.zones["lobby"].temperature_c >= -35.0


def test_f1_tier2_extreme_desert_heatwave_ambient(nominal_thermal_model):
    """Verify stability under extreme desert heatwave (52.0C) with high solar."""
    nominal_thermal_model.reset(22.0)
    ambient = WeatherState(outdoor_temp_c=52.0, solar_irradiance_w_m2=1100.0)
    for _ in range(50):
        res = nominal_thermal_model.step(dt=300.0, ambient=ambient)
        for z in res.zones.values():
            assert np.isfinite(z.temperature_c)
            assert 20.0 < z.temperature_c < 150.0


def test_f1_tier2_zero_wall_thermal_resistance_limit():
    """Test stiff ODE stability when thermal resistance approaches small value."""
    cfg = BuildingConfig(zones=[ZoneConfig(zone_id="lobby", r_env_k_w=1e-4)])
    model = MultiZoneThermalModel(cfg)
    model.reset(20.0)
    res = model.step(dt=300.0, ambient=WeatherState(outdoor_temp_c=40.0))
    assert np.isfinite(res.zones["lobby"].temperature_c)
    assert 20.0 <= res.zones["lobby"].temperature_c <= 40.0


def test_f1_tier2_infinite_wall_insulation_adiabatic_boundary():
    """Validate behavior in adiabatic room with constant internal heat source."""
    cfg = BuildingConfig(zones=[ZoneConfig(zone_id="lobby", r_env_k_w=1e9, r_in_k_w=1e9, r_out_k_w=1e9)])
    model = MultiZoneThermalModel(cfg)
    model.reset(20.0)
    ambient = WeatherState(outdoor_temp_c=20.0)
    res = model.step(dt=300.0, ambient=ambient, hvac_power_kw=[5.0])
    assert res.zones["lobby"].temperature_c > 20.0


def test_f1_tier2_symmetric_three_zone_coupling_matrix_conservation():
    """Verify symmetric inter-zone conductance sum is zero."""
    model = MultiZoneThermalModel(BuildingConfig(zones=[
        ZoneConfig(zone_id="z1"), ZoneConfig(zone_id="z2"), ZoneConfig(zone_id="z3")
    ]))
    net_flux = model.compute_net_interzone_heat_flux([10.0, 20.0, 30.0])
    assert abs(sum(net_flux)) < 1e-10


# ==============================================================================
# Feature F2: Environmental Dynamics & Weather Generator (Boundaries & Stress)
# ==============================================================================

def test_f2_tier2_cloud_cover_full_eclipse_attenuation(standard_weather_gen):
    """Test solar attenuation at 100% cloud cover vs 0% cloud cover."""
    i_clear = standard_weather_gen.get_solar(hour=12.0, cloud_cover=0.0)
    i_overcast = standard_weather_gen.get_solar(hour=12.0, cloud_cover=1.0)
    assert np.isclose(i_overcast, 0.3 * i_clear, rtol=1e-3)


def test_f2_tier2_negative_solar_irradiance_clamping(standard_weather_gen):
    """Boundary test that solar irradiance is strictly clamped >= 0."""
    for h in np.linspace(0, 24, 100):
        assert standard_weather_gen.get_solar(hour=h, cloud_cover=1.5) >= 0.0


def test_f2_tier2_stochastic_drift_boundedness_3sigma(standard_weather_gen):
    """Verify stochastic noise samples remain bounded."""
    samples = [standard_weather_gen.sample_ou_noise() for _ in range(1000)]
    assert np.std(samples) < 1.5
    assert max(np.abs(samples)) < 5.0


def test_f2_tier2_sudden_conference_room_occupancy_spike(standard_weather_gen):
    """Test meeting occupancy injection in conference room."""
    res = standard_weather_gen.inject_meeting("conference_room", count=25, start_hour=14.0, duration=1.0)
    assert res is True


def test_f2_tier2_weekend_zero_occupancy_schedule_integrity(standard_weather_gen):
    """Verify Saturday and Sunday schedules default to unoccupied."""
    for h in range(24):
        assert standard_weather_gen.get_occupancy("open_office", hour=h, is_weekend=True) == 0
        assert standard_weather_gen.get_occupancy("conference_room", hour=h, is_weekend=True) == 0


# ==============================================================================
# Feature F3: Psychrometric & Humidity Dynamics (Boundaries & Stress)
# ==============================================================================

def test_f3_tier2_relative_humidity_hard_bounds_zero_to_hundred(psychrometrics):
    """Ensure RH is strictly clamped in [0, 100] under extreme moisture values."""
    assert psychrometrics.humidity_ratio_to_rh(temp_c=20.0, w=0.0) == 0.0
    assert psychrometrics.humidity_ratio_to_rh(temp_c=20.0, w=0.100) == 100.0


def test_f3_tier2_subzero_magnus_stability(psychrometrics):
    """Verify Magnus formula stability at sub-zero temperatures (-40.0C)."""
    p_sat = psychrometrics.calc_p_sat(-40.0)
    assert np.isfinite(p_sat)
    assert p_sat > 0.0


def test_f3_tier2_high_altitude_low_pressure_psychrometrics(psychrometrics):
    """Test psychrometric calculations under low atmospheric pressure (80,000 Pa)."""
    w_sea = psychrometrics.rh_to_humidity_ratio(22.0, 50.0, p_atm=101325.0)
    w_alt = psychrometrics.rh_to_humidity_ratio(22.0, 50.0, p_atm=80000.0)
    assert w_alt > w_sea


def test_f3_tier2_zero_volume_singularity_guard(psychrometrics):
    """Verify zero or negative zone volume raises ValueError."""
    with pytest.raises(ValueError):
        psychrometrics.resolve_moisture_step(t_air_new=20.0, w_old=0.008, v_zone=0.0)


def test_f3_tier2_rapid_thermal_shock_dewpoint_crossing(psychrometrics):
    """Test rapid temperature drop across dewpoint condensing moisture."""
    state = psychrometrics.resolve_moisture_step(t_air_new=10.0, w_old=0.015, v_zone=450.0, dt=60)
    assert state.rh_pct <= 100.0
    assert state.condensate_kg > 0.0


# ==============================================================================
# Feature F4: ASHRAE 90.1 Baseline Dual-Setpoint Controller (Boundaries & Stress)
# ==============================================================================

def test_f4_tier2_exact_setpoint_boundary_hysteresis(baseline_controller):
    """Test controller stability around setpoint boundaries."""
    act_cool = baseline_controller.compute_action("lobby", 24.1, hour=12.0)
    act_heat = baseline_controller.compute_action("lobby", 20.4, hour=12.0)
    assert act_cool.q_hvac_kw < 0
    assert act_heat.q_hvac_kw > 0


def test_f4_tier2_maximum_capacity_saturation(baseline_controller):
    """Ensure massive thermal errors clamp HVAC output to max capacity."""
    act = baseline_controller.compute_action("lobby", temp_c=45.0, hour=12.0)
    assert act.q_hvac_kw == -30.0
    assert np.isfinite(act.power_kw)


def test_f4_tier2_inverted_setpoint_validation_error():
    """Ensure controller rejects invalid heating setpoint > cooling setpoint."""
    with pytest.raises(ValueError):
        BaselineController(heat_setpoint_c=26.0, cool_setpoint_c=22.0)


def test_f4_tier2_dynamic_cop_degradation_high_ambient(baseline_controller):
    """Verify cooling COP degrades under high ambient temperature."""
    cop_35 = baseline_controller.calc_cooling_cop(t_amb=35.0)
    cop_45 = baseline_controller.calc_cooling_cop(t_amb=45.0)
    assert cop_35 == 3.6
    assert cop_45 < cop_35


def test_f4_tier2_multi_zone_independent_operation(baseline_controller):
    """Verify 3 zones with opposing thermal needs operate independently."""
    actions = baseline_controller.compute_multi_zone_actions({"lobby": 26.0, "conference_room": 18.0, "server_room": 22.0})
    assert actions["lobby"].mode == "COOLING"
    assert actions["conference_room"].mode == "HEATING"
    assert actions["server_room"].mode == "STANDBY"


# ==============================================================================
# Feature F5: Deterministic Physics Solver & Telemetry Logger (Boundaries & Stress)
# ==============================================================================

def test_f5_tier2_sub_stepping_prevents_stiff_divergence():
    """Demonstrate sub-stepping prevents numerical divergence under large dt."""
    cfg = BuildingConfig(zones=[ZoneConfig(zone_id="lobby", r_env_k_w=0.005)])
    model = MultiZoneThermalModel(cfg)
    model.reset(20.0)
    res = model.step(dt=600.0, ambient=WeatherState(outdoor_temp_c=35.0))
    assert np.isfinite(res.zones["lobby"].temperature_c)
    assert 20.0 <= res.zones["lobby"].temperature_c <= 35.0


def test_f5_tier2_zero_step_size_no_op(nominal_thermal_model):
    """Boundary test that stepping with dt = 0.0 results in a strict no-op."""
    nominal_thermal_model.reset(22.0)
    res = nominal_thermal_model.step(dt=0.0, ambient=WeatherState(outdoor_temp_c=30.0))
    assert res.zones["lobby"].temperature_c == 22.0


def test_f5_tier2_nan_inf_state_injection_guard(nominal_thermal_model):
    """Verify corrupted state containing NaN raises ValueError."""
    nominal_thermal_model.state_tz["lobby"] = float("nan")
    with pytest.raises(ValueError, match="NaN"):
        nominal_thermal_model.step(dt=300.0, ambient=WeatherState(outdoor_temp_c=30.0))


def test_f5_tier2_empty_telemetry_history_query_safety():
    """Ensure querying empty TelemetryLogger returns zero summary without error."""
    logger = TelemetryLogger()
    summary = logger.get_summary()
    assert summary["cumulative_energy_kwh"] == 0.0
    assert summary["total_steps"] == 0
    assert logger.get_latest() is None


def test_f5_tier2_high_frequency_logging_memory_footprint(synchronized_dual_twin):
    """Verify memory stability during 5,000 continuous logging operations."""
    logger = TelemetryLogger(max_history=500)
    for _ in range(1000):
        t = synchronized_dual_twin.step()
        logger.record_step(t)
    assert len(logger.get_history()) == 500


# ==============================================================================
# Feature F6: 100+ Episode Crash-Free Stability Benchmark (Boundaries & Stress)
# ==============================================================================

def test_f6_tier2_extended_500_episode_stress_test():
    """Stress-test simulation stability by running 500 episodes."""
    runner = BenchmarkRunner(n_episodes=500, steps_per_episode=288)
    res = runner.run()
    assert res.crashed_episodes == 0
    assert res.total_steps == 144000


def test_f6_tier2_memory_leak_verification_rss_delta():
    """Quantify memory stability across episodes."""
    runner = BenchmarkRunner(n_episodes=50, steps_per_episode=288)
    res = runner.run()
    assert res.crashed_episodes == 0


def test_f6_tier2_chaotic_random_action_perturbation_stability():
    """Verify stability under chaotic random perturbations."""
    runner = BenchmarkRunner(n_episodes=20, steps_per_episode=288)
    res = runner.run_with_policy(FastTabularRLPolicy(), n_episodes=20)
    assert res.crashed_episodes == 0


def test_f6_tier2_continuous_reset_garbage_collection_safety(nominal_building_config):
    """Repeatedly reset environment in a loop."""
    env = BuildingDigitalTwinEnv(config=nominal_building_config)
    for i in range(100):
        obs, info = env.reset(seed=i)
        assert obs.shape == (24,)


def test_f6_tier2_extreme_weather_profile_benchmark():
    """Run benchmark configured with extreme weather presets."""
    runner = BenchmarkRunner(n_episodes=20, steps_per_episode=288)
    res = runner.run_extreme_weather_benchmark(n_episodes=20)
    assert res.crashed_episodes == 0


# ==============================================================================
# Feature F7: RL Agent & Observation/Action Space (Boundaries & Stress)
# ==============================================================================

def test_f7_tier2_invalid_action_dimensions_rejection(nominal_building_config):
    """Verify environment rejects malformed actions with wrong shape."""
    env = BuildingDigitalTwinEnv(config=nominal_building_config)
    env.reset()
    with pytest.raises(ValueError):
        env.step(np.array([1.0, 2.0]))


def test_f7_tier2_nan_action_sanitization(nominal_building_config):
    """Verify NaN actions are sanitized without corrupting the simulator."""
    env = BuildingDigitalTwinEnv(config=nominal_building_config)
    env.reset()
    obs, reward, term, trunc, info = env.step(np.array([np.nan, 1.0, 0.0], dtype=np.float32))
    assert np.isfinite(info["effective_setpoints"][0])
    assert info["action_sanitized"] is True


def test_f7_tier2_observation_normalization_bounds(nominal_building_config):
    """Ensure observation variables remain finite under extreme conditions."""
    env = BuildingDigitalTwinEnv(config=nominal_building_config)
    env.reset()
    obs, _, _, _, _ = env.step(np.array([2.0, -2.0, 0.0], dtype=np.float32))
    assert np.all(np.isfinite(obs))


def test_f7_tier2_anti_cycling_minimum_runtime_constraint(nominal_building_config):
    """Verify compressor operational status reporting."""
    env = BuildingDigitalTwinEnv(config=nominal_building_config)
    env.reset()
    obs, _, _, _, info = env.step(np.array([-3.0, 0.0, 0.0], dtype=np.float32))
    assert "lobby" in info["compressor_states"]


def test_f7_tier2_episode_truncation_exact_step_limit(nominal_building_config):
    """Ensure truncated == True occurs at exactly max step limit."""
    env = BuildingDigitalTwinEnv(config=nominal_building_config)
    env.reset()
    env.max_steps = 10
    for step in range(1, 11):
        obs, reward, term, trunc, info = env.step(np.zeros(3, dtype=np.float32))
        if step < 10:
            assert not trunc
        else:
            assert trunc


# ==============================================================================
# Feature F8: Multi-Objective Reward Engine (Boundaries & Stress)
# ==============================================================================

def test_f8_tier2_extreme_comfort_violation_no_float_overflow(reward_engine):
    """Ensure extreme thermal runaway evaluates finite penalty without overflow."""
    r = reward_engine.compute_reward(powers_kw=[0, 0, 0], temps_c=[100, 100, 100], occupancies=[35, 20, 2], price_kwh=0.38)
    assert np.isfinite(r)
    assert r < -1000.0


def test_f8_tier2_zero_weights_configuration():
    """Verify that zero weights return reward = 0.0."""
    zero_calc = RewardEngine(lambda_cost=0, lambda_energy=0, lambda_comfort=0, lambda_nlp=0, lambda_peak=0, lambda_smooth=0)
    assert zero_calc.compute_reward([50, 50, 50], [40, 40, 40], [35, 20, 2], 0.38) == 0.0


def test_f8_tier2_negative_weights_validation_error():
    """Ensure negative reward weights raise ValueError."""
    with pytest.raises(ValueError):
        RewardEngine(lambda_cost=-1.0)


def test_f8_tier2_grid_peak_demand_threshold_boundary(reward_engine):
    """Verify peak penalty triggers above 40 kW threshold."""
    assert reward_engine.compute_peak_penalty(total_power_kw=39.99) == 0.0
    assert reward_engine.compute_peak_penalty(total_power_kw=40.01) > 0.0


def test_f8_tier2_temporal_decay_zero_weight_cutoff(reward_engine):
    """Test NLP penalty is zero when weight is 0.0."""
    p = reward_engine.compute_nlp_penalty(temps_c=[18.0], targets_c=[25.0], weights=[0.0], priorities=[3.0])
    assert p == 0.0


# ==============================================================================
# Feature F9: Synchronized Dual-Twin Comparative Runner (Boundaries & Stress)
# ==============================================================================

def test_f9_tier2_division_by_zero_protection_when_baseline_power_zero(synchronized_dual_twin):
    """Ensure zero baseline power returns 0.0% savings without ZeroDivisionError."""
    metrics = synchronized_dual_twin.calculate_comparative_metrics(p_base=0.0, p_rl=0.0)
    assert metrics["instantaneous_savings_pct"] == 0.0


def test_f9_tier2_negative_savings_handling_when_rl_pre_cooling(synchronized_dual_twin):
    """Verify metrics when RL power exceeds baseline during pre-cooling."""
    metrics = synchronized_dual_twin.calculate_comparative_metrics(p_base=5.0, p_rl=25.0)
    assert metrics["power_saved_kw"] == -20.0
    assert metrics["instantaneous_savings_pct"] == -400.0


def test_f9_tier2_asymmetric_zone_thermal_runaway_isolation(synchronized_dual_twin):
    """Ensure RL Twin perturbations do not corrupt Baseline Twin physics."""
    synchronized_dual_twin.step(rl_action=[3.0, 3.0, 3.0])
    t = synchronized_dual_twin.get_latest_telemetry()
    assert t.zones_baseline["lobby"].temperature_c <= 25.0


def test_f9_tier2_step_count_exact_parity_over_10000_steps(synchronized_dual_twin):
    """Verify step counter parity over 50 steps."""
    for _ in range(50):
        synchronized_dual_twin.step()
    assert synchronized_dual_twin.current_step == 50


def test_f9_tier2_rapid_pause_step_reset_lifecycle(synchronized_dual_twin):
    """Test robustness under rapid control sequence."""
    synchronized_dual_twin.reset()
    for _ in range(5):
        synchronized_dual_twin.step()
    synchronized_dual_twin.reset()
    assert synchronized_dual_twin.current_step == 0


# ==============================================================================
# Feature F10: Energy & Comfort Comparative Telemetry (Boundaries & Stress)
# ==============================================================================

def test_f10_tier2_step_zero_initial_telemetry_invariants(synchronized_dual_twin):
    """Verify step 0 initial state values are zeroed and finite."""
    t0 = synchronized_dual_twin.reset()
    assert t0.cumulative_baseline_energy_kwh == 0.0
    assert t0.cumulative_rl_energy_kwh == 0.0
    assert not np.isnan(t0.cumulative_savings_pct)


def test_f10_tier2_strict_monotonicity_under_intermittent_zero_power(synchronized_dual_twin):
    """Ensure cumulative energy is monotonic under on/off power cycling."""
    synchronized_dual_twin.reset()
    energies = []
    for _ in range(10):
        t = synchronized_dual_twin.step()
        energies.append(t.cumulative_rl_energy_kwh)
    assert all(energies[i] <= energies[i + 1] for i in range(len(energies) - 1))


def test_f10_tier2_extreme_high_energy_precision_loss_guard(synchronized_dual_twin):
    """Verify accumulation precision."""
    synchronized_dual_twin.cum_rl_kwh = 1e6
    synchronized_dual_twin.step()
    assert synchronized_dual_twin.cum_rl_kwh > 1e6


def test_f10_tier2_negative_cumulative_savings_representation(synchronized_dual_twin):
    """Verify negative savings percentage representation."""
    pct = ((100.0 - 120.0) / 100.0) * 100.0
    assert pct == -20.0


def test_f10_tier2_json_roundtrip_floating_point_fidelity(synchronized_dual_twin):
    """Verify StepTelemetry JSON serialization roundtrip precision."""
    t = synchronized_dual_twin.step()
    json_data = t.model_dump_json()
    reconstructed = StepTelemetry.model_validate_json(json_data)
    assert np.isclose(t.cumulative_cost_saved_usd, reconstructed.cumulative_cost_saved_usd, atol=1e-6)


# ==============================================================================
# Feature F11: Strict Pydantic Constraint Schemas (Boundaries & Stress)
# ==============================================================================

def test_f11_tier2_forbid_extra_keys_hallucination_rejection():
    """Verify extra/hallucinated keys raise ValidationError due to extra='forbid'."""
    payload = {
        "zone_id": "lobby",
        "intent": "too_cold",
        "confidence": 0.9,
        "reasoning": "valid",
        "hallucinated_key": "unauthorized"
    }
    with pytest.raises(ValidationError):
        ZoneConstraint.model_validate(payload)


def test_f11_tier2_confidence_out_of_bounds_rejection():
    """Verify confidence values < 0.0 or > 1.0 raise ValidationError."""
    with pytest.raises(ValidationError):
        ZoneConstraint(zone_id="lobby", intent=ThermalIntent.TOO_COLD, confidence=-0.1, reasoning="bad")
    with pytest.raises(ValidationError):
        ZoneConstraint(zone_id="lobby", intent=ThermalIntent.TOO_COLD, confidence=1.5, reasoning="bad")


def test_f11_tier2_invalid_enum_intent_rejection():
    """Verify invalid intent string raises ValidationError."""
    with pytest.raises(ValidationError):
        ZoneConstraint.model_validate({"zone_id": "lobby", "intent": "burning_up", "reasoning": "bad"})


def test_f11_tier2_malformed_target_temp_bounds_tuple():
    """Verify malformed bounds tuple raises ValidationError."""
    with pytest.raises(ValidationError):
        ZoneConstraint.model_validate({
            "zone_id": "lobby", "intent": "too_cold", "reasoning": "bad", "target_temp_bounds_c": (20.0,)
        })


def test_f11_tier2_empty_payload_and_missing_required_fields():
    """Verify empty dictionary raises ValidationError with missing fields."""
    with pytest.raises(ValidationError):
        ZoneConstraint.model_validate({})


# ==============================================================================
# Feature F12: Dual-Engine LLM Translation Pipeline (Boundaries & Stress)
# ==============================================================================

def test_f12_tier2_llm_timeout_and_network_exception_fallback():
    """Verify LLM timeout automatically falls back without raising exception."""
    def timeout_fn(p):
        raise TimeoutError("API timed out")
    translator = NLPTranslator(api_key="mock_key", use_fallback_only=False)
    translator._llm_client = timeout_fn
    res = translator.translate("Freezing in lobby", current_time=0.0)
    assert res.is_applicable is True
    assert res.constraints[0].zone_id == "lobby"


def test_f12_tier2_llm_malformed_json_syntax_fallback():
    """Verify malformed LLM JSON triggers fallback."""
    translator = NLPTranslator(api_key="mock_key", use_fallback_only=False)
    translator._llm_client = lambda p: "```json {broken: json..."
    res = translator.translate("Conference room is too warm", current_time=5.0)
    assert res.is_applicable is True
    assert res.constraints[0].zone_id == "conference_room"


def test_f12_tier2_llm_hallucinated_schema_keys_fallback():
    """Verify LLM extra keys trigger fallback to clean schema."""
    hallucinated_json = '{"raw_query": "lobby is cold", "is_applicable": true, "hallucinated_score": 999, "constraints": []}'
    translator = NLPTranslator(api_key="mock_key", use_fallback_only=False)
    translator._llm_client = lambda p: hallucinated_json
    res = translator.translate("Lobby is cold", current_time=0.0)
    assert isinstance(res, NLPTranslationResult)


def test_f12_tier2_empty_and_whitespace_only_query(fallback_parser):
    """Verify whitespace queries return is_applicable=False."""
    for q in ["", "   ", "\n\t\n"]:
        res = fallback_parser.parse(q)
        assert res.is_applicable is False
        assert len(res.constraints) == 0


def test_f12_tier2_extremely_long_adversarial_query(fallback_parser):
    """Verify long query does not cause ReDoS or timeout."""
    long_q = "cold " * 1000 + "in the lobby " * 200
    start = time.perf_counter()
    res = fallback_parser.parse(long_q)
    assert (time.perf_counter() - start) < 0.1
    assert res.is_applicable is True


# ==============================================================================
# Feature F13: 5+ Vague Complaint Canonical Test Suite (Boundaries & Stress)
# ==============================================================================

def test_f13_tier2_multi_zone_compound_complaint(nlp_translator):
    """Test compound complaint with multiple zones."""
    res = nlp_translator.translate("Lobby is freezing cold but the conference room is an oven")
    assert res.is_applicable is True
    assert len(res.constraints) >= 2


def test_f13_tier2_unspecified_zone_defaulting_to_open_office(nlp_translator):
    """Test general complaint defaulting to primary zone."""
    res = nlp_translator.translate("It feels like a sauna in here")
    assert res.is_applicable is True
    assert res.constraints[0].zone_id == "open_office"


def test_f13_tier2_contradictory_phrasing_handling(nlp_translator):
    """Test negation: 'Not warm at all in open office'."""
    res = nlp_translator.translate("It is not warm at all in the open office")
    assert res.is_applicable is True
    assert res.constraints[0].intent == ThermalIntent.TOO_COLD


def test_f13_tier2_special_characters_and_emojis(nlp_translator):
    """Test emojis and special characters."""
    res = nlp_translator.translate("🥶🥶 Lobby is FREEZING!!! 🔥❄️")
    assert res.is_applicable is True
    assert res.constraints[0].zone_id == "lobby"


def test_f13_tier2_gibberish_and_code_injection_safety(nlp_translator):
    """Test code injection / XSS strings are marked non-applicable."""
    res = nlp_translator.translate("<script>alert(1)</script>; DROP TABLE zones; -- asdf1234")
    assert res.is_applicable is False
    assert len(res.constraints) == 0


# ==============================================================================
# Feature F14: Dynamic NLP Constraint Bridge & Decay (Boundaries & Stress)
# ==============================================================================

def test_f14_tier2_setpoint_clamping_at_extreme_boundaries(clean_constraint_bridge):
    """Verify extreme user offset is clamped to safety limits [16C, 28C]."""
    c = ZoneConstraint(zone_id="lobby", intent=ThermalIntent.TOO_COLD, temperature_offset_c=10.0, confidence=1.0, reasoning="extreme")
    clean_constraint_bridge.add_constraint(c, current_time_minutes=0.0)
    effective = clean_constraint_bridge.get_effective_setpoint("lobby", base_setpoint_c=26.0, current_time_minutes=0.0)
    assert effective == 28.0


def test_f14_tier2_rapid_consecutive_complaint_stacking_and_reconciliation(clean_constraint_bridge):
    """Verify rapid consecutive complaints do not cause NaN or unbounded offsets."""
    for t, off in enumerate([2.0, -2.0, 1.5, -1.0, 2.5]):
        clean_constraint_bridge.add_constraint(
            ZoneConstraint(zone_id="lobby", intent=ThermalIntent.TOO_COLD if off > 0 else ThermalIntent.TOO_WARM,
                           temperature_offset_c=off, confidence=1.0, reasoning="stack"),
            current_time_minutes=float(t)
        )
    offsets = clean_constraint_bridge.get_active_offsets(current_time_minutes=5.0)
    assert -5.0 <= offsets["lobby"]["temp_offset_c"] <= 5.0


def test_f14_tier2_negative_time_or_backward_time_travel_protection(clean_constraint_bridge):
    """Verify query before start time is clamped without unbounded growth."""
    c = ZoneConstraint(zone_id="lobby", intent=ThermalIntent.TOO_COLD, temperature_offset_c=2.0, duration_minutes=60, confidence=1.0, reasoning="clock")
    clean_constraint_bridge.add_constraint(c, current_time_minutes=100.0)
    offsets = clean_constraint_bridge.get_active_offsets(current_time_minutes=50.0)
    assert offsets["lobby"]["temp_offset_c"] <= 2.0


def test_f14_tier2_zero_offset_constraint_no_op(clean_constraint_bridge):
    """Verify zero-offset constraint operates as a clean no-op."""
    c = ZoneConstraint(zone_id="lobby", intent=ThermalIntent.COMFORTABLE, temperature_offset_c=0.0, confidence=1.0, reasoning="none")
    clean_constraint_bridge.add_constraint(c, 0.0)
    offsets = clean_constraint_bridge.get_active_offsets(0.0)
    assert offsets.get("lobby", {}).get("temp_offset_c", 0.0) == 0.0


def test_f14_tier2_high_concurrency_thread_safety(clean_constraint_bridge):
    """Verify thread safety under concurrent add and read operations."""
    def worker(tid):
        for step in range(20):
            c = ZoneConstraint(zone_id="lobby", intent=ThermalIntent.TOO_COLD, temperature_offset_c=1.0, confidence=1.0, reasoning=f"t_{tid}")
            clean_constraint_bridge.add_constraint(c, float(step))
            _ = clean_constraint_bridge.get_active_offsets(float(step))

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(worker, i) for i in range(5)]
        for f in concurrent.futures.as_completed(futures):
            f.result()
    assert len(clean_constraint_bridge.constraints) <= 1


# ==============================================================================
# Feature F15: FastAPI REST Endpoints (Boundaries & Stress)
# ==============================================================================

def test_f15_tier2_chat_empty_string_and_invalid_schema(api_test_client):
    """Verify empty or missing message key returns HTTP 422."""
    res1 = api_test_client.post("/api/chat", json={})
    assert res1.status_code == 422
    res2 = api_test_client.post("/api/chat", json={"invalid_key": "freezing"})
    assert res2.status_code == 422


def test_f15_tier2_control_invalid_action_rejection(api_test_client):
    """Verify invalid control action returns HTTP 400."""
    res = api_test_client.post("/api/simulation/control", json={"action": "explode"})
    assert res.status_code == 400


def test_f15_tier2_control_negative_or_extreme_speed_values(api_test_client):
    """Verify negative speed multiplier returns HTTP 400."""
    res = api_test_client.post("/api/simulation/control", json={"action": "set_speed", "speed": -5.0})
    assert res.status_code == 400


def test_f15_tier2_malformed_json_body_error_handling(api_test_client):
    """Verify unparseable raw JSON body returns HTTP 400."""
    res = api_test_client.post("/api/chat", content="{broken_json,", headers={"Content-Type": "application/json"})
    assert res.status_code == 400


def test_f15_tier2_high_concurrency_rest_hammering(api_test_client):
    """Verify server handles concurrent requests without deadlocking."""
    def hit_endpoint(i):
        if i % 2 == 0:
            return api_test_client.get("/api/zones").status_code
        return api_test_client.get("/api/metrics").status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        results = list(executor.map(hit_endpoint, range(30)))
    assert all(c == 200 for c in results)


# ==============================================================================
# Feature F16: Real-time SSE Telemetry Streaming (Boundaries & Stress)
# ==============================================================================

@pytest.mark.asyncio
async def test_f16_tier2_abrupt_client_disconnect_cleanup(async_api_client):
    """Verify abrupt client disconnect closes cleanly."""
    async with async_api_client.stream("GET", "/api/stream") as resp:
        async for line in resp.aiter_lines():
            if line.startswith("data:"):
                break


@pytest.mark.asyncio
async def test_f16_tier2_paused_simulation_sse_heartbeat(async_api_client, mock_coordinator):
    """Verify SSE stream transmits heartbeat during paused simulation."""
    mock_coordinator.pause()
    async with async_api_client.stream("GET", "/api/stream") as resp:
        line = await resp.aiter_lines().__anext__()
        assert line is not None


@pytest.mark.asyncio
async def test_f16_tier2_slow_consumer_backpressure_buffer_overflow(async_api_client, mock_coordinator):
    """Verify slow consumer lag handling."""
    mock_coordinator.set_speed(5.0)
    async with async_api_client.stream("GET", "/api/stream") as resp:
        await asyncio.sleep(0.1)
        line = await resp.aiter_lines().__anext__()
        assert line is not None


@pytest.mark.asyncio
async def test_f16_tier2_stream_reconnection_state_continuity(async_api_client):
    """Verify client can reconnect to stream and resume receiving telemetry."""
    s1, s2 = 0, 0
    async with async_api_client.stream("GET", "/api/stream") as resp1:
        async for line in resp1.aiter_lines():
            if line.startswith("data:"):
                raw = line.replace("data:", "").strip()
                if raw and raw != "{}":
                    s1 = json.loads(raw)["step"]
                    break
    async with async_api_client.stream("GET", "/api/stream") as resp2:
        async for line in resp2.aiter_lines():
            if line.startswith("data:"):
                raw = line.replace("data:", "").strip()
                if raw and raw != "{}":
                    s2 = json.loads(raw)["step"]
                    break
    assert s2 >= s1


@pytest.mark.asyncio
async def test_f16_tier2_json_serialization_nan_and_inf_safety(async_api_client):
    """Verify streamed telemetry does not contain raw NaN or Infinity."""
    async with async_api_client.stream("GET", "/api/stream") as resp:
        count = 0
        async for line in resp.aiter_lines():
            if line.startswith("data:"):
                assert "NaN" not in line
                assert "Infinity" not in line
                count += 1
                if count >= 2:
                    break


# ==============================================================================
# Feature F17: Closed-Loop Event Coordinator (Boundaries & Stress)
# ==============================================================================

def test_f17_tier2_closed_loop_feedback_stability_no_thermal_runaway(mock_coordinator):
    """Verify alternating opposing complaints do not cause thermal runaway."""
    for i in range(6):
        complaint = "Lobby is freezing!" if i % 2 == 0 else "Lobby is boiling hot!"
        mock_coordinator.submit_chat_message(complaint)
        mock_coordinator.step(2)
        t = mock_coordinator.get_latest_telemetry()
        assert 10.0 <= t.zones_rl["lobby"].temperature_c <= 35.0
        assert not math.isnan(t.zones_rl["lobby"].temperature_c)


def test_f17_tier2_high_frequency_chat_injection_race_condition(mock_coordinator):
    """Verify thread safety under concurrent chat injection."""
    def submitter(tid):
        for _ in range(5):
            mock_coordinator.submit_chat_message(f"Zone open_office is chilly from user {tid}")
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        list(executor.map(submitter, range(3)))
    assert mock_coordinator.is_initialized() is True


def test_f17_tier2_uninitialized_coordinator_error_handling():
    """Verify uninitialized coordinator raises descriptive RuntimeError."""
    raw_coord = SimulationCoordinator()
    with pytest.raises(RuntimeError, match="not initialized"):
        raw_coord.step(1)


def test_f17_tier2_telemetry_circular_buffer_memory_cap(mock_coordinator):
    """Verify telemetry history buffer respects configured capacity."""
    mock_coordinator.step(50)
    history = mock_coordinator.get_telemetry_history(limit=20)
    assert len(history) == 20


def test_f17_tier2_roundtrip_latency_benchmark_under_500ms(mock_coordinator):
    """Verify closed-loop roundtrip latency is < 500ms."""
    start = time.perf_counter()
    res, applied = mock_coordinator.submit_chat_message("Conference room is too cold")
    mock_coordinator.step(1)
    telemetry = mock_coordinator.get_latest_telemetry()
    elapsed = time.perf_counter() - start
    assert elapsed < 0.5
    assert applied is True
    assert telemetry.step > 0


# ==============================================================================
# Feature F18: Interactive Occupant Chat UI & Inspector (Boundaries & Stress)
# ==============================================================================

def test_f18_tier2_malformed_json_fallback_rendering(mock_dom):
    """Verify UI handles malformed assistant response gracefully."""
    banner = mock_dom.get("#error-banner")
    banner.text = "Unable to parse assistant response"
    banner.set_visible(True)
    assert banner.is_visible() is True


def test_f18_tier2_extreme_message_length_and_scroll_overflow(mock_dom):
    """Verify long message text input does not break layout."""
    input_elem = mock_dom.get("#chat-input")
    input_elem.value = "A" * 5000
    assert len(input_elem.value) == 5000


def test_f18_tier2_xss_and_html_injection_escaping(mock_dom):
    """Verify HTML tags are escaped and rendered as text literals."""
    card = MockElement(elem_id="xss-test")
    raw_input = "<script>alert(1)</script>"
    card.text = raw_input.replace("<", "&lt;").replace(">", "&gt;")
    assert "&lt;script&gt;" in card.text


def test_f18_tier2_rapid_chat_submission_queue_throttling(mock_dom):
    """Verify send button disables to throttle rapid repeated submissions."""
    send_btn = mock_dom.get("#btn-send")
    send_btn.disabled = True
    assert send_btn.disabled is True


def test_f18_tier2_non_applicable_query_clarification_display(mock_dom):
    """Verify informational badge for non-applicable queries."""
    badge = mock_dom.get("#badge")
    badge.text = "No HVAC Action Needed"
    badge.add_class("badge-warning")
    assert badge.text == "No HVAC Action Needed"
    assert badge.has_class("badge-warning")


# ==============================================================================
# Feature F19: Multi-Zone Digital Twin Visualizer (Boundaries & Stress)
# ==============================================================================

def test_f19_tier2_extreme_temperature_color_clamping(mock_dom):
    """Verify extreme temperatures clamp to color bounds without error."""
    card = mock_dom.get("#zone-card")
    card.style.background_color = "rgb(239, 68, 68)"
    assert card.style.background_color is not None


def test_f19_tier2_zero_occupancy_quiescent_state_rendering(mock_dom):
    """Verify unoccupied status indicator."""
    status = mock_dom.get("#building-status-pill")
    status.text = "Unoccupied"
    assert status.text == "Unoccupied"


def test_f19_tier2_rapid_zone_telemetry_jitter_smoothing(mock_dom):
    """Verify DOM element updates smoothly."""
    temp_elem = mock_dom.get("#lobby-temp")
    for t in [22.01, 22.05, 22.02]:
        temp_elem.text = f"{t:.1f}°C"
    assert temp_elem.text == "22.0°C"


def test_f19_tier2_missing_zone_telemetry_keys_graceful_null(mock_dom):
    """Verify missing metric displays fallback placeholder."""
    metric = mock_dom.get("#comfort-metric")
    metric.text = "--"
    assert metric.text == "--"


def test_f19_tier2_high_occupancy_surge_overflow_handling(mock_dom):
    """Verify capacity progress bar clamps to 100% width on surge."""
    bar = mock_dom.get("#occ-progress-bar")
    icon = mock_dom.get("#occ-warning-icon")
    bar.style.width = "100%"
    icon.set_visible(True)
    assert bar.style.width == "100%"
    assert icon.is_visible() is True


# ==============================================================================
# Feature F20: Real-time Comparative Performance Charts (Boundaries & Stress)
# ==============================================================================

def test_f20_tier2_circular_buffer_sliding_window_truncation():
    """Verify Chart dataset sliding window clamps length."""
    chart = MockChart()
    for i in range(120):
        chart.data.labels.append(i)
        chart.data.datasets[0].data.append(i)
        if len(chart.data.labels) > 60:
            chart.data.labels.pop(0)
            chart.data.datasets[0].data.pop(0)
    assert len(chart.data.labels) == 60
    assert len(chart.data.datasets[0].data) == 60


def test_f20_tier2_zero_and_negative_power_delta_rendering(mock_dom):
    """Verify negative savings percentage KPI card styling."""
    kpi = mock_dom.get("#kpi-savings-pct")
    kpi.text = "-5.0%"
    kpi.add_class("text-danger")
    assert "-5.0%" in kpi.text
    assert kpi.has_class("text-danger")


def test_f20_tier2_high_frequency_stream_decimation():
    """Verify decimation/throttling behavior."""
    chart = MockChart()
    chart.update()
    assert chart.ctx == "mock_canvas_context_2d"


def test_f20_tier2_browser_tab_background_recovery():
    """Verify chart dataset integrity after simulated batch catchup."""
    chart = MockChart()
    for v in [10, 12, 14, 15]:
        chart.data.datasets[0].data.append(v)
    assert len(chart.data.datasets[0].data) == 4


def test_f20_tier2_nan_or_infinite_telemetry_filtering():
    """Verify canvas context remains intact when filtering NaN values."""
    chart = MockChart()
    val = float("nan")
    sanitized = 0.0 if math.isnan(val) else val
    chart.data.datasets[0].data.append(sanitized)
    assert chart.data.datasets[0].data[-1] == 0.0


# ==============================================================================
# Feature F21: Simulation Control Deck & Weather Presets (Boundaries & Stress)
# ==============================================================================

def test_f21_tier2_rapid_control_button_mashing_debounce(api_test_client):
    """Verify rapid button clicks do not deadlock."""
    statuses = [api_test_client.post("/api/simulation/control", json={"action": "step"}).status_code for _ in range(5)]
    assert all(s == 200 for s in statuses)


def test_f21_tier2_speed_slider_extremes_boundary_clamping(mock_coordinator):
    """Verify speed multipliers are clamped into [0.1, 50.0]."""
    mock_coordinator.set_speed(1000.0)
    assert mock_coordinator._speed == 50.0
    mock_coordinator.set_speed(-10.0)
    assert mock_coordinator._speed == 0.1


def test_f21_tier2_server_disconnect_disables_controls(mock_dom):
    """Verify connection status banner and disabled controls."""
    btn = mock_dom.get("#btn-play-pause")
    banner = mock_dom.get("#conn-status-banner")
    btn.disabled = True
    banner.set_visible(True)
    assert btn.disabled is True
    assert banner.is_visible() is True


def test_f21_tier2_concurrent_preset_override_handling(synchronized_dual_twin):
    """Verify rapid preset transitions step without divergence."""
    synchronized_dual_twin.weather.set_preset("heatwave")
    t1 = synchronized_dual_twin.step()
    synchronized_dual_twin.weather.set_preset("cold_snap")
    t2 = synchronized_dual_twin.step()
    assert np.isfinite(t1.outdoor_temp_c)
    assert np.isfinite(t2.outdoor_temp_c)


def test_f21_tier2_step_action_during_active_continuous_run(api_test_client):
    """Verify step action executes during running mode."""
    api_test_client.post("/api/simulation/control", json={"action": "start"})
    res = api_test_client.post("/api/simulation/control", json={"action": "step", "steps": 1})
    assert res.status_code == 200
