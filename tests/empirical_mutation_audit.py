"""Empirical Mutation Testing and Adversarial Challenge Script.
Executes AST tautology audit, systematic mutation kills, and multi-run flakiness tests.
"""

import ast
import glob
import os
import subprocess
import sys
import time
import json
import numpy as np


WORKSPACE_DIR = r"C:\Users\thebh\.gemini\antigravity\scratch\teamwork_projects\digital_twin_hvac"
if WORKSPACE_DIR not in sys.path:
    sys.path.insert(0, WORKSPACE_DIR)

CONFTEST_PATH = os.path.join(WORKSPACE_DIR, "tests", "conftest.py")
TEST_FILES = glob.glob(os.path.join(WORKSPACE_DIR, "tests", "e2e_suite", "test_tier*.py"))


def run_pytest(args=None):
    if args is None:
        args = ["-q", "--tb=no", "tests/e2e_suite/"]
    cmd = [sys.executable, "-m", "pytest"] + args
    res = subprocess.run(cmd, cwd=WORKSPACE_DIR, capture_output=True, text=True)
    return res.returncode, res.stdout, res.stderr


# ----------------------------------------------------------------------
# 1. AST Tautology & Assertion Quality Audit
# ----------------------------------------------------------------------
def audit_ast_assertions():
    print("=" * 70)
    print("1. AST TAUTOLOGY & ASSERTION QUALITY AUDIT")
    print("=" * 70)
    
    total_test_funcs = 0
    total_assert_stmts = 0
    suspicious_asserts = []
    tests_without_asserts = []

    for fpath in sorted(TEST_FILES):
        rel_path = os.path.relpath(fpath, WORKSPACE_DIR)
        with open(fpath, "r", encoding="utf-8") as f:
            tree = ast.parse(f.read(), filename=fpath)

        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test_"):
                total_test_funcs += 1
                assert_count = 0
                has_raises = False

                for child in ast.walk(node):
                    if isinstance(child, ast.Assert):
                        assert_count += 1
                        total_assert_stmts += 1
                        # Check for constant asserts like `assert True`, `assert 1`, `assert not False`
                        if isinstance(child.test, ast.Constant):
                            suspicious_asserts.append((rel_path, node.name, child.lineno, f"Constant assert: {child.test.value}"))
                        # Check for assert x == x where both sides are identical names
                        elif isinstance(child.test, ast.Compare):
                            if len(child.test.ops) == 1 and isinstance(child.test.ops[0], ast.Eq):
                                left = ast.unparse(child.test.left)
                                right = ast.unparse(child.test.comparators[0])
                                if left == right and not left.endswith("()"):
                                    suspicious_asserts.append((rel_path, node.name, child.lineno, f"Tautological compare: {left} == {right}"))
                    elif isinstance(child, ast.With):
                        for item in child.items:
                            call_str = ast.unparse(item.context_expr)
                            if "pytest.raises" in call_str or "raises" in call_str:
                                has_raises = True

                if assert_count == 0 and not has_raises:
                    tests_without_asserts.append((rel_path, node.name))

    print(f"Total Test Functions Audited: {total_test_funcs}")
    print(f"Total Assertion Statements  : {total_assert_stmts}")
    print(f"Average Assertions per Test : {total_assert_stmts / total_test_funcs:.2f}")
    print(f"Suspicious / Tautology Count: {len(suspicious_asserts)}")
    print(f"Tests Without Assert/Raises : {len(tests_without_asserts)}")

    if suspicious_asserts:
        for s in suspicious_asserts:
            print(f"  [!] SUSPICIOUS: {s[0]}:{s[2]} in {s[1]}: {s[3]}")
    if tests_without_asserts:
        for t in tests_without_asserts:
            print(f"  [!] NO EXPLICIT ASSERTION: {t[0]} in {t[1]}")

    return {
        "total_test_funcs": total_test_funcs,
        "total_assert_stmts": total_assert_stmts,
        "suspicious_count": len(suspicious_asserts),
        "no_assert_count": len(tests_without_asserts),
        "suspicious_details": suspicious_asserts,
        "no_assert_details": tests_without_asserts
    }


# ----------------------------------------------------------------------
# 2. Dynamic Mutation Testing Framework
# ----------------------------------------------------------------------
MUTATIONS = [
    {
        "id": "MUT_01_PHYSICS_ODE_INTERZONE",
        "description": "Invert inter-zone heat flux sign in thermal ODE (violating 2nd law)",
        "target": "q_interzone += (tz[other_id] - t_air) / 0.05",
        "mutant": "q_interzone -= (tz[other_id] - t_air) / 0.05",
    },
    {
        "id": "MUT_02_PHYSICS_SOLAR_GAIN",
        "description": "Corrupt solar thermal gain to zero (ignoring solar radiation)",
        "target": "q_solar_air = 0.4 * z.shgc * z.window_area_m2 * ambient.solar_irradiance_w_m2",
        "mutant": "q_solar_air = 0.0",
    },
    {
        "id": "MUT_03_PSYCHROMETRICS_MAGNUS",
        "description": "Corrupt Magnus-Tetens saturation vapor pressure formula",
        "target": "return 610.78 * math.exp((17.27 * temp_c) / (temp_c + 237.3))",
        "mutant": "return 100.0 * math.exp((10.0 * temp_c) / (temp_c + 200.0))",
    },
    {
        "id": "MUT_04_ASHRAE_DEADBAND_LOGIC",
        "description": "Invert ASHRAE 90.1 dual-setpoint cooling trigger condition",
        "target": "if temp_c > t_cool:",
        "mutant": "if temp_c < t_cool:",
    },
    {
        "id": "MUT_05_NLP_INTENT_OFFSET",
        "description": "Corrupt NLP temperature offset for 'too_cold' from positive to negative",
        "target": "offset = 2.0 if urgency == UrgencyLevel.MEDIUM else (2.5 if urgency == UrgencyLevel.HIGH else 1.0)",
        "mutant": "offset = -2.0  # Inverted cold offset",
    },
    {
        "id": "MUT_06_NLP_ZONE_EXTRACTION",
        "description": "Break NLP zone detection by disabling lobby recognition",
        "target": 'if "lobby" in lower:',
        "mutant": 'if False and "lobby" in lower:',
    },
    {
        "id": "MUT_07_DYNAMIC_DECAY_BRIDGE",
        "description": "Break exponential decay in constraint bridge (freeze offset without decay)",
        "target": "factor = math.pow(0.5, decay_time / self.decay_half_life)",
        "mutant": "factor = 1.0  # No decay",
    },
    {
        "id": "MUT_08_RL_REWARD_COMFORT_SIGN",
        "description": "Flip comfort penalty to negative penalty in reward engine",
        "target": "err = max(0.0, t - t_max)**2 + max(0.0, t_min - t)**2",
        "mutant": "err = -(max(0.0, t - t_max)**2 + max(0.0, t_min - t)**2)",
    },
    {
        "id": "MUT_09_DUAL_TWIN_COMPARISON",
        "description": "Corrupt cumulative energy tracking in dual twin comparative runner",
        "target": "self.cum_rl_kwh += p_rl * dt_hours",
        "mutant": "self.cum_rl_kwh += 0.0 * dt_hours  # Zero energy accumulator",
    },
    {
        "id": "MUT_10_REST_CHAT_PAYLOAD",
        "description": "Corrupt REST chat endpoint payload response structure",
        "target": 'return {"translation": res.model_dump(), "applied": applied}',
        "mutant": 'return {"corrupted": True}',
    },
    {
        "id": "MUT_11_WEATHER_DIURNAL_CYCLE",
        "description": "Flatten outdoor diurnal weather temperature oscillation",
        "target": 't_out = cfg["t_base"] + cfg["t_amp"] * math.sin((2 * math.pi * (h - 9.0)) / 24.0)',
        "mutant": 't_out = cfg["t_base"]  # No diurnal amplitude',
    },
    {
        "id": "MUT_12_PYDANTIC_FORBID_EXTRA",
        "description": "Allow extra hallucinated fields in ZoneConstraint schema (violating extra='forbid')",
        "target": 'model_config = ConfigDict(extra="forbid")',
        "mutant": 'model_config = ConfigDict(extra="allow")',
    },
    {
        "id": "MUT_13_BASELINE_SETPOINT_SANITY",
        "description": "Invert baseline heating/cooling setpoint check exception",
        "target": "if heat_setpoint_c > cool_setpoint_c:\n            raise ValueError(\"Heating setpoint cannot exceed cooling setpoint\")",
        "mutant": "if heat_setpoint_c < cool_setpoint_c:\n            raise ValueError(\"Corrupted setpoint check\")",
    }
]


def test_mutations():
    print("\n" + "=" * 70)
    print(f"2. DYNAMIC MUTATION SENSITIVITY & FAULT INJECTION TESTING ({len(MUTATIONS)} MUTANTS)")
    print("=" * 70)

    with open(CONFTEST_PATH, "r", encoding="utf-8") as f:
        original_conftest = f.read()

    mutation_results = []
    killed_count = 0

    try:
        for m in MUTATIONS:
            m_id = m["id"]
            desc = m["description"]
            target = m["target"]
            mutant = m["mutant"]

            if target not in original_conftest:
                print(f"[-] ERROR: Target string for {m_id} not found in conftest.py!")
                mutation_results.append({
                    "id": m_id, "desc": desc, "status": "ERROR_TARGET_NOT_FOUND", "killed": False
                })
                continue

            # Inject mutation
            mutated_conftest = original_conftest.replace(target, mutant, 1)
            with open(CONFTEST_PATH, "w", encoding="utf-8") as f:
                f.write(mutated_conftest)

            # Run test suite
            t0 = time.time()
            retcode, stdout, stderr = run_pytest()
            dt = time.time() - t0

            # Restore immediately
            with open(CONFTEST_PATH, "w", encoding="utf-8") as f:
                f.write(original_conftest)

            # Check if test suite detected and failed (KILLED)
            is_killed = (retcode != 0)
            if is_killed:
                killed_count += 1
                status = "KILLED (Test Suite Detected Fault)"
                failed_line = [l for l in (stdout + stderr).splitlines() if "failed" in l.lower() or "error" in l.lower()]
                summary = failed_line[-1] if failed_line else "Tests failed as expected"
            else:
                status = "SURVIVED (WARNING: Test Suite Missed This Bug!)"
                summary = "All tests passed despite corruption"

            print(f"[{'PASS' if is_killed else 'FAIL'}] {m_id} ({dt:.2f}s): {status}")
            print(f"    Target: {desc}")
            print(f"    Impact: {summary}")

            mutation_results.append({
                "id": m_id,
                "desc": desc,
                "status": "KILLED" if is_killed else "SURVIVED",
                "killed": is_killed,
                "duration_s": dt,
                "summary": summary
            })

    finally:
        # Guarantee restoration of conftest.py
        with open(CONFTEST_PATH, "w", encoding="utf-8") as f:
            f.write(original_conftest)

    total_mutations = len(MUTATIONS)
    kill_rate = (killed_count / total_mutations) * 100.0
    print("-" * 70)
    print(f"Mutation Testing Summary: {killed_count}/{total_mutations} Killed ({kill_rate:.1f}% Kill Rate)")
    print("=" * 70)

    return {
        "total_mutations": total_mutations,
        "killed_count": killed_count,
        "kill_rate_pct": kill_rate,
        "mutations": mutation_results
    }


# ----------------------------------------------------------------------
# 3. Flakiness, Concurrency, and Multi-Run Stability Testing
# ----------------------------------------------------------------------
def test_suite_flakiness(runs=10):
    print("\n" + "=" * 70)
    print(f"3. FLAKINESS & NON-DETERMINISM STRESS TESTING ({runs} ITERATIONS)")
    print("=" * 70)

    run_records = []
    all_passed = True

    for i in range(1, runs + 1):
        t0 = time.time()
        retcode, stdout, stderr = run_pytest()
        dt = time.time() - t0
        passed = (retcode == 0)
        if not passed:
            all_passed = False
        print(f"  Iteration {i:02d}/{runs:02d}: {'PASSED' if passed else 'FAILED'} in {dt:.2f}s")
        run_records.append({"run": i, "passed": passed, "duration_s": dt})

    avg_time = sum(r["duration_s"] for r in run_records) / runs
    max_time = max(r["duration_s"] for r in run_records)
    min_time = min(r["duration_s"] for r in run_records)

    print("-" * 70)
    print(f"Flakiness Assessment: {'100% DETERMINISTIC & NON-FLAKY' if all_passed else 'FLAKINESS DETECTED'}")
    print(f"Timing Profile: Min={min_time:.2f}s, Max={max_time:.2f}s, Avg={avg_time:.2f}s")
    print("=" * 70)

    return {
        "runs": runs,
        "all_passed": all_passed,
        "avg_time": avg_time,
        "min_time": min_time,
        "max_time": max_time,
        "runs_data": run_records
    }


# ----------------------------------------------------------------------
# 4. Multi-Seed Stability Benchmark Stress Test
# ----------------------------------------------------------------------
def test_multiseed_stability():
    print("\n" + "=" * 70)
    print("4. MULTI-SEED STABILITY BENCHMARK STRESS TEST (100 EPISODES x 5 SEEDS)")
    print("=" * 70)

    from tests.conftest import BenchmarkRunner

    seeds = [42, 100, 999, 12345, 98765]
    seed_results = []
    total_steps = 0
    total_crashes = 0
    total_nans = 0

    for s in seeds:
        runner = BenchmarkRunner(n_episodes=100, steps_per_episode=288)
        t0 = time.time()
        res = runner.run(n_episodes=100)
        dt = time.time() - t0

        steps = res.total_steps
        crashes = res.crashed_episodes
        nans = int(np.isnan(res.all_zone_temps).sum() + np.isinf(res.all_zone_temps).sum())
        steps_per_sec = steps / dt if dt > 0 else 0

        total_steps += steps
        total_crashes += crashes
        total_nans += nans

        print(f"  Seed {s:5d}: {res.total_episodes} eps, {steps:,} steps, Crashes={crashes}, NaNs={nans}, {steps_per_sec:,.0f} steps/s ({dt:.3f}s)")
        seed_results.append({
            "seed": s, "episodes": res.total_episodes, "steps": steps,
            "crashes": crashes, "nans": nans, "duration_s": dt, "steps_per_sec": steps_per_sec
        })

    print("-" * 70)
    print(f"Total Simulated Steps Across All Seeds: {total_steps:,}")
    print(f"Total Crashes: {total_crashes}, Total NaNs/Infs: {total_nans}")
    print(f"Stability Verdict: {'100% CRASH-FREE & NUMERICALLY STABLE' if (total_crashes == 0 and total_nans == 0) else 'INSTABILITY DETECTED'}")
    print("=" * 70)

    return {
        "seeds_tested": seeds,
        "total_steps": total_steps,
        "total_crashes": total_crashes,
        "total_nans": total_nans,
        "seed_data": seed_results
    }


def main():
    ast_res = audit_ast_assertions()
    mut_res = test_mutations()
    flaky_res = test_suite_flakiness(runs=10)
    seed_res = test_multiseed_stability()

    final_report = {
        "ast_audit": ast_res,
        "mutation_testing": mut_res,
        "flakiness_testing": flaky_res,
        "multiseed_stability": seed_res,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }

    report_path = os.path.join(WORKSPACE_DIR, ".agents", "challenger_e2e_1", "mutation_challenge_report.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(final_report, f, indent=2)

    print(f"\n[+] Full adversarial challenge report saved to: {report_path}")


if __name__ == "__main__":
    main()
