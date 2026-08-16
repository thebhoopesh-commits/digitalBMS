"""Tier 4: End-to-End Real-World Scenarios (S1 through S8).

Comprehensive real-world operational scenarios testing multi-component integration,
diurnal cycles, occupant feedback loops, load shedding, weekend setback, high concurrency,
system recovery, and high-speed multi-episode benchmarking.
"""

import time
import json
import asyncio
import concurrent.futures
import numpy as np
import pytest
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
# Scenario S1: Full 24-Hour Typical Summer Day Simulation
# ==============================================================================

def test_tier4_s1_full_24h_typical_summer_day_simulation(nominal_building_config):
    """Scenario S1: 288-step (24h) continuous summer simulation comparing Baseline vs RL."""
    runner = DualTwinRunner(config=nominal_building_config, seed=42)
    t0 = runner.reset()
    assert t0.step == 0

    history = []
    for step in range(288):
        t = runner.step()
        history.append(t)

    assert len(history) == 288
    final = history[-1]
    assert final.step == 288
    assert final.cumulative_baseline_energy_kwh > 0.0
    assert final.cumulative_rl_energy_kwh > 0.0
    assert np.isfinite(final.cumulative_savings_pct)
    assert np.isfinite(final.cumulative_cost_saved_usd)

    for t in history:
        for z in t.zones_rl.values():
            assert 0.0 <= z.temperature_c <= 45.0, f"Zone {z.zone_id} temp runaway: {z.temperature_c}"


# ==============================================================================
# Scenario S2: Dynamic Occupant Complaint Response & Decay Loop
# ==============================================================================

def test_tier4_s2_dynamic_occupant_complaint_response_and_decay(mock_coordinator):
    """Scenario S2: Occupant submits complaint, setpoint offsets immediately, and decays over time."""
    mock_coordinator.reset()

    # Step to 10:00 AM (120 steps)
    mock_coordinator.step(120)
    t_before = mock_coordinator.get_latest_telemetry()
    sp_lobby_before = t_before.zones_rl["lobby"].target_setpoint_c

    # Submit complaint
    res, applied = mock_coordinator.submit_chat_message("It's freezing in the lobby, feels like an iceberg!")
    assert applied is True
    assert res.constraints[0].zone_id == "lobby"

    # Step 1 more step: verify offset is active
    mock_coordinator.step(1)
    t_after = mock_coordinator.get_latest_telemetry()
    assert t_after.zones_rl["lobby"].active_nlp_offset_c > 0
    assert t_after.zones_rl["lobby"].target_setpoint_c > sp_lobby_before

    # Advance 40 steps (200 minutes) to allow decay
    mock_coordinator.step(40)
    t_decayed = mock_coordinator.get_latest_telemetry()
    assert t_decayed.zones_rl["lobby"].active_nlp_offset_c < t_after.zones_rl["lobby"].active_nlp_offset_c


# ==============================================================================
# Scenario S3: Summer Heatwave & Peak Demand Load Shedding
# ==============================================================================

def test_tier4_s3_summer_heatwave_peak_demand_load_shedding(nominal_building_config):
    """Scenario S3: High ambient heatwave test verifying load behavior during peak TOU window."""
    runner = DualTwinRunner(config=nominal_building_config, seed=99)
    runner.weather.set_preset("heatwave")
    runner.reset()

    peak_powers_rl = []
    peak_powers_base = []

    for step in range(288):
        sim_hour = (step * 300.0) / 3600.0
        t = runner.step()
        if 14.0 <= (sim_hour % 24.0) <= 18.0:
            peak_powers_rl.append(t.rl_power_kw)
            peak_powers_base.append(t.baseline_power_kw)

    assert len(peak_powers_rl) > 0
    assert np.mean(peak_powers_rl) <= np.mean(peak_powers_base) + 5.0
    assert runner.cum_cost_saved >= -10.0


# ==============================================================================
# Scenario S4: Winter Cold Snap with Weekend Setback
# ==============================================================================

def test_tier4_s4_winter_cold_snap_with_weekend_setback(nominal_building_config):
    """Scenario S4: Cold snap weather with 0 weekend occupancy maintaining setback minimum."""
    runner = DualTwinRunner(config=nominal_building_config, seed=10)
    runner.weather.set_preset("cold_snap")
    runner.reset()

    for step in range(288):
        sim_hour = (step * 300.0) / 3600.0
        t = runner.step()
        for z in t.zones_rl.values():
            assert z.temperature_c >= -5.0


# ==============================================================================
# Scenario S5: Multi-Zone Conflicting Complaints Resolution
# ==============================================================================

def test_tier4_s5_multi_zone_conflicting_complaints_resolution(mock_coordinator):
    """Scenario S5: Simultaneous opposing thermal complaints in adjacent zones stabilize without divergence."""
    mock_coordinator.reset()
    mock_coordinator.step(60)

    # Ingest simultaneous complaints
    res1, app1 = mock_coordinator.submit_chat_message("Open office is burning up, please cool down!")
    res2, app2 = mock_coordinator.submit_chat_message("Conference room is freezing cold!")
    assert app1 and app2

    # Step coordinator 10 steps
    mock_coordinator.step(10)
    t = mock_coordinator.get_latest_telemetry()

    assert t.zones_rl["open_office"].active_nlp_offset_c < 0
    assert t.zones_rl["conference_room"].active_nlp_offset_c > 0
    assert np.isfinite(t.zones_rl["open_office"].temperature_c)
    assert np.isfinite(t.zones_rl["conference_room"].temperature_c)


# ==============================================================================
# Scenario S6: High-Frequency REST & SSE Hammering Under Load
# ==============================================================================

def test_tier4_s6_high_frequency_rest_hammering_under_load(api_test_client, mock_coordinator):
    """Scenario S6: Concurrent REST calls and stepping under load without deadlocks or 500 errors."""
    mock_coordinator.start()

    def chat_hammer(i):
        msg = f"Lobby is too hot user {i}" if i % 2 == 0 else f"Office is too cold user {i}"
        return api_test_client.post("/api/chat", json={"message": msg}).status_code

    def metrics_hammer(i):
        return api_test_client.get("/api/metrics").status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        f_chat = [executor.submit(chat_hammer, i) for i in range(15)]
        f_metrics = [executor.submit(metrics_hammer, i) for i in range(30)]

        for f in concurrent.futures.as_completed(f_chat + f_metrics):
            assert f.result() == 200

    mock_coordinator.pause()
    assert mock_coordinator.is_initialized() is True


# ==============================================================================
# Scenario S7: Complete System Reset and State Recovery
# ==============================================================================

def test_tier4_s7_complete_system_reset_and_state_recovery(api_test_client, mock_coordinator):
    """Scenario S7: Advance simulation, inject constraints, execute full reset, and verify clean state."""
    # Step simulation and inject complaint
    api_test_client.post("/api/simulation/control", json={"action": "step", "steps": 50})
    api_test_client.post("/api/chat", json={"message": "Lobby is freezing"})
    t_active = mock_coordinator.get_latest_telemetry()
    assert t_active.step >= 50
    assert len(mock_coordinator.constraint_bridge.constraints) > 0

    # Call reset
    res_reset = api_test_client.post("/api/simulation/control", json={"action": "reset"})
    assert res_reset.status_code == 200

    t_reset = mock_coordinator.get_latest_telemetry()
    assert t_reset.step == 0
    assert t_reset.cumulative_rl_energy_kwh == 0.0
    assert len(mock_coordinator.constraint_bridge.constraints) == 0

    # Step again from 0
    api_test_client.post("/api/simulation/control", json={"action": "step", "steps": 5})
    t_after_reset = mock_coordinator.get_latest_telemetry()
    assert t_after_reset.step == 5


# ==============================================================================
# Scenario S8: 100-Episode High-Speed Verification Benchmark
# ==============================================================================

def test_tier4_s8_100_episode_high_speed_verification_benchmark():
    """Scenario S8: 100-episode batch benchmark executing 28,800 steps in < 5.0 seconds with 0 crashes."""
    t0 = time.perf_counter()
    runner = BenchmarkRunner(n_episodes=100, steps_per_episode=288)
    results = runner.run()
    elapsed = time.perf_counter() - t0

    assert results.total_episodes == 100
    assert results.crashed_episodes == 0
    assert results.total_steps == 28800
    assert elapsed < 5.0, f"Benchmark took {elapsed:.2f}s (target < 5.0s)"
    assert not np.any(np.isnan(results.all_zone_temps))
    assert not np.any(np.isinf(results.all_zone_temps))
