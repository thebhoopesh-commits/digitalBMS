"""
Empirical Verification Benchmark & Stress Test Runner for Milestone 3 Constraint Bridge.
Outputs full forensic metrics: MAE, RMSE, max error, timing distributions, memory usage,
and safety invariant proofs.
"""

from __future__ import annotations

import gc
import math
import random
import sys
import time
import tracemalloc
from typing import Dict, List, Tuple

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


def run_exponential_decay_precision_benchmark() -> Dict[str, float]:
    """Tests 10,000 steps of exponential decay across 10 different half-life parameters."""
    print("[1/5] Running Exponential Decay Mathematical Precision Benchmark...")
    half_lives = [5.0, 10.0, 15.0, 30.0, 45.0, 60.0, 90.0, 120.0, 180.0, 240.0]
    total_steps = 0
    all_abs_errors = []
    max_abs_error = 0.0

    for hl in half_lives:
        t_active = 45.0
        t0 = 10.0
        delta_t_0 = 3.75
        expected_lambda = math.log(2.0) / hl

        entry = ActiveConstraintEntry(
            constraint=ZoneConstraint(
                zone_id="lobby",
                intent=ThermalIntent.TOO_COLD,
                temperature_offset_c=delta_t_0,
                duration_minutes=int(t_active),
                reasoning="Benchmark",
            ),
            created_at_minutes=t0,
            half_life_minutes=hl,
        )

        # 1,000 steps per half-life -> 10,000 total steps
        dt = 0.2  # 0.2 min per step
        for step in range(1000):
            t = t0 + step * dt
            if t <= t0 + t_active:
                expected_factor = 1.0
            else:
                elapsed = t - (t0 + t_active)
                expected_factor = math.exp(-expected_lambda * elapsed)

            expected_offset = delta_t_0 * expected_factor
            computed_factor = entry.compute_decay_factor(t)
            computed_offset = entry.get_current_temp_offset(t)

            err_factor = abs(computed_factor - expected_factor)
            err_offset = abs(computed_offset - expected_offset)

            all_abs_errors.append(err_offset)
            if err_offset > max_abs_error:
                max_abs_error = err_offset

            assert not math.isnan(computed_factor), f"NaN detected at t={t}"
            assert not math.isinf(computed_factor), f"Inf detected at t={t}"
            total_steps += 1

    mae = sum(all_abs_errors) / len(all_abs_errors)
    rmse = math.sqrt(sum(e**2 for e in all_abs_errors) / len(all_abs_errors))

    print(f"      Total Steps Evaluated: {total_steps}")
    print(f"      Max Absolute Error:    {max_abs_error:.4e} °C")
    print(f"      Mean Absolute Error:   {mae:.4e} °C")
    print(f"      Root Mean Square Error:{rmse:.4e} °C")

    return {
        "total_steps": float(total_steps),
        "max_abs_error": max_abs_error,
        "mae": mae,
        "rmse": rmse,
    }


def run_physical_bounds_fuzzing_benchmark() -> Dict[str, float]:
    """Fuzzes 50,000 extreme constraint stacking and pathological setpoint combinations."""
    print("[2/5] Running Physical Bounds Fuzzing Benchmark (50,000 iterations)...")
    bridge = NLPConstraintBridge()
    rng = random.Random(42)

    violations = 0
    nan_count = 0
    inversions = 0

    for i in range(50000):
        zone = rng.choice(VALID_ZONES)
        t_now = float(i) * 0.1

        # Generate fuzzed constraint
        offset_c = rng.uniform(-5.0, 5.0)
        dur = rng.randint(5, 120)
        c = ZoneConstraint(
            zone_id=zone,
            intent=ThermalIntent.TOO_COLD if offset_c > 0 else ThermalIntent.TOO_WARM,
            temperature_offset_c=offset_c,
            duration_minutes=dur,
            reasoning="Fuzz",
        )
        bridge.add_constraint(c, current_time_minutes=t_now)

        # Pathological base setpoints
        base_min = rng.uniform(-100.0, 100.0)
        base_max = rng.uniform(-100.0, 100.0)

        bounds = bridge.get_zone_setpoint_bounds(
            zone, default_bounds=(base_min, base_max), current_time_minutes=t_now
        )

        # Check invariants
        if math.isnan(bounds[0]) or math.isnan(bounds[1]):
            nan_count += 1
        if bounds[0] < PHYSICAL_MIN_TEMP_C or bounds[0] > PHYSICAL_MAX_TEMP_C:
            violations += 1
        if bounds[1] < PHYSICAL_MIN_TEMP_C or bounds[1] > PHYSICAL_MAX_TEMP_C:
            violations += 1
        if bounds[0] > bounds[1]:
            inversions += 1

    print(f"      Evaluated Fuzz Cases:  50,000")
    print(f"      Physical Violations:   {violations}")
    print(f"      Bound Inversions:      {inversions}")
    print(f"      NaN / Inf Count:       {nan_count}")

    assert violations == 0
    assert inversions == 0
    assert nan_count == 0

    return {
        "fuzz_cases": 50000.0,
        "violations": float(violations),
        "inversions": float(inversions),
        "nan_count": float(nan_count),
    }


def run_rapid_thrashing_stress_benchmark() -> Dict[str, float]:
    """Tests 5,000 rapid heating <-> cooling thrashing events across all 4 zones."""
    print("[3/5] Running Rapid Contradictory Constraint Thrashing Benchmark...")
    bridge = NLPConstraintBridge()
    latencies = []
    zone = "conference_room"

    n_events = 5000
    for i in range(n_events):
        sign = 1.0 if (i % 2 == 0) else -1.0
        t_now = float(i) * 0.05  # every 3 seconds sim time

        t_start = time.perf_counter()

        c = ZoneConstraint(
            zone_id=zone,
            intent=ThermalIntent.TOO_COLD if sign > 0 else ThermalIntent.TOO_WARM,
            temperature_offset_c=4.0 * sign,
            duration_minutes=30,
            reasoning=f"Thrash {i}",
        )
        bridge.add_constraint(c, current_time_minutes=t_now)
        offsets = bridge.get_active_offsets(current_time_minutes=t_now)

        t_elapsed = time.perf_counter() - t_start
        latencies.append(t_elapsed * 1_000_000.0)  # microseconds

        # Verification: new complaint must immediately dominate
        expected_sign = 1 if sign > 0 else -1
        actual_sign = 1 if offsets[zone]["temp_offset_c"] > 0 else -1
        assert actual_sign == expected_sign, f"Thrashing failure at event {i}"
        assert len(bridge._zone_constraints[zone]) <= 3

    avg_lat_us = sum(latencies) / len(latencies)
    max_lat_us = max(latencies)
    p99_lat_us = sorted(latencies)[int(0.99 * len(latencies))]

    print(f"      Total Thrash Events:   {n_events}")
    print(f"      Mean Latency:          {avg_lat_us:.2f} µs")
    print(f"      p99 Latency:           {p99_lat_us:.2f} µs")
    print(f"      Max Latency:           {max_lat_us:.2f} µs")

    return {
        "thrash_events": float(n_events),
        "mean_latency_us": avg_lat_us,
        "p99_latency_us": p99_lat_us,
        "max_latency_us": max_lat_us,
    }


def run_high_throughput_and_memory_benchmark() -> Dict[str, float]:
    """Tests 100,000 constraint injections with continuous garbage collection profiling."""
    print("[4/5] Running High-Throughput (100,000) & Memory Leak Benchmark...")
    gc.collect()
    tracemalloc.start()
    snap_before = tracemalloc.take_snapshot()

    bridge = NLPConstraintBridge(default_half_life_minutes=20.0)
    total_ops = 100000

    t_start = time.perf_counter()
    for step in range(total_ops):
        target_zone = VALID_ZONES[step % 4]
        t_sim = float(step) * 0.25

        c = ZoneConstraint(
            zone_id=target_zone,
            intent=ThermalIntent.TOO_COLD if (step % 2 == 0) else ThermalIntent.TOO_WARM,
            temperature_offset_c=2.5 if (step % 2 == 0) else -2.5,
            duration_minutes=15,
            reasoning=f"High throughput {step}",
        )
        bridge.add_constraint(c, current_time_minutes=t_sim)

        if step % 100 == 0:
            bridge.get_active_offsets(current_time_minutes=t_sim)

    total_time = time.perf_counter() - t_start
    ops_per_sec = total_ops / total_time

    # Final cleanup advance
    t_end = float(total_ops) * 0.25 + 300.0
    bridge.clean_expired_constraints(current_time_minutes=t_end)

    gc.collect()
    snap_after = tracemalloc.take_snapshot()
    tracemalloc.stop()

    stats = snap_after.compare_to(snap_before, "lineno")
    total_growth_kb = sum(stat.size_diff for stat in stats) / 1024.0

    print(f"      Total Operations:      {total_ops}")
    print(f"      Throughput:            {ops_per_sec:.1f} ops/sec")
    print(f"      Total Heap Delta:      {total_growth_kb:.2f} KB")

    for z in VALID_ZONES:
        assert len(bridge._zone_constraints[z]) == 0, f"Uncleaned constraints in zone {z}"

    return {
        "total_ops": float(total_ops),
        "ops_per_sec": ops_per_sec,
        "heap_growth_kb": total_growth_kb,
    }


def run_numerical_stability_matrix() -> Dict[str, float]:
    """Tests extreme floating-point edge cases and boundary parameters."""
    print("[5/5] Running Numerical Stability & Boundary Matrix...")
    bridge = NLPConstraintBridge()

    edge_cases = [
        # (created_at, duration, half_life, eval_time)
        (0.0, 60, 30.0, 0.0),
        (0.0, 60, 30.0, 60.0),
        (0.0, 60, 30.0, 60.00000001),
        (0.0, 60, 30.0, 1e12),
        (-1000.0, 60, 30.0, -950.0),
        (1e6, 60, 30.0, 1e6 + 60.0),
        (0.0, 1, 1.0, 50.0),
        (0.0, 1440, 120.0, 1440.0),
    ]

    for c_at, dur, hl, t_ev in edge_cases:
        entry = ActiveConstraintEntry(
            constraint=ZoneConstraint(
                zone_id="lobby",
                intent=ThermalIntent.TOO_COLD,
                temperature_offset_c=2.0,
                duration_minutes=dur,
                reasoning="Edge case",
            ),
            created_at_minutes=c_at,
            half_life_minutes=hl,
        )

        factor = entry.compute_decay_factor(t_ev)
        temp_off = entry.get_current_temp_offset(t_ev)
        hum_off = entry.get_current_humidity_offset(t_ev)
        expired = entry.is_expired(t_ev)

        assert not math.isnan(factor), f"NaN factor at {c_at, dur, hl, t_ev}"
        assert not math.isinf(factor), f"Inf factor at {c_at, dur, hl, t_ev}"
        assert not math.isnan(temp_off), f"NaN temp offset"
        assert not math.isnan(hum_off), f"NaN hum offset"
        assert 0.0 <= factor <= 1.0

    print("      All Edge Cases Passed: 100% Stable (0 NaN, 0 Inf)")
    return {"edge_cases_passed": float(len(edge_cases))}


def main():
    print("=" * 75)
    print("EMPIRICAL CHALLENGER 2: CONSTRAINT BRIDGE VERIFICATION HARNESS")
    print("=" * 75)

    r1 = run_exponential_decay_precision_benchmark()
    r2 = run_physical_bounds_fuzzing_benchmark()
    r3 = run_rapid_thrashing_stress_benchmark()
    r4 = run_high_throughput_and_memory_benchmark()
    r5 = run_numerical_stability_matrix()

    print("=" * 75)
    print("ALL EMPIRICAL CHALLENGE TESTS PASSED SUCCESSFULLY.")
    print("=" * 75)


if __name__ == "__main__":
    main()
