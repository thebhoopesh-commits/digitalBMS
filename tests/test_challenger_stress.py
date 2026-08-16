"""Empirical Challenger Stress & Scale Test Suite.

Author: challenger_e2e_2
Purpose:
1. CLI robustness & exit code validation for run_tests.py (valid, edge-case, and invalid flags)
2. Extended benchmark scale & memory stability (500 episodes / 144,000 steps, zero NaNs, high throughput)
3. Rapid repeated client connections & SSE stream stress testing against FastAPI backend
"""

import sys
import os
import gc
import time
import json
import xml.etree.ElementTree as ET
import subprocess
import threading
import asyncio
import numpy as np
import pytest
from fastapi.testclient import TestClient
from httpx import AsyncClient, ASGITransport

from tests.conftest import (
    BenchmarkRunner, SimulationCoordinator, MultiZoneThermalModel,
    BuildingConfig, ZoneConfig, WeatherState, DeterministicFallbackParser,
    NLPTranslator, NLPConstraintBridge, create_app
)


# ==============================================================================
# 1. CLI Robustness & Flag Tests for run_tests.py
# ==============================================================================

class TestCLIRobustness:
    """Test suite for master test runner CLI flags, outputs, and exit codes."""

    def test_cli_tier1_flag(self):
        """Verify --tier 1 runs feature isolation suite and returns exit code 0."""
        cmd = [sys.executable, "run_tests.py", "--tier", "1"]
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode == 0, f"STDOUT: {result.stdout}\nSTDERR: {result.stderr}"
        assert "Target Tier      : 1" in result.stdout
        assert "PASSED" in result.stdout

    def test_cli_tier2_flag(self):
        """Verify --tier 2 runs boundary suite and returns exit code 0."""
        cmd = [sys.executable, "run_tests.py", "--tier", "2"]
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode == 0, f"STDOUT: {result.stdout}\nSTDERR: {result.stderr}"
        assert "Target Tier      : 2" in result.stdout
        assert "PASSED" in result.stdout

    def test_cli_tier3_flag(self):
        """Verify --tier 3 runs pairwise suite and returns exit code 0."""
        cmd = [sys.executable, "run_tests.py", "--tier", "3"]
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode == 0, f"STDOUT: {result.stdout}\nSTDERR: {result.stderr}"
        assert "Target Tier      : 3" in result.stdout
        assert "PASSED" in result.stdout

    def test_cli_tier4_flag(self):
        """Verify --tier 4 runs scenario suite + benchmark and returns exit code 0."""
        cmd = [sys.executable, "run_tests.py", "--tier", "4"]
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode == 0, f"STDOUT: {result.stdout}\nSTDERR: {result.stderr}"
        assert "Target Tier      : 4" in result.stdout
        assert "100-Episode Stability Benchmark Results" in result.stdout
        assert "PASSED" in result.stdout

    def test_cli_tier_all_flag(self):
        """Verify --tier all runs complete suite and returns exit code 0."""
        cmd = [sys.executable, "run_tests.py", "--tier", "all"]
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode == 0, f"STDOUT: {result.stdout}\nSTDERR: {result.stderr}"
        assert "Target Tier      : ALL" in result.stdout
        assert "PASSED" in result.stdout

    def test_cli_json_output_generation_and_schema(self, tmp_path):
        """Verify --json produces valid schema with summary, tests, and benchmark metrics."""
        json_file = str(tmp_path / "cli_report.json")
        cmd = [sys.executable, "run_tests.py", "--tier", "3", "--json", json_file]
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode == 0
        assert os.path.exists(json_file)

        with open(json_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        assert "timestamp" in data
        assert data["tier"] == "3"
        assert "summary" in data
        assert data["summary"]["passed"] == 21
        assert data["summary"]["failed"] == 0
        assert data["summary"]["pass_rate_pct"] == 100.0
        assert "tests" in data
        assert len(data["tests"]) == 21
        for t in data["tests"]:
            assert "nodeid" in t
            assert t["outcome"] == "passed"
            assert "duration_sec" in t

    def test_cli_junit_xml_generation_and_schema(self, tmp_path):
        """Verify --junit produces valid JUnit XML parseable by CI systems."""
        junit_file = str(tmp_path / "cli_junit.xml")
        cmd = [sys.executable, "run_tests.py", "--tier", "3", "--junit", junit_file]
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode == 0
        assert os.path.exists(junit_file)

        tree = ET.parse(junit_file)
        root = tree.getroot()
        # root can be <testsuite> or <testsuites>
        testcases = root.findall(".//testcase")
        assert len(testcases) == 21
        for tc in testcases:
            assert "classname" in tc.attrib
            assert "name" in tc.attrib
            assert "time" in tc.attrib

    def test_cli_verbose_flag(self):
        """Verify --verbose (-v) passes through to pytest."""
        cmd = [sys.executable, "run_tests.py", "--tier", "3", "-v"]
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode == 0
        assert "test_tier3_01_f1_thermal_x_f2_weather_diurnal_coupling" in result.stdout

    def test_cli_keyword_filter(self):
        """Verify -k keyword expression filters tests appropriately."""
        cmd = [sys.executable, "run_tests.py", "--tier", "3", "-k", "test_tier3_01"]
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode == 0
        assert "Total Executed   : 1" in result.stdout

    def test_cli_benchmark_flag_on_tier1(self):
        """Verify --benchmark forces benchmark execution on non-scenario tiers."""
        cmd = [sys.executable, "run_tests.py", "--tier", "3", "--benchmark"]
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode == 0
        assert "100-Episode Stability Benchmark Results" in result.stdout

    def test_cli_invalid_tier_exit_code_2(self):
        """Verify invalid --tier 99 raises argument error with non-zero exit code 2."""
        cmd = [sys.executable, "run_tests.py", "--tier", "99"]
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode == 2
        assert "invalid choice" in result.stderr or "invalid choice" in result.stdout

    def test_cli_unrecognized_argument_exit_code_2(self):
        """Verify unrecognized flag raises argument error with exit code 2."""
        cmd = [sys.executable, "run_tests.py", "--completely-invalid-flag-1234"]
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode == 2
        assert "unrecognized arguments" in result.stderr or "unrecognized arguments" in result.stdout

    def test_cli_non_matching_filter_exit_code_1(self):
        """Verify -k with unmatched pattern returns non-zero exit code."""
        cmd = [sys.executable, "run_tests.py", "--tier", "3", "-k", "non_matching_test_pattern_xyz_123"]
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode != 0


# ==============================================================================
# 2. Extended Simulation Scale, Memory & Stability Stress Tests
# ==============================================================================

class TestSimulationScaleAndMemory:
    """Stress testing extended simulations: 500 episodes / 144,000 steps, zero NaNs, memory stability."""

    def test_extended_benchmark_500_episodes_144000_steps(self):
        """Run 500 episodes (144,000 simulation steps) to verify stability and zero NaNs."""
        n_episodes = 500
        steps_per_episode = 288
        total_expected_steps = n_episodes * steps_per_episode  # 144,000

        runner = BenchmarkRunner(n_episodes=n_episodes, steps_per_episode=steps_per_episode)
        t0 = time.perf_counter()
        results = runner.run()
        elapsed = time.perf_counter() - t0

        assert results.total_episodes == 500
        assert results.total_steps == 144_000
        assert results.crashed_episodes == 0

        # Verify numerical integrity across all 144k steps (432k zone temperatures)
        all_temps = np.array(results.all_zone_temps)
        assert len(all_temps) == 144_000 * 3
        assert not np.any(np.isnan(all_temps)), "Found NaNs in extended simulation temps"
        assert not np.any(np.isinf(all_temps)), "Found Infs in extended simulation temps"
        assert np.all((all_temps >= -20.0) & (all_temps <= 60.0)), "Temps exceeded physical sanity bounds"

        steps_per_sec = total_expected_steps / max(1e-4, elapsed)
        assert steps_per_sec > 50_000, f"Throughput too low: {steps_per_sec:.0f} steps/sec"

    def test_memory_stability_over_extended_steps(self):
        """Verify no memory leak over repeated simulation cycles."""
        import tracemalloc
        tracemalloc.start()
        gc.collect()
        snapshot_start = tracemalloc.take_snapshot()

        runner = BenchmarkRunner(n_episodes=100, steps_per_episode=288)
        for _ in range(5):
            _ = runner.run()

        gc.collect()
        snapshot_end = tracemalloc.take_snapshot()
        tracemalloc.stop()

        top_stats = snapshot_end.compare_to(snapshot_start, "lineno")
        total_growth_kb = sum(stat.size_diff for stat in top_stats) / 1024.0
        # Allow reasonable buffer growth (< 15 MB for 5x 100-episode runs)
        assert total_growth_kb < 15360.0, f"Excessive memory growth detected: {total_growth_kb:.2f} KB"

    def test_multi_zone_physics_conservation_under_extreme_ambient(self, nominal_thermal_model):
        """Stress physics model under extreme Arctic (-40C) and Sahara (55C) temperatures."""
        nominal_thermal_model.reset(22.0)
        arctic_ambient = WeatherState(outdoor_temp_c=-40.0, solar_irradiance_w_m2=0.0)

        # 100 steps in arctic cold without heating
        for _ in range(100):
            res = nominal_thermal_model.step(dt=300.0, ambient=arctic_ambient, hvac_power_kw=[0.0, 0.0, 0.0])
            for z, state in res.zones.items():
                assert not math.isnan(state.temperature_c)
                assert not math.isinf(state.temperature_c)
                assert state.temperature_c <= 22.0

        # Now sudden switch to Sahara heatwave
        sahara_ambient = WeatherState(outdoor_temp_c=55.0, solar_irradiance_w_m2=1000.0)
        for _ in range(100):
            res = nominal_thermal_model.step(dt=300.0, ambient=sahara_ambient, hvac_power_kw=[0.0, 0.0, 0.0])
            for z, state in res.zones.items():
                assert not math.isnan(state.temperature_c)
                assert not math.isinf(state.temperature_c)


# ==============================================================================
# 3. Rapid Repeated Client Connections & SSE Stream Stress Tests
# ==============================================================================

class TestFastAPIAndSSEStress:
    """Stress testing FastAPI REST endpoints and SSE real-time telemetry streaming."""

    def test_rapid_repeated_rest_api_calls(self):
        """Hammer REST endpoints with 100 rapid sequential requests."""
        coord = SimulationCoordinator()
        coord.initialize()
        app = create_app(coordinator=coord)
        client = TestClient(app)

        start = time.perf_counter()
        for i in range(100):
            # GET /api/status
            r1 = client.get("/api/status")
            assert r1.status_code == 200
            assert r1.json()["status"] == "healthy"

            # GET /api/zones
            r2 = client.get("/api/zones")
            assert r2.status_code == 200
            assert len(r2.json()["zones"]) == 3

            # POST /api/chat
            r3 = client.post("/api/chat", json={"message": f"Lobby is too cold iteration {i}"})
            assert r3.status_code == 200
            assert r3.json()["applied"] is True

            # POST /api/simulation/control step
            r4 = client.post("/api/simulation/control", json={"action": "step", "steps": 1})
            assert r4.status_code == 200

        elapsed = time.perf_counter() - start
        avg_latency_ms = (elapsed / 400.0) * 1000.0
        assert avg_latency_ms < 50.0, f"Average endpoint latency too high: {avg_latency_ms:.2f}ms"

    @pytest.mark.asyncio
    async def test_concurrent_async_api_traffic(self):
        """Execute 50 concurrent async API requests simultaneously."""
        coord = SimulationCoordinator()
        coord.initialize()
        app = create_app(coordinator=coord)
        transport = ASGITransport(app=app)

        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            async def worker(w_id: int):
                r_status = await client.get("/api/status")
                assert r_status.status_code == 200
                r_metrics = await client.get("/api/metrics?limit=10")
                assert r_metrics.status_code == 200
                r_chat = await client.post("/api/chat", json={"message": f"Worker {w_id} reports conference room is sweltering"})
                assert r_chat.status_code == 200
                return r_chat.json()

            tasks = [worker(i) for i in range(50)]
            results = await asyncio.gather(*tasks)
            assert len(results) == 50
            for res in results:
                assert res["applied"] is True
                assert res["translation"]["is_applicable"] is True

    @pytest.mark.asyncio
    async def test_rapid_repeated_sse_stream_connections(self):
        """Test 20 rapid SSE streaming connections and verify chunked delivery."""
        coord = SimulationCoordinator()
        coord.initialize()
        coord.start()
        app = create_app(coordinator=coord)
        transport = ASGITransport(app=app)

        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            for conn_idx in range(20):
                async with client.stream("GET", "/api/stream") as response:
                    assert response.status_code == 200
                    assert "text/event-stream" in response.headers["content-type"]

                    chunks_received = 0
                    async for chunk in response.aiter_text():
                        if "data:" in chunk:
                            chunks_received += 1
                        if chunks_received >= 3:
                            break  # Simulate client disconnect after receiving initial packets

                    assert chunks_received >= 3

    def test_coordinator_thread_safety_under_concurrent_stepping_and_chat(self):
        """Verify thread-safety of SimulationCoordinator under multi-threaded contention."""
        coord = SimulationCoordinator()
        coord.initialize()
        errors = []

        def stepper_thread():
            try:
                for _ in range(50):
                    coord.step(num_steps=2)
                    time.sleep(0.001)
            except Exception as e:
                errors.append(e)

        def chat_thread(t_id: int):
            try:
                for j in range(25):
                    coord.submit_chat_message(f"Thread {t_id} query {j}: lobby is freezing")
                    time.sleep(0.002)
            except Exception as e:
                errors.append(e)

        threads = [
            threading.Thread(target=stepper_thread),
            threading.Thread(target=chat_thread, args=(1,)),
            threading.Thread(target=chat_thread, args=(2,))
        ]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0, f"Thread contention errors: {errors}"
        latest = coord.get_latest_telemetry()
        assert latest.step >= 100
        assert not math.isnan(latest.baseline_power_kw)
        assert not math.isnan(latest.rl_power_kw)
