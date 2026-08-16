# E2E Test Infra: Digital Twin Building Optimizer with NLP Feedback

## Test Philosophy
- **Requirement-Driven & Opaque-Box**: Tests are derived strictly from user requirements in `ORIGINAL_REQUEST.md` and feature contracts in `PROJECT.md`, without coupling to internal private helpers.
- **Progressive Testability**: Low-tier tests exercise fundamental units through public entry points so failures can be isolated immediately.
- **Methodology**: Systematic 4-tier testing hierarchy combining:
  1. Category-Partition Equivalence Class Testing (Tier 1)
  2. Boundary Value Analysis & Corner Stress (Tier 2)
  3. Pairwise Combinatorial Interaction Testing (Tier 3)
  4. Real-World Workload & Disturbance Simulation (Tier 4)

---

## Feature Inventory & Test Mapping

| # | Feature Name | Requirement Source | Tier 1 Target | Tier 2 Target | Tier 3 | Tier 4 |
|---|--------------|-------------------|:-------------:|:-------------:|:------:|:------:|
| F1 | Multi-Zone 3R2C Thermal Model | ORIGINAL_REQUEST R3 / PROJECT.md F1 | 5 | 5 | ✓ | ✓ |
| F2 | Environmental Dynamics & Weather Generator | ORIGINAL_REQUEST R3 / PROJECT.md F2 | 5 | 5 | ✓ | ✓ |
| F3 | Psychrometric & Humidity Dynamics | ORIGINAL_REQUEST R2, R3 / PROJECT.md F3 | 5 | 5 | ✓ | ✓ |
| F4 | ASHRAE 90.1 Baseline Dual-Setpoint Controller | ORIGINAL_REQUEST R3 / PROJECT.md F4 | 5 | 5 | ✓ | ✓ |
| F5 | Deterministic Physics Solver & Telemetry Logger | ORIGINAL_REQUEST R3 / PROJECT.md F5 | 5 | 5 | ✓ | ✓ |
| F6 | 100+ Episode Crash-Free Stability Benchmark | ORIGINAL_REQUEST AC-3 / PROJECT.md F6 | 5 | 5 | ✓ | ✓ |
| F7 | RL Agent & Observation/Action Space | ORIGINAL_REQUEST R3 / PROJECT.md F7 | 5 | 5 | ✓ | ✓ |
| F8 | Multi-Objective Reward Engine | ORIGINAL_REQUEST R3 / PROJECT.md F8 | 5 | 5 | ✓ | ✓ |
| F9 | Synchronized Dual-Twin Comparative Runner | ORIGINAL_REQUEST R3, AC-4 / PROJECT.md F9 | 5 | 5 | ✓ | ✓ |
| F10 | Energy & Comfort Comparative Telemetry | ORIGINAL_REQUEST R3, AC-4 / PROJECT.md F10 | 5 | 5 | ✓ | ✓ |
| F11 | Strict Pydantic Constraint Schemas | ORIGINAL_REQUEST R2, AC-2 / PROJECT.md F11 | 5 | 5 | ✓ | ✓ |
| F12 | Dual-Engine LLM Translation Pipeline | ORIGINAL_REQUEST R2 / PROJECT.md F12 | 5 | 5 | ✓ | ✓ |
| F13 | 5+ Vague Complaint Canonical Test Suite | ORIGINAL_REQUEST AC-2 / PROJECT.md F13 | 5 | 5 | ✓ | ✓ |
| F14 | Dynamic NLP Constraint Bridge & Decay | ORIGINAL_REQUEST R2, R3 / PROJECT.md F14 | 5 | 5 | ✓ | ✓ |
| F15 | FastAPI REST Endpoints | ORIGINAL_REQUEST R1, AC-1 / PROJECT.md F15 | 5 | 5 | ✓ | ✓ |
| F16 | Real-time SSE Telemetry Streaming | ORIGINAL_REQUEST R1 / PROJECT.md F16 | 5 | 5 | ✓ | ✓ |
| F17 | Closed-Loop Event Coordinator | ORIGINAL_REQUEST R1, AC-1 / PROJECT.md F17 | 5 | 5 | ✓ | ✓ |
| F18 | Interactive Occupant Chat UI & Inspector | ORIGINAL_REQUEST R1 / PROJECT.md F18 | 5 | 5 | ✓ | ✓ |
| F19 | Multi-Zone Digital Twin Visualizer | ORIGINAL_REQUEST R1 / PROJECT.md F19 | 5 | 5 | ✓ | ✓ |
| F20 | Real-time Comparative Performance Charts | ORIGINAL_REQUEST R1 / PROJECT.md F20 | 5 | 5 | ✓ | ✓ |
| F21 | Simulation Control Deck & Weather Presets | ORIGINAL_REQUEST R1 / PROJECT.md F21 | 5 | 5 | ✓ | ✓ |

---

## Test Architecture & Directory Layout

```
digital_twin_hvac/
├── TEST_INFRA.md                          # Test framework architecture & methodology
├── TEST_READY.md                          # Published once 100% tests verified
├── run_tests.py                           # Master CLI test runner
└── tests/
    ├── __init__.py
    ├── conftest.py                        # Common test fixtures, mocking, and helpers
    └── e2e_suite/
        ├── __init__.py
        ├── test_tier1_features.py         # 105+ isolated feature tests (F1-F21, >=5/feature)
        ├── test_tier2_boundaries.py       # 105+ boundary/edge/stress tests (F1-F21, >=5/feature)
        ├── test_tier3_pairwise.py         # 21+ pairwise cross-module integration tests
        └── test_tier4_scenarios.py        # 8+ multi-hour/multi-day building operation scenarios
```

### Test Invocation & Semantics
- **Run All Tests**: `python run_tests.py` or `pytest tests/e2e_suite/`
- **Run by Tier**: `python run_tests.py --tier 1` (or `--tier 2`, `--tier 3`, `--tier 4`)
- **JSON Output**: `python run_tests.py --json report.json`
- **Exit Code**: `0` on 100% pass; non-zero if any test fails.

---

## Real-World Workload Scenarios (Tier 4)

| # | Scenario Name | Features Exercised | Disturbance & Challenge Profile | Success Criteria |
|---|---------------|--------------------|---------------------------------|------------------|
| S1 | Heatwave Stress with High Peak Pricing | F1, F2, F7, F8, F9, F10, F15 | Ambient temp spikes to 38°C; electricity price triples from 14:00-18:00. | RL pre-cools zone during cheap hours; saves >15% cost vs baseline while maintaining comfort bounds. |
| S2 | Winter Cold Snap & Sudden Occupancy Shock | F1, F2, F3, F7, F8, F9, F14 | Ambient drops to -5°C; 25 occupants flood conference room with moisture spike. | Dual-twin tracks latent and sensible load; zero freezing violations; energy efficient heating. |
| S3 | Conflicting Occupant Complaints Storm | F11, F12, F13, F14, F17, F19 | Lobby occupant complaints: "Freezing!" followed 10 min later by "Too hot!"; Office complaints: "Humid and stuffy!". | NLP engine translates both; constraint bridge reconciles/prioritizes by timestamp and urgency; no oscillation or crash. |
| S4 | 7-Day Unattended Continuous Operation | F5, F6, F9, F10, F16, F17 | 168 hours of simulated continuous closed-loop operation (20,160 timesteps at 30s dt). | Zero NaN values, no memory growth, continuous SSE packet stream, cumulative metrics strictly monotonic. |
| S5 | Rapid Weather Transition (Storm Front) | F2, F3, F5, F8, F9, F21 | Solar irradiance drops 90% in 5 minutes with outdoor temp plummeting 15°C and RH jumping from 30% to 95%. | RK4 solver smoothly handles steep thermal gradient; baseline and RL controllers respond without divergence. |
| S6 | Full Closed-Loop User Interaction Loop | F11, F12, F14, F15, F16, F17, F18 | UI submits REST chat -> NLP translation -> RL setpoint decay -> SSE telemetry stream verification. | Round-trip latency < 500ms; telemetry reflects setpoint shift in <2 simulation steps. |
| S7 | Sensor Noise & Outlier Tolerance | F1, F3, F7, F8, F10, F16 | Synthetic Gaussian noise (+/- 2°C, +/- 10% RH) and intermittent sensor dropouts injected. | Moving average filters prevent high-frequency chatter; RL agent remains stable. |
| S8 | Multi-Zone Thermal Coupling & Zone Conflict | F1, F4, F7, F8, F9, F10 | Conference room cooling set to 19°C while adjacent Open Office heating set to 24°C across shared partition. | 3R2C thermal inter-zone conductivity correctly transfers boundary heat flux without numerical instability. |

---

## Coverage Thresholds
- **Tier 1 (Feature Coverage)**: ≥ 105 tests (≥5 test cases across each of the 21 features).
- **Tier 2 (Boundary & Corner Cases)**: ≥ 105 tests (≥5 boundary cases across each of the 21 features).
- **Tier 3 (Cross-Feature Combinations)**: ≥ 21 tests (all major pairwise interactions).
- **Tier 4 (Real-World Scenarios)**: ≥ 8 multi-hour/multi-day comprehensive scenarios.
- **Total Minimum Target**: ≥ 239 test cases.
