"""
Empirical Challenger Adversarial Stress Test Suite for Milestone 1.
Physics Engine, 3R2C Coupled Thermal ODEs, Psychrometrics, Weather, and Baseline Controller.

Author: challenger_1 (Empirical Challenger)
Milestone: M1 - Simulation Core & Physics Engine
Features Covered: F1 (3R2C Thermal Model), F2 (Weather Generator), F3 (Psychrometrics),
                  F4 (ASHRAE Baseline Controller), F5 (RK4 Numerical Solver), F6 (Stability & Benchmark)

Adversarial Stress Dimensions:
1. Extreme Ambient Temperatures (-50°C Arctic Freeze to +65°C Desert Heatwave)
2. High-Frequency Rapid Setpoint Perturbations & Extreme Solar Pulses (1500 W/m²)
3. Extreme Occupancy Surges (100+ Occupants) & Sudden Moisture Injection / Hyper-Dry Purge
4. 30-Day Zero-Power Long-Duration Passive Decay & Analytical Matrix Exponential Verification
5. Gymnasium Environment Adversarial Inputs, Action Boundary Clipping & Scale Integrity
"""

import math
import time
import numpy as np
import pytest
from scipy.linalg import expm

from src.config import BuildingConfig, SimulationConfig, WeatherPreset, ZoneConfig
from src.simulation.controllers.baseline import ASHRAEBaselineController, ControllerOutput
from src.simulation.environment import HVACBuildingEnv, HVACGymEnv
from src.simulation.physics.psychrometrics import PsychrometricModel
from src.simulation.physics.thermal_model import MultiZoneThermalModel, ThermalNetwork
from src.simulation.physics.weather import WeatherGenerator, WeatherSnapshot
from src.simulation.telemetry import StepTelemetry, TelemetryBuffer, ZoneTelemetry


# ==============================================================================
# Fixtures
# ==============================================================================

@pytest.fixture
def building_cfg() -> BuildingConfig:
    return BuildingConfig()


@pytest.fixture
def sim_cfg() -> SimulationConfig:
    return SimulationConfig(dt_step_seconds=300.0, dt_sub_seconds=150.0)


@pytest.fixture
def thermal_engine(building_cfg: BuildingConfig, sim_cfg: SimulationConfig) -> MultiZoneThermalModel:
    return MultiZoneThermalModel(config=building_cfg, sim_config=sim_cfg)


@pytest.fixture
def psychro_engine(building_cfg: BuildingConfig, sim_cfg: SimulationConfig) -> PsychrometricModel:
    return PsychrometricModel(config=building_cfg, sim_config=sim_cfg)


@pytest.fixture
def baseline_ctrl(building_cfg: BuildingConfig, sim_cfg: SimulationConfig) -> ASHRAEBaselineController:
    return ASHRAEBaselineController(config=building_cfg, sim_config=sim_cfg)


@pytest.fixture
def hvac_env() -> HVACGymEnv:
    env = HVACGymEnv(weather_preset=WeatherPreset.SUMMER_HOT, seed=999)
    yield env
    env.close()


# ==============================================================================
# 1. Extreme Ambient Temperature Stress Tests (-50°C to +65°C)
# ==============================================================================

class TestExtremeAmbientTemperatures:
    """Stress tests covering arctic deep freeze (-50°C), desert heatwave (+65°C), and thermal shock."""

    def test_arctic_deep_freeze_minus_50c(
        self, thermal_engine: MultiZoneThermalModel, baseline_ctrl: ASHRAEBaselineController
    ):
        """Verify building thermal model and controller survive continuous -50°C arctic freeze."""
        T_amb = -50.0
        dt = 300.0
        steps = 288  # 24 hours of sustained -50°C

        state = thermal_engine.init_state(T_air=[22.0, 22.0, 22.0], T_wall=[20.0, 20.0, 20.0])

        for step in range(steps):
            t_z = thermal_engine.get_air_temperatures(state)
            q_hvac, p_elec = baseline_ctrl.compute_control(T_z=t_z, T_amb=T_amb)

            # Controller should command max heating
            assert np.all(q_hvac > 0.0), f"Heating should be active at -50°C ambient, got: {q_hvac}"
            assert np.all(p_elec > 0.0), f"Electrical power should be positive, got: {p_elec}"
            assert np.all(np.isfinite(p_elec)), "Non-finite electrical power in arctic freeze"

            state = thermal_engine.step(
                state=state,
                T_amb=T_amb,
                I_solar=0.0,
                Q_int=np.zeros(3),
                Q_hvac=q_hvac,
                dt=dt,
            )

            assert np.all(np.isfinite(state)), f"Non-finite state at step {step}: {state}"
            # Air temps must stay within physically possible bounds (not crash to -inf)
            assert np.all(state >= -55.0) and np.all(state <= 35.0)

    def test_desert_extreme_heatwave_plus_65c(
        self, thermal_engine: MultiZoneThermalModel, baseline_ctrl: ASHRAEBaselineController
    ):
        """Verify thermal physics and cooling control under severe +65°C desert heatwave."""
        T_amb = 65.0
        I_solar = 1200.0  # Intense solar radiation
        dt = 300.0
        steps = 288  # 24 hours

        state = thermal_engine.init_state(T_air=[22.0, 22.0, 22.0], T_wall=[22.0, 22.0, 22.0])

        for step in range(steps):
            t_z = thermal_engine.get_air_temperatures(state)
            q_hvac, p_elec = baseline_ctrl.compute_control(T_z=t_z, T_amb=T_amb)

            # Controller must cool when zone temp exceeds 24°C
            if np.any(t_z > 24.0):
                assert np.all(q_hvac <= 0.0), f"Cooling expected, got: {q_hvac}"

            state = thermal_engine.step(
                state=state,
                T_amb=T_amb,
                I_solar=I_solar,
                Q_int=np.array([1000.0, 2000.0, 1500.0]),
                Q_hvac=q_hvac,
                dt=dt,
            )

            assert np.all(np.isfinite(state)), f"Non-finite state at step {step}: {state}"
            assert np.all(state <= 80.0), f"Unphysical thermal runaway at step {step}: {state}"

    def test_instantaneous_100c_thermal_shock(self, thermal_engine: MultiZoneThermalModel):
        """Verify numerical stability of RK4 under instantaneous 100°C step disturbance (-40°C to +60°C)."""
        dt = 300.0
        state = thermal_engine.init_state(T_air=[20.0, 20.0, 20.0], T_wall=[20.0, 20.0, 20.0])

        # Step 10 times at -40°C
        for _ in range(10):
            state = thermal_engine.step(state=state, T_amb=-40.0, I_solar=0.0, dt=dt)
            assert np.all(np.isfinite(state))

        # Instantaneous shock jump to +60°C in single step
        state = thermal_engine.step(state=state, T_amb=60.0, I_solar=1000.0, dt=dt)
        assert np.all(np.isfinite(state))

        # Followed by shock jump back to -40°C
        state = thermal_engine.step(state=state, T_amb=-40.0, I_solar=0.0, dt=dt)
        assert np.all(np.isfinite(state))

    def test_cop_clamping_across_extreme_range(self, baseline_ctrl: ASHRAEBaselineController):
        """Verify heating and cooling COPs are strictly clamped and never cause division by zero."""
        extreme_temps = [-100.0, -50.0, -20.0, 0.0, 20.0, 35.0, 50.0, 65.0, 100.0]

        for T in extreme_temps:
            cop_cool = baseline_ctrl.compute_cooling_cop(T)
            cop_heat = baseline_ctrl.compute_heating_cop(T)

            assert 2.0 <= cop_cool <= 5.2, f"Cooling COP out of bounds at {T}°C: {cop_cool}"
            assert 1.8 <= cop_heat <= 4.2, f"Heating COP out of bounds at {T}°C: {cop_heat}"
            assert cop_cool > 0.0 and cop_heat > 0.0


# ==============================================================================
# 2. High-Frequency Setpoint Perturbations & Extreme Solar Pulses
# ==============================================================================

class TestHighFrequencyPerturbationsAndSolarPulses:
    """Stress tests covering high solar irradiance (1500 W/m²) and rapid bang-bang setpoint oscillations."""

    def test_extreme_solar_radiation_pulse_1500_w_m2(
        self, thermal_engine: MultiZoneThermalModel, building_cfg: BuildingConfig
    ):
        """Apply 1500 W/m² solar pulse to verify internal glazing and wall absorption."""
        state_init = thermal_engine.init_state(T_air=20.0, T_wall=20.0)
        dt = 300.0
        I_solar = 1500.0  # Extreme peak solar pulse

        state = state_init.copy()
        # 12 steps = 1 hour of continuous 1500 W/m² pulse
        for _ in range(12):
            state = thermal_engine.step(
                state=state,
                T_amb=20.0,
                I_solar=I_solar,
                Q_int=np.zeros(3),
                Q_hvac=np.zeros(3),
                dt=dt,
            )

        # Temperatures should rise due to solar absorption
        assert np.all(state > state_init), "Solar pulse did not heat building nodes"
        # Wall temperature must increase due to wall absorption
        wall_temps = thermal_engine.get_wall_temperatures(state)
        assert np.all(wall_temps > 20.0), f"Wall mass did not absorb solar radiation: {wall_temps}"

    def test_high_frequency_bang_bang_setpoint_oscillation(self, hvac_env: HVACGymEnv):
        """Toggle RL action setpoint trim between -2.0°C and +2.0°C every single step for 288 steps."""
        obs, info = hvac_env.reset(seed=42)

        for step in range(288):
            # Alternating extreme actions: [-2, -2, -2] -> [+2, +2, +2]
            action = np.array([-2.0, -2.0, -2.0] if (step % 2 == 0) else [2.0, 2.0, 2.0], dtype=np.float32)
            obs, reward, terminated, truncated, step_info = hvac_env.step(action)

            assert np.all(np.isfinite(obs)), f"Non-finite observation during oscillation step {step}"
            assert np.isfinite(reward), f"Non-finite reward during oscillation step {step}"
            assert not terminated
            if truncated:
                break

        # Verify environment smoothly absorbed 288 oscillatory steps
        snap = hvac_env.get_telemetry_snapshot()
        assert snap is not None
        assert snap.step == 288
        assert np.isfinite(snap.cumulative_baseline_energy_kwh)
        assert np.isfinite(snap.cumulative_rl_energy_kwh)

    def test_stochastic_extreme_weather_perturbations(self, building_cfg: BuildingConfig):
        """Run weather generator with high Ornstein-Uhlenbeck stochastic volatility for 7 days."""
        weather_gen = WeatherGenerator(
            preset=WeatherPreset.SUMMER_HOT,
            seed=777,
            enable_noise=True,
            config=building_cfg,
        )
        weather_gen.ou_sigma = 2.0  # Elevate volatility
        dt = 300.0
        steps = 288 * 7  # 7 days = 2016 steps

        temps = []
        rhs = []
        for _ in range(steps):
            snap = weather_gen.step(dt_seconds=dt)
            temps.append(snap.outdoor_temp_c)
            rhs.append(snap.outdoor_rh_pct)

        temps_arr = np.array(temps)
        rhs_arr = np.array(rhs)

        assert np.all(np.isfinite(temps_arr))
        assert np.all(np.isfinite(rhs_arr))
        assert np.all((rhs_arr >= 0.0) & (rhs_arr <= 100.0)), "Stochastic noise broke RH bounds"


# ==============================================================================
# 3. Extreme Occupancy & Moisture Dynamics (100+ Occupants)
# ==============================================================================

class TestExtremeOccupancyAndMoistureDynamics:
    """Stress tests covering sudden occupancy surge (100+ people), condensation extraction, and arid purge."""

    def test_extreme_occupancy_surge_150_people(self, psychro_engine: PsychrometricModel):
        """Surge 150 people into conference room, verify moisture generation, condensation extraction, and 100% RH ceiling."""
        w_z = 0.008  # Initial humidity ratio (~50% RH at 22°C)
        T_z = 22.0
        w_amb = 0.012
        N_occ = 150  # Massive crowd
        dt = 300.0
        steps = 96  # 8 hours

        total_condensed_kg = 0.0
        for _ in range(steps):
            w_z, condensed_kg = psychro_engine.step_moisture_with_condensation(
                w_z=w_z,
                temp_c=T_z,
                w_amb=w_amb,
                N_occ=N_occ,
                dt=dt,
            )
            total_condensed_kg += float(condensed_kg)
            rh = float(psychro_engine.relative_humidity(temp_c=T_z, w=w_z))

            assert 0.0 <= rh <= 100.0001, f"RH exceeded 100%: {rh}%"
            assert w_z >= 0.0, f"Negative moisture ratio: {w_z}"

        # Significant condensation must have been extracted
        assert total_condensed_kg > 0.5, f"Expected condensation not extracted: {total_condensed_kg} kg"

    def test_hyper_dry_arid_zero_occupancy_purge(self, psychro_engine: PsychrometricModel):
        """Simulate hyper-arid outdoor air (w_amb = 0.0001) with high dehumidification load for 72 hours."""
        w_z = 0.015
        T_z = 30.0
        w_amb = 0.0001  # Ultra-dry desert air
        m_dehum = 0.05  # Aggressive dehumidifier (50 g/s)
        dt = 300.0
        steps = 864  # 72 hours

        for step in range(steps):
            w_z = float(
                psychro_engine.step_moisture(
                    w_z=w_z,
                    w_amb=w_amb,
                    N_occ=0,
                    m_dehum=m_dehum,
                    dt=dt,
                )
            )
            rh = float(psychro_engine.relative_humidity(temp_c=T_z, w=w_z))

            assert w_z >= 0.0, f"Moisture ratio became negative at step {step}: {w_z}"
            assert 0.0 <= rh <= 100.0, f"RH out of bounds at step {step}: {rh}"

        # Should be asymptotic to near-zero without going negative
        assert w_z >= 0.0
        assert w_z < 0.001

    def test_dew_point_consistency_across_broad_domain(self, psychro_engine: PsychrometricModel):
        """Verify dew point calculation adheres to thermodynamic bounds across -40°C to +60°C and 0.1% to 100% RH."""
        test_temps = [-40.0, -20.0, -5.0, 0.0, 15.0, 25.0, 40.0, 60.0]
        test_rhs = [0.1, 5.0, 20.0, 50.0, 80.0, 99.9, 100.0]

        for t in test_temps:
            for rh in test_rhs:
                dp = float(psychro_engine.dew_point(t, rh))
                assert np.isfinite(dp), f"Non-finite dew point at T={t}, RH={rh}"
                assert dp <= t + 1e-3, f"Dew point {dp}°C exceeds dry bulb {t}°C at RH {rh}%"
                if rh == 100.0:
                    assert np.isclose(dp, t, atol=0.1), f"Dew point at 100% RH {dp} != dry bulb {t}"


# ==============================================================================
# 4. Zero-Power 30-Day Long-Duration Decay & Matrix Exponential Integrity
# ==============================================================================

class TestZeroPowerLongDurationDecayAndMatrixExponential:
    """Stress tests covering 30-day passive decay, exact analytical comparison, and Lyapunov matrix stability."""

    def test_30_day_passive_decay_asymptotic_stability(self, thermal_engine: MultiZoneThermalModel):
        """Run 30 days (8,640 steps of 300s) of zero-power passive decay to verify asymptotic convergence."""
        T_amb = 8.0
        state = thermal_engine.init_state(T_air=[35.0, 32.0, 30.0], T_wall=[30.0, 28.0, 28.0])
        dt = 300.0
        total_steps = 30 * 24 * 12  # 8,640 steps = 30 days

        prev_error = np.linalg.norm(state - T_amb)

        for step in range(total_steps):
            state = thermal_engine.step(
                state=state,
                T_amb=T_amb,
                I_solar=0.0,
                Q_int=np.zeros(3),
                Q_hvac=np.zeros(3),
                dt=dt,
            )

            curr_error = np.linalg.norm(state - T_amb)
            # Monotonic decay invariant
            assert curr_error <= prev_error + 1e-12, f"Monotonicity violated at step {step}"
            prev_error = curr_error

        # After 30 days (>30 time constants), temperatures must have converged within 1e-6°C of ambient
        assert np.all(np.abs(state - T_amb) < 1e-5), f"Failed to reach asymptotic equilibrium: {state}"

    def test_30_day_rk4_vs_matrix_exponential_analytical(self, thermal_engine: MultiZoneThermalModel):
        """Verify numerical RK4 integrator trajectory against exact analytical matrix exponential x(t) = exp(At)x0."""
        T_amb = 15.0
        state_init = np.array([32.0, 28.0, 30.0, 26.0, 27.0, 25.0], dtype=np.float64)
        A = thermal_engine.get_system_matrix()
        dt = 300.0
        checkpoints_days = [0.1, 0.5, 1.0, 3.0, 7.0, 14.0, 30.0]

        state_num = state_init.copy()
        current_step = 0

        for target_days in checkpoints_days:
            target_step = int(target_days * 24 * 12)
            steps_to_run = target_step - current_step

            for _ in range(steps_to_run):
                state_num = thermal_engine.step(
                    state=state_num,
                    T_amb=T_amb,
                    I_solar=0.0,
                    Q_int=np.zeros(3),
                    Q_hvac=np.zeros(3),
                    dt=dt,
                )
            current_step = target_step

            t_sec = current_step * dt
            # Exact analytical matrix exponential solution
            state_exact = T_amb + expm(A * t_sec) @ (state_init - T_amb)
            max_drift = float(np.max(np.abs(state_num - state_exact)))

            assert max_drift < 1e-3, f"RK4 drifted from exact matrix exponential at day {target_days}: max_drift={max_drift:.2e}"

    def test_hurwitz_spectral_radius_and_lyapunov_dissipation(self, thermal_engine: MultiZoneThermalModel):
        """Assert Hurwitz stability and negative-definiteness of thermal dissipation matrix."""
        A = thermal_engine.get_system_matrix()
        eigenvalues = thermal_engine.get_eigenvalues()
        real_parts = np.real(eigenvalues)

        # All eigenvalues must have strictly negative real parts
        assert np.all(real_parts < -1e-6), f"Unstable eigenvalues: {eigenvalues}"

        # Capacitance diagonal scaling matrix
        c_diag = np.zeros(6, dtype=np.float64)
        c_diag[0::2] = thermal_engine.c_air
        c_diag[1::2] = thermal_engine.c_wall
        C_mat = np.diag(c_diag)

        # The symmetric energy rate matrix M = C @ A must be negative semi-definite
        M = C_mat @ A
        M_sym = 0.5 * (M + M.T)
        sym_eigenvals = np.linalg.eigvalsh(M_sym)
        assert np.all(sym_eigenvals <= 1e-12), f"Non-dissipative symmetric energy matrix: {sym_eigenvals}"


# ==============================================================================
# 5. Gymnasium Environment Adversarial Inputs & Scale Integrity
# ==============================================================================

class TestGymnasiumEnvironmentAdversarialInputs:
    """Stress tests covering unconstrained/extreme actions, NLP offset injections, and extended execution."""

    def test_adversarial_action_clipping(self, hvac_env: HVACGymEnv):
        """Pass extreme and unclipped actions (+100.0, -100.0) to step() and verify proper bounded execution."""
        obs, info = hvac_env.reset(seed=123)

        extreme_actions = [
            np.array([100.0, 100.0, 100.0], dtype=np.float32),
            np.array([-100.0, -100.0, -100.0], dtype=np.float32),
            np.array([50.0, -50.0, 0.0], dtype=np.float32),
        ]

        for act in extreme_actions:
            obs, reward, terminated, truncated, info = hvac_env.step(act)
            assert np.all(np.isfinite(obs)), f"Non-finite obs with action {act}"
            assert np.isfinite(reward), f"Non-finite reward with action {act}"
            assert hvac_env.observation_space.contains(obs), f"Observation broke bounds with action {act}"

    def test_nlp_offset_injection_stress(self, hvac_env: HVACGymEnv):
        """Inject large NLP offsets (+15°C, -15°C) and verify effective setpoints stay within [16°C, 28°C]."""
        obs, _ = hvac_env.reset()

        hvac_env.set_nlp_offsets([15.0, -15.0, 10.0])
        effective_sp = hvac_env._get_effective_setpoints(np.array([2.0, -2.0, 0.0]))

        # Must be clamped to safety envelope [16.0°C, 28.0°C]
        assert np.all(effective_sp >= 16.0) and np.all(effective_sp <= 28.0), f"Setpoints escaped bounds: {effective_sp}"

        # Step through with active NLP offsets
        for _ in range(50):
            obs, reward, _, _, _ = hvac_env.step(np.array([0.0, 0.0, 0.0], dtype=np.float32))
            assert np.all(np.isfinite(obs))
            assert np.isfinite(reward)

    def test_extended_500_episodes_stress_benchmark(self, hvac_env: HVACGymEnv):
        """Execute 500 consecutive episodes (144,000 steps) to verify stability and zero degradation."""
        TOTAL_EPISODES = 500
        STEPS_PER_EP = 288
        action = np.array([0.0, 0.0, 0.0], dtype=np.float32)

        start_time = time.perf_counter()
        total_steps = 0

        for ep in range(TOTAL_EPISODES):
            obs, _ = hvac_env.reset(seed=2000 + ep)
            for _ in range(STEPS_PER_EP):
                obs, reward, term, trunc, _ = hvac_env.step(action)
                total_steps += 1
                if term or trunc:
                    break

        elapsed = time.perf_counter() - start_time
        throughput = total_steps / max(elapsed, 1e-4)

        assert total_steps == TOTAL_EPISODES * STEPS_PER_EP
        assert np.all(np.isfinite(obs))
        assert throughput > 30000.0, f"Throughput degraded: {throughput:.1f} steps/s"
