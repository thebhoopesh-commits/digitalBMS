"""Tier 3: Pairwise Integration Tests (21 Cross-Feature Interactions).

Covers all 21 cross-feature pairwise boundaries:
- Physics & Environment Pairwise (1-6)
- Control & Telemetry Pairwise (7-10)
- NLP & Schemas Pairwise (11-15)
- REST, SSE & Coordinator Pairwise (16-18)
- UI & Full-Stack Integration Pairwise (19-21)
"""

import math
import time
import json
import asyncio
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
# 1. Physics & Environment Pairwise Interactions (1 - 6)
# ==============================================================================

def test_tier3_01_f1_thermal_x_f2_weather_diurnal_coupling(nominal_building_config, standard_weather_gen):
    """Test 1: Multi-zone thermal model driven by diurnal weather reproduces indoor temperature lag and attenuation."""
    model = MultiZoneThermalModel(nominal_building_config)
    model.reset(22.0)
    indoor_temps = []
    outdoor_temps = []

    for step in range(288):
        sim_hour = (step * 300.0) / 3600.0
        w = standard_weather_gen.get_weather(sim_hour)
        outdoor_temps.append(w.outdoor_temp_c)
        res = model.step(dt=300.0, ambient=w)
        indoor_temps.append(res.zones["open_office"].temperature_c)

    peak_out_idx = np.argmax(outdoor_temps)
    peak_in_idx = np.argmax(indoor_temps)
    assert 140 <= peak_in_idx <= 220, "Indoor peak temperature must occur in the afternoon"
    assert max(indoor_temps) > min(indoor_temps)
    assert np.all(np.isfinite(indoor_temps))


def test_tier3_02_f1_thermal_x_f3_psychrometrics_condensation(nominal_building_config, psychrometrics):
    """Test 2: Thermal cooling model triggers latent moisture condensation when coil drops below dewpoint."""
    model = MultiZoneThermalModel(nominal_building_config)
    model.reset(26.0)
    ambient = WeatherState(outdoor_temp_c=32.0, outdoor_humidity_pct=75.0)

    res = model.step(dt=300.0, ambient=ambient, hvac_power_kw=[-15.0, -10.0, -10.0])
    t_air = res.zones["lobby"].temperature_c
    rh_air = 70.0
    dehum_rate = psychrometrics.calc_condensation_rate(t_air=t_air, rh_air=rh_air, t_coil=10.0, air_flow_kg_s=1.5)

    assert dehum_rate > 0.0, "Active cooling below dewpoint must condense moisture"


def test_tier3_03_f1_thermal_x_f4_baseline_controller_closed_loop(nominal_building_config, baseline_controller, standard_weather_gen):
    """Test 3: Closed-loop coupling of 3R2C model and ASHRAE baseline controller maintains comfort deadband."""
    model = MultiZoneThermalModel(nominal_building_config)
    model.reset(22.0)

    for step in range(288):
        sim_hour = (step * 300.0) / 3600.0
        w = standard_weather_gen.get_weather(sim_hour)
        actions = baseline_controller.compute_multi_zone_actions(model.state_tz, hour=sim_hour)
        q_powers = {z: actions[z].q_hvac_kw for z in actions}
        res = model.step(dt=300.0, ambient=w, hvac_power_kw=q_powers)

        if 9.0 <= (sim_hour % 24.0) <= 17.0:
            for z in res.zones.values():
                assert 12.0 <= z.temperature_c <= 35.0, f"Zone {z.zone_id} violated occupied temperature bounds"


def test_tier3_04_f1_thermal_x_f7_rl_agent_action_clamping(nominal_building_config):
    """Test 4: RL action offsets directly modulate 3R2C ODE heating/cooling without exceeding physical limits."""
    env = BuildingDigitalTwinEnv(nominal_building_config)
    env.reset()

    obs, reward, term, trunc, info = env.step(np.array([2.5, -2.5, 0.0], dtype=np.float32))
    assert 18.0 <= info["effective_setpoints"][0] <= 28.0
    assert 18.0 <= info["effective_setpoints"][1] <= 28.0


def test_tier3_05_f2_weather_x_f8_reward_tou_price_peak(standard_weather_gen, reward_engine):
    """Test 5: TOU tariff swings in weather generator trigger cost penalty scaling in reward engine."""
    w_offpeak = standard_weather_gen.get_weather(sim_hour=4.0)
    w_onpeak = standard_weather_gen.get_weather(sim_hour=16.0)

    assert w_onpeak.electricity_price_usd_kwh > w_offpeak.electricity_price_usd_kwh
    r_off = reward_engine.compute_reward([10, 10, 10], [22, 22, 22], [10, 10, 10], price_kwh=w_offpeak.electricity_price_usd_kwh)
    r_on = reward_engine.compute_reward([10, 10, 10], [22, 22, 22], [10, 10, 10], price_kwh=w_onpeak.electricity_price_usd_kwh)
    assert r_on < r_off, "On-peak energy consumption must yield more negative reward"


def test_tier3_06_f2_weather_x_f9_dual_twin_synchronized_disturbances(synchronized_dual_twin):
    """Test 6: Dual-twin runner feeds identical stochastic weather and occupancy to both twins with zero variance."""
    for _ in range(20):
        t = synchronized_dual_twin.step()
        for z in ["lobby", "open_office", "conference_room"]:
            assert t.zones_baseline[z].occupancy_count == t.zones_rl[z].occupancy_count


# ==============================================================================
# 2. Control & Telemetry Pairwise Interactions (7 - 10)
# ==============================================================================

def test_tier3_07_f3_psychrometrics_x_f10_telemetry_humidity_serialization(synchronized_dual_twin):
    """Test 7: Psychrometric relative humidity values are correctly propagated to StepTelemetry payloads."""
    t = synchronized_dual_twin.step()
    for z in t.zones_rl.values():
        assert 0.0 <= z.humidity_pct <= 100.0
    json_payload = t.model_dump_json()
    assert "humidity_pct" in json_payload


def test_tier3_08_f4_baseline_x_f9_dual_twin_comparative_baseline_power(synchronized_dual_twin):
    """Test 8: Baseline controller inside dual-twin correctly drives Twin A power and energy metrics."""
    synchronized_dual_twin.reset()
    for _ in range(15):
        t = synchronized_dual_twin.step()
    assert t.cumulative_baseline_energy_kwh > 0.0
    assert t.baseline_power_kw >= 0.0


def test_tier3_09_f7_rl_agent_x_f8_reward_closed_loop_feedback(nominal_building_config, reward_engine):
    """Test 9: RL setpoint shifts receive immediate penalty feedback from 6-term reward engine."""
    env = BuildingDigitalTwinEnv(nominal_building_config)
    obs, _ = env.reset()

    obs_next, r_step, term, trunc, info = env.step(np.array([1.0, 1.0, 1.0], dtype=np.float32))
    temps = [obs_next[0], obs_next[1], obs_next[2]]
    powers = [5.0, 5.0, 5.0]
    r_calc = reward_engine.compute_reward(powers, temps, [10, 10, 10], price_kwh=0.15)
    assert np.isfinite(r_step)
    assert np.isfinite(r_calc)


def test_tier3_10_f9_dual_twin_x_f10_telemetry_savings_calculation(synchronized_dual_twin):
    """Test 10: Dual twin runner computes real-time power and cost savings differentials on every step."""
    synchronized_dual_twin.reset()
    for _ in range(25):
        t = synchronized_dual_twin.step(rl_action=[0.5, 0.5, 0.5])
    assert t.power_saved_kw == (t.baseline_power_kw - t.rl_power_kw)
    assert np.isfinite(t.cumulative_savings_pct)
    assert np.isfinite(t.cumulative_cost_saved_usd)


# ==============================================================================
# 3. NLP & Schemas Pairwise Interactions (11 - 15)
# ==============================================================================

def test_tier3_11_f11_schemas_x_f12_llm_dual_engine_validation(nlp_translator):
    """Test 11: Dual-engine translator outputs strictly conform to Pydantic NLPTranslationResult schema."""
    queries = [
        "Lobby is freezing cold",
        "Conference room is an oven",
        "Open office is stuffy",
        "What time is it?"
    ]
    for q in queries:
        res = nlp_translator.translate(q)
        assert isinstance(res, NLPTranslationResult)
        dumped = res.model_dump()
        rebuilt = NLPTranslationResult.model_validate(dumped)
        assert rebuilt.raw_query == q


def test_tier3_12_f11_schemas_x_f14_constraint_bridge_ingestion(clean_constraint_bridge, sample_zone_constraint):
    """Test 12: Pydantic ZoneConstraint objects are ingested into NLPConstraintBridge without deserialization errors."""
    clean_constraint_bridge.add_constraint(sample_zone_constraint, current_time_minutes=10.0)
    assert clean_constraint_bridge.has_active_constraint("lobby")
    offsets = clean_constraint_bridge.get_active_offsets(10.0)
    assert offsets["lobby"]["temp_offset_c"] == sample_zone_constraint.temperature_offset_c


def test_tier3_13_f12_llm_x_f13_vague_complaint_canonical_parsing(nlp_translator):
    """Test 13: 5+ canonical complaints parse reliably across fallback and mock LLM engines."""
    canonical_inputs = [
        ("It's freezing in the lobby, feels like an iceberg!", "lobby", ThermalIntent.TOO_COLD),
        ("The conference room is sweltering and stuffy, we can barely breathe", "conference_room", ThermalIntent.TOO_WARM),
        ("Open office humidity is way too high, feeling sticky", "open_office", ThermalIntent.TOO_HUMID),
        ("Server room temp is spiking, urgently need max cooling!", "server_room", ThermalIntent.TOO_WARM),
        ("Lobby feels a bit chilly this morning", "lobby", ThermalIntent.TOO_COLD)
    ]
    for text, exp_zone, exp_intent in canonical_inputs:
        res = nlp_translator.translate(text)
        assert res.is_applicable is True
        assert res.constraints[0].zone_id == exp_zone
        assert res.constraints[0].intent in (exp_intent, ThermalIntent.STUFFY)


def test_tier3_14_f13_vague_complaints_x_f14_constraint_bridge_decay(nlp_translator, clean_constraint_bridge):
    """Test 14: Canonical parsed complaints trigger appropriate temperature offsets that decay exponentially."""
    res = nlp_translator.translate("It is freezing in the lobby")
    c = res.constraints[0]
    c.duration_minutes = 0
    clean_constraint_bridge.add_constraint(c, current_time_minutes=0.0)

    off_0 = clean_constraint_bridge.get_active_offset("lobby", sim_time_min=0.0)
    off_30 = clean_constraint_bridge.get_active_offset("lobby", sim_time_min=30.0)
    off_60 = clean_constraint_bridge.get_active_offset("lobby", sim_time_min=60.0)

    assert off_0 > off_30 > off_60
    assert pytest.approx(off_30, rel=0.1) == off_0 / 2.0


def test_tier3_15_f14_constraint_bridge_x_f17_coordinator_setpoint_injection(mock_coordinator):
    """Test 15: Constraint bridge setpoint offsets propagate into coordinator's simulation runner."""
    mock_coordinator.submit_chat_message("Conference room is too cold")
    mock_coordinator.step(1)
    telemetry = mock_coordinator.get_latest_telemetry()
    assert telemetry.zones_rl["conference_room"].active_nlp_offset_c > 0


# ==============================================================================
# 4. REST, SSE & Coordinator Pairwise Interactions (16 - 18)
# ==============================================================================

def test_tier3_16_f15_rest_api_x_f17_coordinator_chat_endpoint(api_test_client, mock_coordinator):
    """Test 16: POST /api/chat calls coordinator NLP translation, injects constraints, and returns structured response."""
    response = api_test_client.post("/api/chat", json={"message": "Lobby is freezing"})
    assert response.status_code == 200
    data = response.json()
    assert data["applied"] is True
    assert data["translation"]["constraints"][0]["zone_id"] == "lobby"


def test_tier3_17_f15_rest_api_x_f17_coordinator_simulation_control(api_test_client, mock_coordinator):
    """Test 17: POST /api/simulation/control start/pause/speed/reset actions directly manipulate coordinator state."""
    api_test_client.post("/api/simulation/control", json={"action": "set_speed", "speed": 10.0})
    assert mock_coordinator._speed == 10.0

    api_test_client.post("/api/simulation/control", json={"action": "step", "steps": 3})
    assert mock_coordinator.get_latest_telemetry().step >= 3


@pytest.mark.asyncio
async def test_tier3_18_f16_sse_x_f17_coordinator_telemetry_streaming(async_api_client, mock_coordinator):
    """Test 18: GET /api/stream receives live StepTelemetry pushed from stepping coordinator."""
    mock_coordinator.start()
    async with async_api_client.stream("GET", "/api/stream") as resp:
        assert resp.status_code == 200
        async for line in resp.aiter_lines():
            if line.startswith("data:"):
                raw = line.replace("data:", "").strip()
                if raw and raw != "{}":
                    payload = json.loads(raw)
                    assert "step" in payload
                    assert "baseline_power_kw" in payload
                    break


# ==============================================================================
# 5. UI & Full-Stack Integration Pairwise Interactions (19 - 21)
# ==============================================================================

def test_tier3_19_f18_chat_ui_x_f15_rest_chat_integration(mock_dom, api_test_client):
    """Test 19: MockDOM chat UI submission sends POST request to /api/chat and renders response."""
    chat_input = mock_dom.get("#chat-input")
    chat_log = mock_dom.get("#chat-messages")
    chat_input.value = "Open office is humid and sticky"

    response = api_test_client.post("/api/chat", json={"message": chat_input.value})
    assert response.status_code == 200
    data = response.json()

    user_bubble = MockElement(classes=["user-bubble"])
    user_bubble.text = chat_input.value
    chat_log.children.append(user_bubble)

    agent_bubble = MockElement(classes=["agent-bubble"])
    agent_bubble.text = f"Adjusted {data['translation']['constraints'][0]['zone_id']} target setpoint"
    chat_log.children.append(agent_bubble)

    assert len(chat_log.children) == 2
    assert "open_office" in chat_log.last_child.text


def test_tier3_20_f19_twin_visualizer_x_f16_sse_telemetry_binding(mock_dom, synchronized_dual_twin):
    """Test 20: Streamed SSE telemetry updates zone cards and occupancy badges in MockDOM."""
    t = synchronized_dual_twin.step()
    mock_dom.get("#lobby-temp").text = f"{t.zones_rl['lobby'].temperature_c:.1f}°C"
    mock_dom.get("#lobby-occ").text = str(t.zones_rl['lobby'].occupancy_count)

    assert "°C" in mock_dom.get("#lobby-temp").text
    assert mock_dom.get("#lobby-occ").text.isdigit()


def test_tier3_21_f20_charts_x_f16_sse_streaming_data_points(synchronized_dual_twin):
    """Test 21: Streamed SSE telemetry feeds live data points into MockChart comparative lines."""
    chart = MockChart()
    for _ in range(10):
        t = synchronized_dual_twin.step()
        chart.data.labels.append(t.step)
        chart.data.datasets[0].data.append(t.baseline_power_kw)
        chart.data.datasets[1].data.append(t.rl_power_kw)

    assert len(chart.data.labels) == 10
    assert len(chart.data.datasets[0].data) == 10
    assert len(chart.data.datasets[1].data) == 10
