"""Unit test for MQTT sensor ingestion and zone mapping."""

import pytest
from src.hardware.sensor_manager import get_sensor_manager
from src.hardware.esp32_http import ingest_esp32_payload
from src.hardware.models import Metric
from src.api.coordinator import SimulationCoordinator


def test_mqtt_esp32_environment_ingest():
    manager = get_sensor_manager(reset=True)
    manager.set_device_zone_map({"esp32_occupancy": "lobby"})

    # Test ESP32 #2 environment payloads
    sample_temp = {
        "device_id": "esp32_environment_2",
        "sensor_id": "temp_01",
        "sensor_type": "temperature",
        "zone_id": "zone_01",
        "value": 23.10,
        "unit": "C",
        "sequence": 4601,
        "quality": "good",
    }
    res_temp = ingest_esp32_payload(sample_temp, manager)
    assert res_temp["accepted"] == 1
    assert res_temp["rejected"] == 0

    sample_humidity = {
        "device_id": "esp32_environment_2",
        "sensor_id": "humidity_01",
        "sensor_type": "humidity",
        "zone_id": "zone_01",
        "value": 68.60,
        "unit": "%RH",
        "sequence": 4602,
        "quality": "good",
    }
    res_hum = ingest_esp32_payload(sample_humidity, manager)
    assert res_hum["accepted"] == 1
    assert res_hum["rejected"] == 0

    # Verify zone_01 maps to lobby
    t_snap = manager.get("lobby", Metric.TEMPERATURE)
    assert t_snap.has_value
    assert t_snap.value == pytest.approx(23.10, abs=0.01)

    h_snap = manager.get("lobby", Metric.HUMIDITY)
    assert h_snap.has_value
    assert h_snap.value == pytest.approx(68.60, abs=0.01)


def test_mqtt_esp32_occupancy_ingest():
    manager = get_sensor_manager(reset=True)
    manager.set_device_zone_map({"esp32_occupancy": "lobby"})

    # Test ESP32 #1 occupancy payload
    sample_occ = {
        "device_id": "esp32_occupancy",
        "distance_cm": 125.4,
    }
    res_occ = ingest_esp32_payload(sample_occ, manager)
    assert res_occ["accepted"] == 2  # distance + derived occupancy

    dist_snap = manager.get("lobby", Metric.DISTANCE)
    assert dist_snap.has_value
    assert dist_snap.value == pytest.approx(125.4, abs=0.01)

    occ_snap = manager.get("lobby", Metric.OCCUPANCY)
    assert occ_snap.has_value
    assert occ_snap.value == 1.0


def test_coordinator_sync_physical_telemetry():
    manager = get_sensor_manager(reset=True)
    manager.set_device_zone_map({"esp32_occupancy": "lobby"})

    # Ingest samples for lobby and open_office
    ingest_esp32_payload({
        "device_id": "esp32_environment_2",
        "sensor_id": "temp_01",
        "sensor_type": "temperature",
        "zone_id": "zone_01",
        "value": 23.50,
        "unit": "C",
    }, manager)

    ingest_esp32_payload({
        "device_id": "esp32_environment_2",
        "sensor_id": "temp_02",
        "sensor_type": "temperature",
        "zone_id": "zone_02",
        "value": 22.80,
        "unit": "C",
    }, manager)

    coord = SimulationCoordinator()
    coord.initialize()

    latest = coord.get_latest_telemetry()
    assert latest is not None
    assert "lobby" in latest.zones_rl
    assert latest.zones_rl["lobby"].temperature_c == pytest.approx(23.50, abs=0.01)
    assert latest.zones_rl["open_office"].temperature_c == pytest.approx(22.80, abs=0.01)


def test_chat_endpoint_emits_llm_json():
    import json
    from unittest.mock import patch
    from fastapi.testclient import TestClient
    from src.api.server import app

    client = TestClient(app)

    # 1. Test fast-path telemetry lookup
    resp = client.post("/api/chat", json={"message": "what is the temperature in the open office"})
    assert resp.status_code == 200
    events = [
        json.loads(line[6:])
        for line in resp.text.split("\n")
        if line.startswith("data: ")
    ]
    final_event = next(e for e in events if "applied" in e)
    assert "llm_json" in final_event
    assert final_event["llm_json"]["domain"] == "thermal"
    assert final_event["llm_json"]["location"] == "open_office"
    assert "model" in final_event

    # 2. Test Qwen3:1.7b model output parsing and structured JSON extraction
    mock_qwen_output = (
        "Response: Understood, increasing cooling for the lobby right away.\n"
        'JSON: {"domain": "thermal", "sensation": "too_hot", "location": "lobby", '
        '"intensity": 4, "action_requested": "increase_cooling", "confidence": 0.96}'
    )

    def mock_stream(*args, **kwargs):
        for ch in [mock_qwen_output[:20], mock_qwen_output[20:50], mock_qwen_output[50:]]:
            yield ch

    with patch.dict("os.environ", {"OLLAMA_URL": "http://127.0.0.1:11434", "OLLAMA_MODEL": "qwen3:1.7b"}):
        with patch("src.nlp.local_translator.OllamaBackend.health_check", return_value=True):
            with patch("src.nlp.local_translator.OllamaBackend.generate_stream", side_effect=mock_stream):
                resp2 = client.post("/api/chat", json={"message": "Lobby is boiling hot!"})
                assert resp2.status_code == 200
                events2 = [
                    json.loads(line[6:])
                    for line in resp2.text.split("\n")
                    if line.startswith("data: ")
                ]
                final2 = next(e for e in events2 if "applied" in e)
                assert final2["applied"] is True
                assert final2["model"] == "qwen3:1.7b"
                assert "llm_json" in final2
                assert final2["llm_json"]["domain"] == "thermal"
                assert final2["llm_json"]["sensation"] == "too_hot"
                assert final2["llm_json"]["location"] == "lobby"
                assert final2["llm_json"]["intensity"] == 4
                assert final2["llm_json"]["confidence"] == pytest.approx(0.96, abs=0.01)


def test_energy_savings_positive_and_functional():
    """Verify that live physical hardware telemetry produces positive energy savings and cumulative metrics."""
    import time
    manager = get_sensor_manager(reset=True)

    # Ingest the 4 physical zones shown on the dashboard
    readings = [
        {"device_id": "esp32_environment_2", "sensor_id": "t1", "sensor_type": "temperature", "zone_id": "zone_01", "value": 22.70},
        {"device_id": "esp32_environment_2", "sensor_id": "t2", "sensor_type": "temperature", "zone_id": "zone_02", "value": 22.70},
        {"device_id": "esp32_environment_2", "sensor_id": "t3", "sensor_type": "temperature", "zone_id": "zone_03", "value": 23.00},
        {"device_id": "esp32_environment_2", "sensor_id": "t4", "sensor_type": "temperature", "zone_id": "zone_04", "value": 23.40},
    ]
    for r in readings:
        ingest_esp32_payload(r, manager)

    coord = SimulationCoordinator()
    coord.initialize()

    latest = coord.get_latest_telemetry()
    assert latest is not None

    # RL power matches sum of zone loads: 1.34 + 1.34 + 1.70 + 2.18 = 6.56 kW
    assert latest.rl_power_kw == pytest.approx(6.56, abs=0.1)

    # Baseline power is strictly greater than RL power
    assert latest.baseline_power_kw > latest.rl_power_kw
    assert latest.power_saved_kw > 0.0

    # Savings percentage is strictly positive (expected between 15% and 30%)
    assert 15.0 <= latest.instantaneous_savings_pct <= 35.0

    # Both sets of zone mappings exist with valid power
    assert len(latest.zones_rl) == 4
    assert len(latest.zones_baseline) == 4
    assert latest.zones_baseline["server_room"].hvac_power_kw > latest.zones_rl["server_room"].hvac_power_kw

    # Verify cumulative integration increments over time
    time.sleep(0.15)
    second_sync = coord.sync_physical_telemetry()
    assert second_sync is not None
    assert second_sync.cumulative_baseline_energy_kwh > 0.0
    assert second_sync.cumulative_rl_energy_kwh > 0.0
    assert second_sync.cumulative_cost_saved_usd >= 0.0


