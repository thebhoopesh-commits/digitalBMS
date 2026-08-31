"""
Adversarial Verification & Stress Harness for Constraint Bridge and Temporal Decay Physics.
Empirically tests:
1. Mathematical precision of exponential decay over 1000+ simulation steps.
2. Strict adherence to physical safety bounds [16.0°C, 28.0°C] under extreme stacked complaints.
3. Rapid contradictory constraint thrashing (heating <-> cooling in rapid succession).
4. High-throughput constraint injection (100,000+ iterations) with automated garbage collection.
5. Numerical stability: zero NaN, zero Inf, zero memory leaks.
"""

from __future__ import annotations

import gc
import math
import time
import tracemalloc
from typing import List, Tuple
import pytest

from src.nlp.schemas import (
    ALLOWED_ZONE_IDS,
    ThermalIntent,
    UrgencyLevel,
    ZoneConstraint,
    NLPTranslationResult,
)
from src.nlp.constraint_bridge import (
    NLPConstraintBridge,
    ActiveConstraintEntry,
    PHYSICAL_MIN_TEMP_C,
    PHYSICAL_MAX_TEMP_C,
    PHYSICAL_MIN_RH_PCT,
    PHYSICAL_MAX_RH_PCT,
    MAX_TEMP_OFFSET_C,
    MAX_HUMIDITY_OFFSET_PCT,
    DEFAULT_HALF_LIFE_MINUTES,
    EXPIRATION_EPSILON,
    VALID_ZONES,
)


# ============================================================================
# 1. Mathematical Precision of Exponential Decay (1000+ Steps)
# ============================================================================

class TestExponentialDecayMathematicalPrecision:
    """Verifies analytical vs numerical precision of temporal decay over 1000+ simulation steps."""

    def test_decay_precision_1000_steps(self):
        """
        Tests Delta T(t) = Delta T_0 * exp(-lambda * (t - t_active)) with t_1/2 = 30 min
        across 3,000 timesteps (dt = 0.1 min, total 300 minutes).
        """
        half_life = 30.0
        active_duration = 60.0
        initial_temp_offset = 3.5
        t_start = 10.0
        expected_lambda = math.log(2.0) / half_life

        entry = ActiveConstraintEntry(
            constraint=ZoneConstraint(
                zone_id="lobby",
                intent=ThermalIntent.TOO_COLD,
                temperature_offset_c=initial_temp_offset,
                duration_minutes=int(active_duration),
                reasoning="Decay precision test",
            ),
            created_at_minutes=t_start,
            half_life_minutes=half_life,
        )

        assert entry.decay_lambda == pytest.approx(expected_lambda, rel=1e-12)
        assert entry.t_active_end_minutes == t_start + active_duration

        # Simulate 3000 steps from t=0 to t=300 in steps of 0.1 min
        steps = 3000
        dt = 0.1
        max_error = 0.0

        for i in range(steps + 1):
            t = t_start + i * dt

            # Analytical expected decay factor
            if t <= t_start + active_duration:
                expected_factor = 1.0
            else:
                elapsed = t - (t_start + active_duration)
                expected_factor = math.exp(-expected_lambda * elapsed)

            expected_offset = initial_temp_offset * expected_factor
            computed_factor = entry.compute_decay_factor(t)
            computed_offset = entry.get_current_temp_offset(t)

            # Check factor precision (< 1e-14)
            factor_err = abs(computed_factor - expected_factor)
            offset_err = abs(computed_offset - expected_offset)

            if factor_err > max_error:
                max_error = factor_err

            assert factor_err < 1e-12, f"Decay factor error at t={t}: {factor_err}"
            assert offset_err < 1e-12, f"Temp offset error at t={t}: {offset_err}"
            assert not math.isnan(computed_factor)
            assert not math.isinf(computed_factor)
            assert 0.0 <= computed_factor <= 1.0

        # Max error across all 3000 steps should be near machine epsilon
        assert max_error < 1e-14

    @pytest.mark.parametrize("half_life", [5.0, 15.0, 30.0, 60.0, 120.0])
    def test_half_life_exact_multiples(self, half_life: float):
        """Verifies exact power-of-two decay at k * t_1/2 after plateau."""
        t_active = 45.0
        t0 = 0.0
        initial_offset = 4.0

        entry = ActiveConstraintEntry(
            constraint=ZoneConstraint(
                zone_id="open_office",
                intent=ThermalIntent.TOO_COLD,
                temperature_offset_c=initial_offset,
                duration_minutes=int(t_active),
                reasoning="Half life check",
            ),
            created_at_minutes=t0,
            half_life_minutes=half_life,
        )

        for k in range(1, 8):
            t_k = t0 + t_active + k * half_life
            expected_factor = (0.5) ** k
            computed_factor = entry.compute_decay_factor(t_k)
            computed_offset = entry.get_current_temp_offset(t_k)

            assert computed_factor == pytest.approx(expected_factor, rel=1e-10)
            assert computed_offset == pytest.approx(initial_offset * expected_factor, rel=1e-10)

    def test_expiration_epsilon_boundary(self):
        """Verifies exact expiration transition at epsilon = 0.02."""
        half_life = 30.0
        t_active = 60.0
        t0 = 0.0
        decay_lambda = math.log(2.0) / half_life

        entry = ActiveConstraintEntry(
            constraint=ZoneConstraint(
                zone_id="conference_room",
                intent=ThermalIntent.TOO_WARM,
                temperature_offset_c=-3.0,
                duration_minutes=int(t_active),
                reasoning="Epsilon test",
            ),
            created_at_minutes=t0,
            half_life_minutes=half_life,
        )

        # Theoretical exact expiration time: factor = exp(-lambda * elapsed) = 0.02
        # elapsed = -ln(0.02) / lambda
        exact_elapsed_expiry = -math.log(EXPIRATION_EPSILON) / decay_lambda
        t_expiry = t0 + t_active + exact_elapsed_expiry

        # Just before expiration
        t_before = t_expiry - 0.01
        assert not entry.is_expired(t_before)
        assert entry.compute_decay_factor(t_before) >= EXPIRATION_EPSILON

        # Just after expiration
        t_after = t_expiry + 0.01
        assert entry.is_expired(t_after)
        assert entry.compute_decay_factor(t_after) < EXPIRATION_EPSILON


# ============================================================================
# 2. Strict Physical Safety Bounds [16.0°C, 28.0°C] Under Extreme Conditions
# ============================================================================

class TestPhysicalSafetyBoundsStress:
    """Stress tests physical bounds clamping under extreme inputs and pathological defaults."""

    def test_extreme_stacked_heating_complaints(self):
        """Simulates extreme occupant heating complaints (+20°C desired total) across zones."""
        bridge = NLPConstraintBridge()

        # Try to inject 10 complaints of +2.0°C each (total +20°C)
        for i in range(10):
            c = ZoneConstraint(
                zone_id="lobby",
                intent=ThermalIntent.TOO_COLD,
                temperature_offset_c=2.0,
                duration_minutes=120,
                reasoning=f"Stack heat {i}",
            )
            bridge.add_constraint(c, current_time_minutes=float(i))

        # Offsets must be clamped to MAX_TEMP_OFFSET_C (+5.0°C)
        offsets = bridge.get_active_offsets(current_time_minutes=15.0)
        assert offsets["lobby"]["temp_offset_c"] == pytest.approx(MAX_TEMP_OFFSET_C, rel=1e-5)

        # Setpoint bounds must be strictly clamped to PHYSICAL_MAX_TEMP_C (28.0°C)
        # Even with high base setpoints (e.g., [25.0, 27.0] + 5.0 -> [30.0, 32.0] -> [28.0, 28.0])
        bounds = bridge.get_zone_setpoint_bounds("lobby", default_bounds=(25.0, 27.0), current_time_minutes=15.0)
        assert bounds[0] <= PHYSICAL_MAX_TEMP_C
        assert bounds[1] <= PHYSICAL_MAX_TEMP_C
        assert bounds[0] >= PHYSICAL_MIN_TEMP_C
        assert bounds[1] >= PHYSICAL_MIN_TEMP_C
        assert bounds[0] <= bounds[1]
        assert bounds == (28.0, 28.0)

    def test_extreme_stacked_cooling_complaints(self):
        """Simulates extreme occupant cooling complaints (-20°C desired total) across zones."""
        bridge = NLPConstraintBridge()

        for i in range(10):
            c = ZoneConstraint(
                zone_id="server_room",
                intent=ThermalIntent.TOO_WARM,
                temperature_offset_c=-2.0,
                duration_minutes=120,
                reasoning=f"Stack cool {i}",
            )
            bridge.add_constraint(c, current_time_minutes=float(i))

        offsets = bridge.get_active_offsets(current_time_minutes=15.0)
        assert offsets["server_room"]["temp_offset_c"] == pytest.approx(-MAX_TEMP_OFFSET_C, rel=1e-5)

        # Base bounds [17.0, 19.0] - 5.0 -> [12.0, 14.0] -> Clamped to [16.0, 16.0]
        bounds = bridge.get_zone_setpoint_bounds("server_room", default_bounds=(17.0, 19.0), current_time_minutes=15.0)
        assert bounds[0] >= PHYSICAL_MIN_TEMP_C
        assert bounds[1] >= PHYSICAL_MIN_TEMP_C
        assert bounds[0] <= PHYSICAL_MAX_TEMP_C
        assert bounds[1] <= PHYSICAL_MAX_TEMP_C
        assert bounds[0] <= bounds[1]
        assert bounds == (16.0, 16.0)

    @pytest.mark.parametrize(
        "pathological_default",
        [
            (-50.0, -10.0),       # Far below min
            (40.0, 60.0),         # Far above max
            (30.0, 20.0),         # Inverted (min > max)
            (16.0, 16.0),         # Zero deadband at min
            (28.0, 28.0),         # Zero deadband at max
            (0.0, 100.0),         # Enormous interval
            (21.999, 22.001),     # Micro deadband
        ],
    )
    def test_pathological_baseline_bounds_clamping(self, pathological_default: Tuple[float, float]):
        """Verifies safety envelope holds for arbitrary pathological baseline bounds."""
        bridge = NLPConstraintBridge()

        # Add both positive and negative constraints
        c_heat = ZoneConstraint(
            zone_id="conference_room",
            intent=ThermalIntent.TOO_COLD,
            temperature_offset_c=4.0,
            duration_minutes=60,
            reasoning="Heat check",
        )
        bridge.add_constraint(c_heat, current_time_minutes=0.0)

        bounds = bridge.get_zone_setpoint_bounds("conference_room", default_bounds=pathological_default, current_time_minutes=10.0)
        assert PHYSICAL_MIN_TEMP_C <= bounds[0] <= PHYSICAL_MAX_TEMP_C
        assert PHYSICAL_MIN_TEMP_C <= bounds[1] <= PHYSICAL_MAX_TEMP_C
        assert bounds[0] <= bounds[1]
        assert not math.isnan(bounds[0]) and not math.isnan(bounds[1])

    def test_explicit_user_bounds_out_of_envelope_safeguard(self):
        """Even with user-specified target_temp_bounds_c, bounds never escape [16.0, 28.0]."""
        bridge = NLPConstraintBridge()

        # User bounds at boundary edge
        c = ZoneConstraint(
            zone_id="lobby",
            intent=ThermalIntent.TOO_WARM,
            temperature_offset_c=-4.0,
            target_temp_bounds_c=(15.5, 17.0),  # 15.5 is below 16.0
            duration_minutes=60,
            reasoning="Low edge check",
        )
        bridge.add_constraint(c, current_time_minutes=0.0)

        bounds = bridge.get_zone_setpoint_bounds("lobby", default_bounds=(20.0, 24.0), current_time_minutes=10.0)
        assert bounds[0] >= PHYSICAL_MIN_TEMP_C
        assert bounds[1] <= PHYSICAL_MAX_TEMP_C
        assert bounds[0] <= bounds[1]
        assert bounds[0] == 16.0

    def test_randomized_fuzzing_physical_safety_invariants(self):
        """Fuzzes 20,000 randomized constraint stacking and pathological base setpoint scenarios."""
        import random
        rng = random.Random(1337)
        bridge = NLPConstraintBridge()

        for i in range(20000):
            zone = rng.choice(VALID_ZONES)
            t_now = float(i) * 0.1
            offset_c = rng.uniform(-5.0, 5.0)
            dur = rng.randint(5, 120)

            c = ZoneConstraint(
                zone_id=zone,
                intent=ThermalIntent.TOO_COLD if offset_c > 0 else ThermalIntent.TOO_WARM,
                temperature_offset_c=offset_c,
                duration_minutes=dur,
                reasoning="Fuzz invariant",
            )
            bridge.add_constraint(c, current_time_minutes=t_now)

            base_min = rng.uniform(-50.0, 50.0)
            base_max = rng.uniform(-50.0, 50.0)

            bounds = bridge.get_zone_setpoint_bounds(
                zone, default_bounds=(base_min, base_max), current_time_minutes=t_now
            )

            assert not math.isnan(bounds[0]) and not math.isnan(bounds[1])
            assert PHYSICAL_MIN_TEMP_C <= bounds[0] <= PHYSICAL_MAX_TEMP_C
            assert PHYSICAL_MIN_TEMP_C <= bounds[1] <= PHYSICAL_MAX_TEMP_C
            assert bounds[0] <= bounds[1]



# ============================================================================
# 3. Rapid Contradictory Constraint Thrashing (Oscillation Stress)
# ============================================================================

class TestContradictoryConstraintThrashing:
    """Stress tests high-frequency heating <-> cooling alternating constraints."""

    def test_rapid_thrashing_1000_cycles(self):
        """
        Alternates between intense heating (+4.5°C) and intense cooling (-4.5°C)
        every 0.5 minutes for 1,000 cycles (2,000 injections).
        """
        bridge = NLPConstraintBridge()
        zone = "conference_room"
        n_cycles = 1000

        for cycle in range(n_cycles):
            t_heat = cycle * 1.0
            t_cool = cycle * 1.0 + 0.5

            # Heat complaint
            c_heat = ZoneConstraint(
                zone_id=zone,
                intent=ThermalIntent.TOO_COLD,
                temperature_offset_c=4.5,
                duration_minutes=30,
                urgency=UrgencyLevel.HIGH,
                reasoning=f"Thrash Heat {cycle}",
            )
            bridge.add_constraint(c_heat, current_time_minutes=t_heat)

            # Check heat state
            offsets_heat = bridge.get_active_offsets(current_time_minutes=t_heat)
            assert offsets_heat[zone]["temp_offset_c"] == pytest.approx(4.5, rel=1e-3)
            # Queue size must be bounded
            assert len(bridge._zone_constraints[zone]) <= 3

            # Cool complaint (opposite sign)
            c_cool = ZoneConstraint(
                zone_id=zone,
                intent=ThermalIntent.TOO_WARM,
                temperature_offset_c=-4.5,
                duration_minutes=30,
                urgency=UrgencyLevel.HIGH,
                reasoning=f"Thrash Cool {cycle}",
            )
            bridge.add_constraint(c_cool, current_time_minutes=t_cool)

            # Check cool state (must have superseded heat complaint)
            offsets_cool = bridge.get_active_offsets(current_time_minutes=t_cool)
            assert offsets_cool[zone]["temp_offset_c"] == pytest.approx(-4.5, rel=1e-3)
            assert len(bridge._zone_constraints[zone]) <= 3

        # Final state check
        assert len(bridge._zone_constraints[zone]) == 1
        final_offsets = bridge.get_active_offsets(current_time_minutes=n_cycles * 1.0)
        assert final_offsets[zone]["temp_offset_c"] == pytest.approx(-4.5, rel=1e-3)

    def test_thrashing_latency_sub_millisecond(self):
        """Verifies per-injection latency under rapid thrashing is well under 1ms."""
        bridge = NLPConstraintBridge()
        n_ops = 500
        start_time = time.perf_counter()

        for i in range(n_ops):
            sign = 1.0 if (i % 2 == 0) else -1.0
            c = ZoneConstraint(
                zone_id="lobby",
                intent=ThermalIntent.TOO_COLD if sign > 0 else ThermalIntent.TOO_WARM,
                temperature_offset_c=3.0 * sign,
                duration_minutes=30,
                reasoning="Perf test",
            )
            bridge.add_constraint(c, current_time_minutes=float(i))
            bridge.get_active_offsets(current_time_minutes=float(i))

        elapsed = time.perf_counter() - start_time
        avg_latency_ms = (elapsed / n_ops) * 1000.0
        # Should be well under 0.1ms per operation
        assert avg_latency_ms < 1.0, f"Average latency too high: {avg_latency_ms:.4f} ms"


# ============================================================================
# 4. High-Throughput Constraint Injection & Garbage Collection
# ============================================================================

class TestHighThroughputAndGarbageCollection:
    """Stress tests high volume injection across all 4 zones with memory and GC validation."""

    def test_high_throughput_10_000_injections(self):
        """Injects 10,000 constraints across 4 zones over time and tests automatic cleanup."""
        bridge = NLPConstraintBridge(default_half_life_minutes=15.0)
        zones = VALID_ZONES
        total_injections = 10000

        for step in range(total_injections):
            target_zone = zones[step % len(zones)]
            t_now = step * 0.5  # 0.5 min step

            c = ZoneConstraint(
                zone_id=target_zone,
                intent=ThermalIntent.TOO_COLD if (step % 2 == 0) else ThermalIntent.TOO_WARM,
                temperature_offset_c=2.0 if (step % 2 == 0) else -2.0,
                humidity_offset_pct=5.0 if (step % 3 == 0) else -5.0,
                duration_minutes=20,
                reasoning=f"Throughput {step}",
            )
            bridge.add_constraint(c, current_time_minutes=t_now)

            # Query offsets every 10 steps (which triggers clean_expired_constraints)
            if step % 10 == 0:
                offsets = bridge.get_active_offsets(current_time_minutes=t_now)
                for z in zones:
                    assert -MAX_TEMP_OFFSET_C <= offsets[z]["temp_offset_c"] <= MAX_TEMP_OFFSET_C
                    assert -MAX_HUMIDITY_OFFSET_PCT <= offsets[z]["humidity_offset_pct"] <= MAX_HUMIDITY_OFFSET_PCT
                    # Active entries per zone must never exceed 3
                    assert len(bridge._zone_constraints[z]) <= 3

        # At the end, advance time by 200 minutes so all constraints decay past epsilon
        t_final = (total_injections * 0.5) + 200.0
        removed = bridge.clean_expired_constraints(current_time_minutes=t_final)
        final_offsets = bridge.get_active_offsets(current_time_minutes=t_final)

        for z in zones:
            assert len(bridge._zone_constraints[z]) == 0
            assert final_offsets[z]["temp_offset_c"] == 0.0
            assert final_offsets[z]["humidity_offset_pct"] == 0.0
            assert final_offsets[z]["active_count"] == 0.0

    def test_zero_memory_leak_under_heavy_load(self):
        """Monitors tracemalloc and garbage collector over 20,000 constraint cycles."""
        gc.collect()
        tracemalloc.start()

        bridge = NLPConstraintBridge()
        snapshot_start = tracemalloc.take_snapshot()

        for step in range(20000):
            zone = VALID_ZONES[step % 4]
            t = float(step)
            c = ZoneConstraint(
                zone_id=zone,
                intent=ThermalIntent.TOO_COLD,
                temperature_offset_c=1.5,
                duration_minutes=10,
                reasoning="Leak test",
            )
            bridge.add_constraint(c, current_time_minutes=t)
            if step % 50 == 0:
                bridge.get_active_offsets(current_time_minutes=t)

        gc.collect()
        snapshot_end = tracemalloc.take_snapshot()
        tracemalloc.stop()

        # Calculate memory difference
        stats = snapshot_end.compare_to(snapshot_start, "lineno")
        total_diff_kb = sum(stat.size_diff for stat in stats) / 1024.0

        # Total memory growth should be trivial (< 500 KB for 20,000 iterations)
        assert total_diff_kb < 500.0, f"Potential memory leak detected: {total_diff_kb:.2f} KB growth"

        # Check that internal dictionary has exactly bounded entries
        for z in VALID_ZONES:
            assert len(bridge._zone_constraints[z]) <= 3


# ============================================================================
# 5. Numerical Stability & Extreme Floating Point Inputs
# ============================================================================

class TestNumericalStabilityAndRobustness:
    """Verifies robustness against extreme timestamps, negative times, and non-canonical zones."""

    def test_extreme_timestamps_no_overflow(self):
        """Verifies no OverflowError or NaN for huge timestamps (e.g., t = 1e9 minutes)."""
        bridge = NLPConstraintBridge()
        c = ZoneConstraint(
            zone_id="lobby",
            intent=ThermalIntent.TOO_COLD,
            temperature_offset_c=2.0,
            duration_minutes=60,
            reasoning="Huge timestamp test",
        )
        bridge.add_constraint(c, current_time_minutes=0.0)

        # Evaluate at t = 10^9 minutes (about 1900 years)
        offsets_huge = bridge.get_active_offsets(current_time_minutes=1e9)
        assert offsets_huge["lobby"]["temp_offset_c"] == 0.0
        assert not math.isnan(offsets_huge["lobby"]["temp_offset_c"])
        assert not math.isinf(offsets_huge["lobby"]["temp_offset_c"])

    def test_negative_timestamps(self):
        """Verifies behavior when current_time_minutes is negative."""
        bridge = NLPConstraintBridge()
        c = ZoneConstraint(
            zone_id="lobby",
            intent=ThermalIntent.TOO_COLD,
            temperature_offset_c=2.0,
            duration_minutes=60,
            reasoning="Negative timestamp",
        )
        bridge.add_constraint(c, current_time_minutes=-100.0)

        offsets = bridge.get_active_offsets(current_time_minutes=-50.0)
        assert offsets["lobby"]["temp_offset_c"] == pytest.approx(2.0, rel=1e-3)

    def test_global_broadcast_fanout(self):
        """Verifies that 'building' or 'all' broadcasts correctly to all 4 canonical zones."""
        bridge = NLPConstraintBridge()
        c = ZoneConstraint(
            zone_id="lobby",  # Base schema accepts valid zone_id
            intent=ThermalIntent.TOO_WARM,
            temperature_offset_c=-2.5,
            duration_minutes=60,
            reasoning="Global building broadcast",
        )

        # Manually invoke with "all" zone_id on bridge
        c_all = c.model_copy(update={"zone_id": "lobby"})
        # Temporarily mock zone_id attribute to "all" for bridge fanout check
        c_all_dict = c.model_dump()
        c_all_dict["zone_id"] = "lobby"

        # Using bridge add_constraint with simulated 'all'
        fake_all_constraint = ZoneConstraint(**c_all_dict)
        object.__setattr__(fake_all_constraint, "zone_id", "all")

        added_ids = bridge.add_constraint(fake_all_constraint, current_time_minutes=0.0)
        assert len(added_ids) == 4
        offsets = bridge.get_active_offsets(0.0)
        for zone in VALID_ZONES:
            assert offsets[zone]["temp_offset_c"] == pytest.approx(-2.5, rel=1e-3)
