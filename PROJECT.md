# Project: Aura Rule System Improved Specification & Digital Twin Optimizer

## Architecture
The Aura Rule System enforces a strict 4-layer cyber-physical separation of concerns for building HVAC optimization:
1. **Semantic LLM Extraction Layer (R1)**: Semantic extraction of occupant comfort complaints into Pydantic `ComfortEvent` objects (intent, severity, suspected cause, confidence) without numerical temperature/humidity offsets. Dual-engine Gemini API + deterministic fallback regex parser.
2. **Deterministic Constraint Mapping & Dynamic Decay Layer (R2)**: Deterministic translation of `ComfortEvent` into bounded physical preferences ($\Delta T, \Delta RH, w_0$) and dynamic weight equation $w(t) = w_0 \cdot \phi_{temp}(t) \cdot \psi_{sensor}(t) \cdot \gamma_{cooldown}(t)$ with sensor error modulation and anti-thrashing cooldown.
3. **Safety Shield Authorization Layer (R3)**: Non-bypassable runtime supervisory filter between controllers (Baseline/RL) and simulation physics, enforcing hard bounds ($[16.0^\circ\text{C}, 28.0^\circ\text{C}]$, server room $[15.0^\circ\text{C}, 24.0^\circ\text{C}]$), slew rate limits ($\le 1.0^\circ\text{C}/\text{min}$), rapid reversal blocker, actuator saturation clipping, and safety-over-comfort invariants.
4. **Verification & Testing Layer**: Comprehensive unit test suite (`tests/test_enhanced_rules.py`) and existing 4-tier E2E testing framework.

## Code Layout
- `src/nlp/schemas.py`: Data contracts (`ComfortIntent`, `SeverityLevel`, `SuspectedCause`, `ComfortEvent`, `SemanticTranslationResult`, `BoundedPreference`, `ZoneConstraint`, `NLPTranslationResult`).
- `src/nlp/translator.py`: LLM prompt and response parsing for semantic extraction.
- `src/nlp/fallback_parser.py`: Deterministic fallback parser emitting valid `ComfortEvent`s.
- `src/nlp/constraint_bridge.py`: Deterministic constraint mapper, dynamic weight equation $w(t)$, sensor feedback modulation, zone cooldown tracking.
- `src/simulation/safety_shield.py`: Safety shield authorization layer, slew rate limiter, hard bounds, rapid reversal blocker, actuator saturation clipping.
- `src/simulation/dual_twin.py`: DualTwin comparative simulation runner integrating Safety Shield.
- `src/simulation/telemetry.py`: Telemetry models and safety event logging.
- `src/api/coordinator.py`: Coordinator connecting live telemetry to constraint bridge and safety shield.
- `tests/test_enhanced_rules.py`: Enhanced rules unit test suite covering R1, R2, R3, and closed-loop integration.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Semantic ComfortEvent Schema | Strict Pydantic model with extra="forbid", zone validation, confidence [0,1] | M1 (R1) | ORIGINAL_REQUEST §R1 |
| 2 | Semantic LLM Prompt & Parsing | Gemini LLM prompt extracting semantic intent without numerical offsets | M1 (R1) | ORIGINAL_REQUEST §R1 |
| 3 | Semantic Deterministic Fallback | Fallback regex parser emitting ComfortEvents without physical offsets | M1 (R1) | ORIGINAL_REQUEST §R1 |
| 4 | Multi-clause & Non-env Filtering | Clause segmentation and non-environmental query rejection | M1 (R1) | ORIGINAL_REQUEST §R1 |
| 5 | Deterministic Constraint Mapper | Deterministic mapping matrix (intent, severity) -> (delta_T, delta_RH, w_0) | M2 (R2) | ORIGINAL_REQUEST §R2 |
| 6 | Tripartite Dynamic Decay w(t) | Dynamic weight decay combining temporal plateau, sensor feedback, cooldown | M2 (R2) | ORIGINAL_REQUEST §R2 |
| 7 | Sensor Evidence Feedback | Sensor error ratio accelerating decay as temperature reaches target | M2 (R2) | ORIGINAL_REQUEST §R2 |
| 8 | Anti-thrashing Zone Cooldown | Cooldown refractory period (15 min) and damped opposite complaints | M2 (R2) | ORIGINAL_REQUEST §R2 |
| 9 | Safety Shield Hard Bounds | Clamping setpoints to [16.0, 28.0]C (server room [15.0, 24.0]C) | M3 (R3) | ORIGINAL_REQUEST §R3 |
| 10 | Slew Rate Limiter | Setpoint delta rate limiting <= 1.0C/min (2.0C/step) | M3 (R3) | ORIGINAL_REQUEST §R3 |
| 11 | Rapid Reversal Blocker | Thermal shock blocker preventing instant full cooling to full heating | M3 (R3) | ORIGINAL_REQUEST §R3 |
| 12 | Actuator Saturation Clipping | Clamping Q_hvac within [-Q_cool_max, +Q_heat_max] | M3 (R3) | ORIGINAL_REQUEST §R3 |
| 13 | Safety Override & Audit Trail | Safety invariant override logging with detailed telemetry flags | M3 (R3) | ORIGINAL_REQUEST §R3 |
| 14 | Enhanced Rules Test Suite | 14+ test cases in test_enhanced_rules.py verifying all R1, R2, R3 criteria | Testing Track | ORIGINAL_REQUEST §Verification |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | R1: Semantic LLM Extraction & Validation | schemas.py, translator.py, fallback_parser.py, preprocessor.py | none | PLANNED |
| M2 | R2: Deterministic Constraint Mapping & Decay | constraint_bridge.py | M1 | PLANNED |
| M3 | R3: Safety Shield Authorization Layer | safety_shield.py, dual_twin.py, telemetry.py, coordinator.py | M2 | PLANNED |
| M4 | E2E & Rule Verification Suite | test_enhanced_rules.py, full test suite pass, edge cases | M1, M2, M3 | PLANNED |
| M5 | Final Milestone: Hardening & Audit Verification | Adversarial coverage, forensic integrity audit, 100% test pass | M4 | PLANNED |

## Interface Contracts
### schemas.py ↔ translator.py & fallback_parser.py
- `ComfortIntent`: Enum (`too_cold`, `too_warm`, `too_humid`, `too_dry`, `stuffy`, `comfortable`, `unknown`)
- `SeverityLevel`: Enum (`low`, `medium`, `high`, `critical`)
- `SuspectedCause`: Enum (`draft`, `solar_gain`, `high_occupancy`, `equipment_heat`, `hvac_inactive`, `weather_extreme`, `unspecified`)
- `ComfortEvent`: Pydantic Model (`event_id`, `zone_id`, `intent`, `severity`, `suspected_cause`, `confidence`, `reasoning`, `timestamp`, `raw_text`), `extra="forbid"`.
- `SemanticTranslationResult`: (`raw_query`, `is_applicable`, `response_text`, `events: List[ComfortEvent]`, `timestamp`)

### schemas.py ↔ constraint_bridge.py
- `BoundedPreference`: (`zone_id`, `target_temp_offset_c`, `target_rh_offset_pct`, `base_weight`, `plateau_minutes`, `half_life_minutes`, `created_at`, `intent`, `severity`, `confidence`)
- `DeterministicConstraintMapper.map_event(event: ComfortEvent) -> BoundedPreference`
- `NLPConstraintBridge.add_event(event: ComfortEvent)` / `add_result(result: SemanticTranslationResult)`
- `NLPConstraintBridge.get_active_offsets(zone_id: str, current_temp_c: Optional[float]=None, current_time: Optional[float]=None) -> Tuple[float, float, float]`

### constraint_bridge.py & controllers ↔ safety_shield.py
- `SafetyShield.authorize_setpoint(zone_id: str, proposed_setpoint: float, current_setpoint: float, dt_seconds: float) -> Tuple[float, Dict[str, Any]]`
- `SafetyShield.authorize_action(zone_id: str, proposed_q_w: float, current_q_w: float, max_heat_w: float, max_cool_w: float, dt_seconds: float) -> Tuple[float, Dict[str, Any]]`
- Invariant: Safety bounds and slew rate limits strictly override any user preference setpoint delta.
