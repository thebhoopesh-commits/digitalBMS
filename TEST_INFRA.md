# E2E Test Infra: Aura Rule System & Digital Twin Optimizer

## Test Philosophy
- Requirement-driven, opaque-box & white-box verification per ORIGINAL_REQUEST.md.
- Multi-tier validation: R1 Semantic Extraction, R2 Deterministic Mapping & Dynamic Decay, R3 Safety Shield Invariants, and Full Closed-Loop Simulation Integration.

## Feature Inventory & Test Mapping
| # | Feature | Target Component | Test Case in `tests/test_enhanced_rules.py` | Tier |
|---|---------|------------------|----------------------------------------------|:----:|
| 1 | Semantic ComfortEvent Schema | `src/nlp/schemas.py` | `test_r1_pydantic_schema_extra_forbid`, `test_r1_schema_zone_normalization` | Tier 1 |
| 2 | Semantic LLM Prompt & Parsing | `src/nlp/translator.py` | `test_r1_semantic_extraction_canonical_freezing`, `test_r1_semantic_extraction_canonical_sweltering` | Tier 1 |
| 3 | Semantic Fallback Parser | `src/nlp/fallback_parser.py` | `test_r1_fallback_resilience_on_llm_timeout`, `test_r1_zero_hallucination_guarantee` | Tier 1 |
| 4 | Multi-clause & Non-env Filtering | `src/nlp/fallback_parser.py` | `test_r1_multi_clause_segmentation`, `test_r1_non_environmental_filtering` | Tier 1 |
| 5 | Deterministic Constraint Mapper | `src/nlp/constraint_bridge.py` | `test_r2_deterministic_mapping_matrix`, `test_r2_server_room_special_rule` | Tier 2 |
| 6 | Tripartite Dynamic Decay w(t) | `src/nlp/constraint_bridge.py` | `test_r2_dynamic_decay_plateau_and_exponential` | Tier 2 |
| 7 | Sensor Evidence Feedback | `src/nlp/constraint_bridge.py` | `test_r2_sensor_evidence_feedback_decay` | Tier 2 |
| 8 | Anti-thrashing Zone Cooldown | `src/nlp/constraint_bridge.py` | `test_r2_cooldown_anti_thrashing` | Tier 2 |
| 9 | Safety Shield Hard Bounds | `src/simulation/safety_shield.py` | `test_r3_safety_shield_hard_bounds_clamping`, `test_r3_server_room_safety_bounds` | Tier 3 |
| 10 | Slew Rate Limiter | `src/simulation/safety_shield.py` | `test_r3_safety_shield_slew_rate_limiting` | Tier 3 |
| 11 | Rapid Reversal Blocker | `src/simulation/safety_shield.py` | `test_r3_safety_shield_rapid_reversal_blocker` | Tier 3 |
| 12 | Actuator Saturation Clipping | `src/simulation/safety_shield.py` | `test_r3_safety_shield_actuator_saturation` | Tier 3 |
| 13 | Safety Invariant Dominance | `src/simulation/safety_shield.py` | `test_r3_safety_overrides_comfort_invariant` | Tier 3 |
| 14 | Closed-Loop E2E Integration | Full Pipeline | `test_end_to_end_closed_loop_pipeline`, `test_closed_loop_dual_twin_telemetry` | Tier 4 |

## Test Architecture
- Runner: `pytest`
- Execution: `pytest tests/test_enhanced_rules.py -v` and `pytest` (full project suite)
- Target: 100% passing tests across all test suites with zero regressions.
