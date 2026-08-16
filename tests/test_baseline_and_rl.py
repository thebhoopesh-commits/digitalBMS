import pytest
from src.simulation.dual_twin import DualTwinRunner
from src.simulation.controllers.rl_agent import RewardEngine, FastTabularRLPolicy

def test_dual_twin_runner_initialization():
    runner = DualTwinRunner()
    assert runner is not None
    assert runner.current_step == 0

def test_dual_twin_runner_step():
    runner = DualTwinRunner()
    telemetry = runner.step()
    assert telemetry.step == 1
    assert telemetry.baseline_power_kw > 0
    assert telemetry.rl_power_kw > 0
    assert telemetry.cumulative_baseline_energy_kwh > 0
    assert telemetry.cumulative_rl_energy_kwh > 0

def test_reward_engine():
    engine = RewardEngine()
    r = engine.compute_reward([10.0, 10.0], [22.0, 22.0], [10, 10])
    assert r < 0 # Assuming penalty
