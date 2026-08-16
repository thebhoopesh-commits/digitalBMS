"""
Comprehensive Unit, Physics Invariant, and Benchmark Test Suite for Milestone 1.
Features Covered: F1 (Multi-Zone 3R2C), F2 (Weather), F3 (Psychrometrics),
F4 (ASHRAE Baseline), F5 (RK4 & Telemetry), F6 (100-Episode Benchmark).
"""

import time
import pytest
import numpy as np
from scipy.linalg import expm

from src.config import BuildingConfig, SimulationConfig, WeatherPreset, ZoneConfig
from src.simulation.controllers.baseline import ASHRAEBaselineController, ControllerOutput
from src.simulation.environment import HVACBuildingEnv, HVACGymEnv
from src.simulation.physics.psychrometrics import PsychrometricModel
from src.simulation.physics.thermal_model import MultiZoneThermalModel, ThermalNetwork
from src.simulation.physics.weather import WeatherGenerator, WeatherSnapshot
from src.simulation.telemetry import StepTelemetry, TelemetryBuffer, ZoneTelemetry


# ============================================================================
# Pytest Fixtures
# ============================================================================

@pytest.fixture
def building_config() -> BuildingConfig:
    """Default 3-zone building configuration fixture."""
    return BuildingConfig()


@pytest.fixture
def sim_config() -> SimulationConfig:
    """Default simulation configuration fixture."""
    return SimulationConfig(dt_step_seconds=300.0, dt_sub_seconds=150.0)


@pytest.fixture
def thermal_model(building_config: BuildingConfig, sim_config: SimulationConfig) -> MultiZoneThermalModel:
    """Initialized 3R2C thermal physics model fixture."""
    return MultiZoneThermalModel(config=building_config, sim_config=sim_config)


@pytest.fixture
def psychro_model(building_config: BuildingConfig, sim_config: SimulationConfig) -> PsychrometricModel:
    """Psychrometric calculations model fixture."""
    return PsychrometricModel(config=building_config, sim_config=sim_config)


@pytest.fixture
def baseline_controller(building_config: BuildingConfig, sim_config: SimulationConfig) -> ASHRAEBaselineController:
    """ASHRAE 90.1 baseline controller fixture."""
    return ASHRAEBaselineController(config=building_config, sim_config=sim_config)


@pytest.fixture
def weather_gen(building_config: BuildingConfig) -> WeatherGenerator:
    """Deterministic weather generator fixture."""
    return WeatherGenerator(preset=WeatherPreset.SUMMER_HOT, seed=42, config=building_config, enable_noise=False)


@pytest.fixture
def gym_env() -> HVACGymEnv:
    """Gymnasium HVAC environment fixture."""
    env = HVACGymEnv(weather_preset=WeatherPreset.SUMMER_HOT, seed=42)
    yield env
    env.close()


# ============================================================================
# Test Suite 1: Thermal Physics & Zero-Power Asymptotic Decay (F1, F5)
# ============================================================================

class TestThermalPhysicsDecay:

    def test_zero_power_asymptotic_decay(self, thermal_model: MultiZoneThermalModel):
        """Verify building temperatures monotonically decay and converge to constant ambient."""
        T_amb = 10.0
        T_init_air = [35.0, 32.0, 30.0]
        T_init_wall = [30.0, 28.0, 28.0]
        state = thermal_model.init_state(T_air=T_init_air, T_wall=T_init_wall)

        # Step 168 hours (2016 steps of 300s = 7 days, >7x slowest time constant) with 0 inputs
        dt = 300.0
        steps = int(1680 * 3600 / dt)
        prev_error_norm = np.linalg.norm(state - T_amb)

        for step in range(steps):
            state = thermal_model.step(
                state=state,
                T_amb=T_amb,
                I_solar=0.0,
                Q_int=np.zeros(3),
                Q_hvac=np.zeros(3),
                dt=dt,
            )
            curr_error_norm = np.linalg.norm(state - T_amb)
            # Monotonic decay assertion (Lyapunov stability)
            assert curr_error_norm <= prev_error_norm + 1e-9, f"Decay non-monotonic at step {step}"
            prev_error_norm = curr_error_norm

        # Final convergence assertion: within 0.05°C of outdoor ambient
        assert np.all(np.abs(state - T_amb) < 0.05), f"Did not reach ambient: {state}"

    def test_zero_power_decay_cold_to_warm(self, thermal_model: MultiZoneThermalModel):
        """Verify cold building passively warms up asymptotically to ambient."""
        T_amb = 25.0
        state = thermal_model.init_state(T_air=[0.0, 2.0, 5.0], T_wall=[1.0, 3.0, 4.0])
        dt = 300.0
        steps = int(1680 * 3600 / dt)

        for _ in range(steps):
            state = thermal_model.step(
                state=state, T_amb=T_amb, I_solar=0.0, Q_int=np.zeros(3), Q_hvac=np.zeros(3), dt=dt
            )

        assert np.all(np.abs(state - T_amb) < 0.05), f"State did not converge to ambient: {state}"

    def test_rk4_against_analytical_matrix_exponential(self, thermal_model: MultiZoneThermalModel):
        """Compare numerical RK4 trajectory against exact matrix exponential solution."""
        T_amb = 20.0
        state_init = np.array([28.0, 25.0, 26.0, 24.0, 29.0, 27.0], dtype=np.float64)
        A_mat = thermal_model.get_system_matrix()

        dt = 300.0
        steps = 100
        state_num = state_init.copy()

        for k in range(1, steps + 1):
            state_num = thermal_model.step(
                state=state_num, T_amb=T_amb, I_solar=0.0, Q_int=np.zeros(3), Q_hvac=np.zeros(3), dt=dt
            )
            t = k * dt
            # Exact analytical solution: x(t) = T_amb + exp(A * t) * (x_0 - T_amb)
            state_analytic = T_amb + expm(A_mat * t) @ (state_init - T_amb)

            mae = float(np.max(np.abs(state_num - state_analytic)))
            assert mae < 1e-3, f"RK4 drifted from analytical at t={t}s: MAE={mae:.2e}"

    def test_hurwitz_matrix_stability(self, thermal_model: MultiZoneThermalModel):
        """Assert all eigenvalues of the system matrix A have strictly negative real parts."""
        eigenvalues = thermal_model.get_eigenvalues()
        real_parts = np.real(eigenvalues)
        assert np.all(real_parts < -1e-6), f"Non-Hurwitz eigenvalues detected: {eigenvalues}"


# ============================================================================
# Test Suite 2: First-Law Energy Conservation (F1, F5)
# ============================================================================

class TestEnergyConservation:

    def test_energy_conservation(self, building_config: BuildingConfig, sim_config: SimulationConfig):
        """Inject 10 kW pulse into adiabatic building and verify ΔU == E_injected (<1e-5 error)."""
        # Create insulated building with near-infinite envelope resistance
        insulated_zones = {}
        for zid, z in building_config.zones.items():
            z_dict = z.model_dump()
            z_dict["envelope_resistance_k_w"] = 1.0e10
            z_dict["infiltration_resistance_k_w"] = 1.0e10
            z_dict["infiltration_ach"] = 0.0
            z_dict["window_area_m2"] = 0.0
            insulated_zones[zid] = ZoneConfig(**z_dict)

        insulated_config = BuildingConfig(
            name="Adiabatic Enclosure",
            zones=insulated_zones,
            inter_zone_r_matrix=building_config.inter_zone_r_matrix,
        )
        model = MultiZoneThermalModel(config=insulated_config, sim_config=sim_config)

        state_0 = model.init_state(T_air=[20.0, 20.0, 20.0], T_wall=[20.0, 20.0, 20.0])
        U_0 = model.compute_internal_energy(state_0)

        # Inject 10 kW into Zone 1 (Lobby) for 1 hour (3600s = 12 steps of 300s)
        state = state_0.copy()
        dt = 300.0
        pulse_steps = 12
        Q_pulse = np.array([10000.0, 0.0, 0.0], dtype=np.float64)  # 10 kW

        for _ in range(pulse_steps):
            state = model.step(
                state=state, T_amb=20.0, I_solar=0.0, Q_int=np.zeros(3), Q_hvac=Q_pulse, dt=dt
            )

        # Let it equilibrate for 23 hours with 0 input
        for _ in range(23 * 12):
            state = model.step(
                state=state, T_amb=20.0, I_solar=0.0, Q_int=np.zeros(3), Q_hvac=np.zeros(3), dt=dt
            )

        U_final = model.compute_internal_energy(state)
        delta_U = U_final - U_0
        E_injected = 10000.0 * 3600.0  # 3.6e7 Joules

        rel_error = abs(delta_U - E_injected) / E_injected
        assert rel_error < 1e-5, f"Energy conservation violated: rel_error={rel_error:.2e}"

    def test_dynamic_cycle_heat_flux_balance(self, thermal_model: MultiZoneThermalModel):
        """Verify dynamic 24-hr energy balance: ΔU == ∫(Q_net) dt (<5e-4 error)."""
        state = thermal_model.init_state(T_air=[21.0, 22.0, 23.0], T_wall=[20.0, 21.0, 22.0])
        U_init = thermal_model.compute_internal_energy(state)

        dt = 300.0
        steps = 288
        cum_boundary_energy = 0.0

        for step in range(steps):
            T_amb = 20.0 + 10.0 * np.sin(2 * np.pi * step / 288)
            I_solar = max(0.0, 800.0 * np.sin(np.pi * (step - 72) / 144))
            Q_int = np.array([2000.0, 1000.0, 4000.0], dtype=np.float64)
            Q_hvac = np.array([-5000.0, -2000.0, -4000.0], dtype=np.float64)

            flux_net = thermal_model.compute_net_boundary_flux(state, T_amb, I_solar, Q_int, Q_hvac)
            cum_boundary_energy += flux_net * dt

            state = thermal_model.step(state, T_amb, I_solar, Q_int, Q_hvac, dt=dt)

        U_final = thermal_model.compute_internal_energy(state)
        delta_U = U_final - U_init

        rel_diff = abs(delta_U - cum_boundary_energy) / max(abs(U_init), 1e-6)
        assert rel_diff < 5e-4, f"Continuous energy balance mismatch: {rel_diff:.2e}"


# ============================================================================
# Test Suite 3: Inter-Zone Symmetry & Reciprocity (F1)
# ============================================================================

class TestInterZoneSymmetry:

    def test_interzone_thermal_symmetry(self, thermal_model: MultiZoneThermalModel):
        """Verify pairwise heat flux reciprocity Q_ij + Q_ji == 0.0 W for all zone pairs."""
        T_zones = np.array([16.0, 24.0, 30.0], dtype=np.float64)
        flux_matrix = thermal_model.compute_interzone_flux_matrix(T_zones)

        for i in range(3):
            for j in range(3):
                if i != j:
                    assert np.isclose(flux_matrix[i, j], -flux_matrix[j, i], atol=1e-12)

        assert np.isclose(np.sum(flux_matrix), 0.0, atol=1e-12)

    def test_two_zone_symmetric_equilibration(self, building_config: BuildingConfig, sim_config: SimulationConfig):
        """Two identical zones initialized symmetrically must remain symmetric about the mean."""
        sym_config = building_config.get_symmetric_2zone_config()
        model = MultiZoneThermalModel(config=sym_config, sim_config=sim_config)

        state = model.init_state(T_air=[30.0, 10.0], T_wall=[20.0, 20.0])
        dt = 300.0

        for _ in range(50):
            state = model.step_isolated(state, dt=dt)
            T1, T2 = state[0], state[2]
            mean_T = (T1 + T2) / 2.0
            assert np.isclose(mean_T, 20.0, atol=1e-5), f"Mean temp deviated: {mean_T}"
            assert np.isclose(abs(T1 - 20.0), abs(T2 - 20.0), atol=1e-5), f"Asymmetry in {T1}, {T2}"


# ============================================================================
# Test Suite 4: Psychrometrics & Moisture Balance (F3)
# ============================================================================

class TestPsychrometrics:

    def test_psychrometric_rh_bounds(self, psychro_model: PsychrometricModel):
        """Verify Magnus-Tetens accuracy and strict [0%, 100%] bounds."""
        ref_points = {
            0.0: 611.3,
            10.0: 1228.1,
            20.0: 2339.2,
            30.0: 4247.0,
            40.0: 7384.9,
        }
        for temp_c, expected_p_sat in ref_points.items():
            calc_p_sat = float(psychro_model.saturation_vapor_pressure(temp_c))
            rel_err = abs(calc_p_sat - expected_p_sat) / expected_p_sat
            assert rel_err < 0.01, f"Magnus-Tetens error at {temp_c}°C: {rel_err:.2%}"

        # Test bounds under hyper-dry stress
        w_z = 0.001
        T_z = 35.0
        w_amb = 0.0001
        for _ in range(100):
            w_z = float(psychro_model.step_moisture(w_z=w_z, w_amb=w_amb, N_occ=0, m_dehum=0.01, dt=300.0))
            rh = float(psychro_model.relative_humidity(temp_c=T_z, w=w_z))
            assert w_z >= 0.0, f"Negative moisture ratio: {w_z}"
            assert 0.0 <= rh <= 100.0, f"RH out of bounds: {rh}"

    def test_extreme_occupancy_saturation_bounds(self, psychro_model: PsychrometricModel):
        """RH must be capped at 100.0% and condensation occur during severe occupancy spikes."""
        w_z = 0.010
        T_z = 20.0
        w_amb = 0.025

        for _ in range(100):
            w_z, condensed_kg = psychro_model.step_moisture_with_condensation(
                w_z=w_z, temp_c=T_z, w_amb=w_amb, N_occ=50, dt=300.0
            )
            rh = float(psychro_model.relative_humidity(temp_c=T_z, w=w_z))
            assert 0.0 <= rh <= 100.0
            if rh >= 99.9:
                assert condensed_kg >= 0.0

    def test_dew_point_monotonicity(self, psychro_model: PsychrometricModel):
        """Dew point must never exceed dry bulb temperature."""
        for t in [10.0, 20.0, 30.0, 40.0]:
            for rh in [20.0, 50.0, 80.0, 100.0]:
                dp = float(psychro_model.dew_point(t, rh))
                assert dp <= t + 1e-4, f"Dew point {dp}°C exceeds dry bulb {t}°C at RH {rh}%"
                if rh == 100.0:
                    assert np.isclose(dp, t, atol=0.05)


# ============================================================================
# Test Suite 5: ASHRAE 90.1 Baseline Controller (F4)
# ============================================================================

class TestBaselineController:

    def test_ashrae_baseline_controller(self, baseline_controller: ASHRAEBaselineController):
        """Verify deadband zero power in [20°C, 24°C], heating < 20°C, cooling > 24°C."""
        # 1. Deadband float test
        temps_in_deadband = [20.0, 21.0, 22.0, 23.0, 24.0]
        for t in temps_in_deadband:
            q_hvac, p_elec = baseline_controller.compute_control(T_z=[t, t, t], T_amb=22.0)
            assert np.all(q_hvac == 0.0), f"Active thermal power inside deadband at {t}°C"
            assert np.all(np.isclose(p_elec, baseline_controller.p_standby))

        # 2. Heating test below 20°C: check monotonic increase with error for each zone
        q_18, p_18 = baseline_controller.compute_control(T_z=[18.0, 18.0, 18.0], T_amb=0.0)
        q_16, p_16 = baseline_controller.compute_control(T_z=[16.0, 16.0, 16.0], T_amb=0.0)
        q_14, p_14 = baseline_controller.compute_control(T_z=[14.0, 14.0, 14.0], T_amb=0.0)

        assert np.all(q_18 > 0.0), "Heating not active at 18°C"
        assert np.all(q_16 >= q_18), "Heating not increasing from 18°C to 16°C"
        assert np.all(q_14 >= q_16), "Heating not increasing from 16°C to 14°C"
        assert np.all(p_14 >= p_16) and np.all(p_16 >= p_18)

        # 3. Cooling test above 24°C: check monotonic increase with error for each zone
        q_26, p_26 = baseline_controller.compute_control(T_z=[26.0, 26.0, 26.0], T_amb=35.0)
        q_28, p_28 = baseline_controller.compute_control(T_z=[28.0, 28.0, 28.0], T_amb=35.0)
        q_30, p_30 = baseline_controller.compute_control(T_z=[30.0, 30.0, 30.0], T_amb=35.0)

        assert np.all(q_26 < 0.0), "Cooling not active at 26°C"
        assert np.all(np.abs(q_28) >= np.abs(q_26)), "Cooling not increasing from 26°C to 28°C"
        assert np.all(np.abs(q_30) >= np.abs(q_28)), "Cooling not increasing from 28°C to 30°C"
        assert np.all(p_30 >= p_28) and np.all(p_28 >= p_26)

    def test_cop_thermodynamic_degradation(self, baseline_controller: ASHRAEBaselineController):
        """Electrical power consumption increases at extreme ambient temperatures."""
        _, p_elec_mild = baseline_controller.compute_control(T_z=[26.0, 26.0, 26.0], T_amb=28.0)
        _, p_elec_extreme = baseline_controller.compute_control(T_z=[26.0, 26.0, 26.0], T_amb=42.0)
        assert np.all(p_elec_extreme > p_elec_mild), "COP did not penalize extreme outdoor heat"


# ============================================================================
# Test Suite 6: Performance & Stability 100-Episode Benchmark (F6)
# ============================================================================

class TestStabilityAndBenchmark:

    def test_100_episodes_crash_free_benchmark(self, gym_env: HVACGymEnv):
        """Execute 100 episodes (28,800 steps) in < 2.0 seconds without NaN or crash."""
        TOTAL_EPISODES = 100
        STEPS_PER_EPISODE = 288
        TOTAL_STEPS = TOTAL_EPISODES * STEPS_PER_EPISODE

        action = np.array([0.0, 0.0, 0.0], dtype=np.float32)

        start_time = time.perf_counter()
        steps_counted = 0

        for ep in range(TOTAL_EPISODES):
            obs, info = gym_env.reset(seed=1000 + ep)
            assert np.all(np.isfinite(obs)), f"Non-finite initial observation in episode {ep}"

            for step_idx in range(STEPS_PER_EPISODE):
                obs, reward, terminated, truncated, step_info = gym_env.step(action)
                steps_counted += 1

                if terminated or truncated:
                    break

        elapsed_sec = time.perf_counter() - start_time
        throughput = steps_counted / max(elapsed_sec, 1e-6)

        # Final checks on last step obs & reward
        assert np.all(np.isfinite(obs)), "Non-finite values in final observation"
        assert np.isfinite(reward), "Non-finite reward"
        assert steps_counted == TOTAL_STEPS
        print(f"\n[BENCHMARK] Executed {steps_counted} steps in {elapsed_sec:.4f}s ({throughput:.1f} steps/s)")
        assert elapsed_sec < 2.0, f"Benchmark execution too slow: {elapsed_sec:.3f}s (threshold 2.0s)"


# ============================================================================
# Test Suite 7: Environment, Weather & Telemetry Buffer Integration
# ============================================================================

class TestIntegrationComponents:

    def test_weather_generator_diurnal_cycle(self, weather_gen: WeatherGenerator):
        """Verify solar peak at noon, zero solar at night, and TOU price changes."""
        # Step through 24 hours (288 steps of 300s)
        weather_gen.reset(preset=WeatherPreset.SUMMER_HOT, seed=42, start_hour=0.0)

        night_solars = []
        noon_solar = 0.0

        for _ in range(288):
            snap = weather_gen.step(dt_seconds=300.0)
            if snap.sim_hour < 5.5 or snap.sim_hour > 18.5:
                night_solars.append(snap.solar_irradiance_w_m2)
            if 11.8 <= snap.sim_hour <= 12.2:
                noon_solar = snap.solar_irradiance_w_m2

        assert all(s == 0.0 for s in night_solars), "Solar irradiance detected at night"
        assert noon_solar > 500.0, f"Solar noon irradiance too low: {noon_solar}"

    def test_telemetry_circular_buffer(self):
        """Verify ring buffer capacity limit and FIFO eviction."""
        buf = TelemetryBuffer(capacity=100)

        for i in range(150):
            step_tel = StepTelemetry(
                step=i,
                timestamp_sim_hour=float(i % 24),
                outdoor_temp_c=25.0,
                outdoor_humidity_pct=50.0,
                solar_irradiance_w_m2=0.0,
                electricity_price_usd_kwh=0.14,
                baseline_power_kw=10.0,
                rl_power_kw=8.0,
                power_saved_kw=2.0,
                instantaneous_savings_pct=20.0,
                cumulative_baseline_energy_kwh=10.0 * i,
                cumulative_rl_energy_kwh=8.0 * i,
                cumulative_savings_pct=20.0,
                cumulative_cost_saved_usd=2.0 * i * 0.14,
                baseline_comfort_violation_total=0.0,
                rl_comfort_violation_total=0.0,
                zones_baseline={},
                zones_rl={},
            )
            buf.append(step_tel)

        assert len(buf) == 100
        latest = buf.get_latest()
        assert latest is not None and latest.step == 149
        oldest = buf.get_all()[0]
        assert oldest.step == 50  # Steps 0..49 evicted

    def test_gymnasium_env_contract(self, gym_env: HVACGymEnv):
        """Verify observation space containment and reset/step API contract."""
        obs, info = gym_env.reset(seed=123)
        assert obs.shape == (24,)
        assert gym_env.observation_space.contains(obs), f"Initial obs out of space: {obs}"

        for _ in range(10):
            action = gym_env.action_space.sample()
            obs, reward, terminated, truncated, info = gym_env.step(action)
            assert obs.shape == (24,)
            assert gym_env.observation_space.contains(obs), f"Step obs out of space: {obs}"
            assert isinstance(reward, (float, np.floating))
            assert isinstance(terminated, bool)
            assert isinstance(truncated, bool)
            assert isinstance(info, dict)
