# Project: Digital Twin Building Optimizer with NLP Feedback

## Architecture

The Digital Twin Building Optimizer is an autonomous, closed-loop system that minimizes HVAC energy consumption while maximizing human comfort by translating natural language feedback into dynamic physical and reward constraints for a Reinforcement Learning-driven digital twin simulation.

```
+-----------------------------------------------------------------------------------+
|                            Standalone Web Dashboard (UI)                          |
|  - Real-Time Multi-Zone Thermal Visualizer       - Live Chart.js Comparative Telemetry |
|  - Occupant Natural Language Chat Interface      - Simulation Control Deck & Presets |
+-----------------------------------------+-----------------------------------------+
                                          | HTTP / SSE
+-----------------------------------------v-----------------------------------------+
|                                FastAPI Backend Server                             |
|  - REST API (/api/chat, /api/zones, /api/metrics, /api/simulation/control)        |
|  - Real-time Telemetry Broadcast Stream (/api/stream via SSE)                     |
|  - Closed-Loop Simulation Controller & Thread Coordinator                         |
+-------------------+-----------------------------------------+---------------------+
                    |                                         |
+-------------------v-------------------+ +-------------------v---------------------+
|      NLP Translation Engine (R2)      | |   Synchronized Dual-Twin Simulator (R3) |
|  - Strict Pydantic Constraint Schemas | |  - 3-Zone 3R2C Coupled Thermal ODEs     |
|  - Dual Engine: GenAI + Zero-Halluc.  | |  - RK4 Numerical Physics Solver         |
|    Deterministic Fallback Parser      | |  - ASHRAE 90.1 Industrial Baseline Twin |
|  - Dynamic Decay Constraint Bridge    | |  - Adaptive RL Energy Optimizer Twin    |
+---------------------------------------+ +-----------------------------------------+
```

### Module Boundaries & Data Flow
1. **`src/simulation/`**: Core multi-zone thermal physics, psychrometric moisture balance, weather generator, occupancy schedules, baseline thermostat controller, RL agent, and synchronized dual-twin runner.
2. **`src/nlp/`**: Pydantic schema validation, LLM translation engine (Gemini API), deterministic semantic fallback parser (offline/demo mode), and dynamic constraint lifecycle manager.
3. **`src/api/`**: FastAPI application, REST endpoints, SSE real-time telemetry streaming, and simulation coordinator.
4. **`src/ui/` or `static/`**: Standalone HTML5/CSS3/JavaScript dashboard, Chart.js visualizers, and chat interface.
5. **`tests/`**: Unit tests, 4-tier E2E testing suite, benchmark scripts, and adversarial stress tests.

---

## Feature Inventory

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Multi-Zone 3R2C Thermal Model | Lumped parameter ODE physics with wall capacitances, inter-zone heat transfer, and envelope resistance | M1 | survey |
| F2 | Environmental Dynamics & Weather Generator | Diurnal outdoor temperature variation, solar irradiance, and occupancy schedules | M1 | survey |
| F3 | Psychrometric & Humidity Dynamics | Moisture mass balance modeling zone relative humidity and HVAC latent load | M1 | survey |
| F4 | ASHRAE 90.1 Baseline Dual-Setpoint Controller | Industrial standard deadband bang-bang/proportional thermostat controller | M1 | survey |
| F5 | Deterministic Physics Solver & Telemetry Logger | RK4 numerical integrator with sub-stepping, state circular buffer, and serialization | M1 | survey |
| F6 | 100+ Episode Crash-Free Stability Benchmark | Deterministic execution stepping >=100 episodes (>28,800 timesteps) in <2s without NaN/crash | M1 | AC-3 |
| F7 | RL Agent & Observation/Action Space | Gym-compatible state/action interface with continuous/discrete setpoint delta adjustments | M2 | survey |
| F8 | Multi-Objective Reward Engine | 6-term reward function balancing TOU energy cost, kWh, comfort deadbands, and NLP tracking | M2 | survey |
| F9 | Synchronized Dual-Twin Comparative Runner | Simultaneous execution of Baseline vs RL twin under identical weather/occupancy/NLP disturbances | M2 | AC-4 |
| F10 | Energy & Comfort Comparative Telemetry | Real-time calculation of kW demand, cumulative kWh, cost savings %, and PMV comfort index | M2 | survey |
| F11 | Strict Pydantic Constraint Schemas | Zero-hallucination schemas (`ZoneConstraint`, `NLPTranslationResult`) with forbidden extra keys | M3 | AC-2 |
| F12 | Dual-Engine LLM Translation Pipeline | Generative AI translator with automatic fallback to deterministic semantic rule parser | M3 | R2 |
| F13 | 5+ Vague Complaint Canonical Test Suite | Verification against 5 distinct vague colloquial complaints with 100% structured validity | M3 | AC-2 |
| F14 | Dynamic NLP Constraint Bridge & Decay | Injection of translated constraints into simulator setpoints with exponential temporal decay | M3 | survey |
| F15 | FastAPI REST Endpoints | `/api/chat`, `/api/zones`, `/api/metrics`, `/api/simulation/control`, `/api/status` | M4 | AC-1 |
| F16 | Real-time SSE Telemetry Streaming | `/api/stream` Server-Sent Events broadcasting live 1Hz-10Hz simulation state to connected clients | M4 | R1 |
| F17 | Closed-Loop Event Coordinator | Thread-safe orchestration linking chat -> NLP translation -> simulator injection -> telemetry | M4 | AC-1 |
| F18 | Interactive Occupant Chat UI & Inspector | Chat interface in web dashboard displaying occupant dialogue and structured JSON translation | M5 | R1 |
| F19 | Multi-Zone Digital Twin Visualizer | Interactive zone cards with real-time temperature heatmaps, setpoints, and occupancy status | M5 | R1 |
| F20 | Real-time Comparative Performance Charts | Live Chart.js curves comparing Baseline vs RL power demand, energy savings %, and comfort | M5 | R1 |
| F21 | Simulation Control Deck & Weather Presets | Web UI controls for Start, Pause, Step, Reset, Speed, Weather presets, and disturbance triggers | M5 | R1 |
| F22 | E2E 4-Tier Test Suite & Runner | Opaque-box requirement-driven test harness covering Tiers 1-4 with 100% pass | M6 / E2E | Project Rule |
| F23 | Adversarial Coverage Hardening (Tier 5) | White-box stress-testing, extreme perturbation testing, and robust edge-case verification | M6 / Tier 5 | Project Rule |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Simulation Core & Physics Engine | Features F1, F2, F3, F4, F5, F6 (3-Zone 3R2C ODEs, RK4 solver, baseline controller, stability benchmark) | none | DONE |
| M2 | RL Optimizer & Synchronized Dual-Twin | Features F7, F8, F9, F10 (RL policy agent, multi-objective reward, synchronized dual-twin runner, telemetry) | M1 | IN_PROGRESS |
| M3 | NLP Translation Engine & Constraint Bridge | Features F11, F12, F13, F14 (Pydantic schemas, dual-engine LLM/fallback translator, dynamic decay bridge) | none | DONE |
| M4 | FastAPI Backend & Real-time Integration | Features F15, F16, F17 (FastAPI REST API, SSE streaming, closed-loop coordination, server entrypoint) | M2, M3 | PLANNED |
| M5 | Standalone Web Dashboard UI | Features F18, F19, F20, F21 (HTML5/CSS3/JS frontend, chat drawer, zone visualizer, Chart.js live plots, controls) | M4 | PLANNED |
| M6 | Final Verification & Adversarial Hardening | Features F22, F23 (100% E2E test pass across Tiers 1-4, Tier 5 adversarial hardening, forensic audit) | M5, E2E | PLANNED |
| E2E | E2E Testing Suite Track | Independent 4-tier opaque-box test infrastructure and comprehensive test cases published via TEST_READY.md | none | DONE |

---

## Interface Contracts

### 1. NLP Translation Schema (`src/nlp/schemas.py`)
```python
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field, ConfigDict

class ThermalIntent(str, Enum):
    TOO_COLD = "too_cold"
    TOO_WARM = "too_warm"
    TOO_HUMID = "too_humid"
    TOO_DRY = "too_dry"
    STUFFY = "stuffy"
    COMFORTABLE = "comfortable"

class UrgencyLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"

class ZoneConstraint(BaseModel):
    model_config = ConfigDict(extra="forbid")
    
    zone_id: str = Field(description="Target zone identifier: 'lobby', 'open_office', 'conference_room', or 'server_room'")
    intent: ThermalIntent = Field(description="Primary environmental discomfort intent")
    temperature_offset_c: float = Field(default=0.0, description="Desired temperature offset in Celsius (+/-)")
    humidity_offset_pct: float = Field(default=0.0, description="Desired relative humidity offset percentage (+/-)")
    target_temp_bounds_c: Optional[tuple[float, float]] = Field(default=None, description="Hard min/max temperature bounds in Celsius")
    urgency: UrgencyLevel = Field(default=UrgencyLevel.MEDIUM, description="Urgency priority of request")
    duration_minutes: int = Field(default=60, description="Active constraint duration before exponential decay")
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence score of translation")
    reasoning: str = Field(description="Brief explanation of the extracted parameters")

class NLPTranslationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    
    raw_query: str
    is_applicable: bool = Field(description="True if query is a valid environmental/comfort feedback")
    constraints: List[ZoneConstraint] = Field(default_factory=list)
    timestamp: float
```

### 2. Digital Twin State & Telemetry (`src/simulation/models.py`)
```python
from pydantic import BaseModel
from typing import Dict, List

class ZoneTelemetry(BaseModel):
    zone_id: str
    temperature_c: float
    target_setpoint_c: float
    humidity_pct: float
    occupancy_count: int
    hvac_power_kw: float
    comfort_violation_c: float
    active_nlp_offset_c: float

class StepTelemetry(BaseModel):
    step: int
    timestamp_sim_hour: float
    outdoor_temp_c: float
    outdoor_humidity_pct: float
    solar_irradiance_w_m2: float
    electricity_price_usd_kwh: float
    
    baseline_power_kw: float
    rl_power_kw: float
    power_saved_kw: float
    instantaneous_savings_pct: float
    
    cumulative_baseline_energy_kwh: float
    cumulative_rl_energy_kwh: float
    cumulative_savings_pct: float
    cumulative_cost_saved_usd: float
    
    baseline_comfort_violation_total: float
    rl_comfort_violation_total: float
    
    zones_baseline: Dict[str, ZoneTelemetry]
    zones_rl: Dict[str, ZoneTelemetry]
```

### 3. REST API Contract (`src/api/`)
- `POST /api/chat` -> Input: `{"message": str}` -> Output: `{"translation": NLPTranslationResult, "applied": bool}`
- `GET /api/zones` -> Output: `{"zones": List[str], "states": Dict[str, ZoneTelemetry]}`
- `GET /api/metrics` -> Output: `StepTelemetry` (current snapshot + recent history buffer)
- `POST /api/simulation/control` -> Input: `{"action": "start"|"pause"|"step"|"reset"|"set_speed", "speed": float}` -> Output: `{"status": str, "running": bool}`
- `GET /api/stream` -> Server-Sent Events (SSE) stream of `StepTelemetry` JSON at configurable broadcast rate.

---

## Code Layout

```
digital_twin_hvac/
├── PROJECT.md                      # Global architecture & milestone blueprint
├── ORIGINAL_REQUEST.md             # Immutable user requirements
├── TEST_INFRA.md                   # E2E test suite methodology & index
├── TEST_READY.md                   # E2E test suite completion signal
├── run_server.py                   # Main CLI launcher for FastAPI backend & dashboard
├── run_tests.py                    # Master test runner
├── requirements.txt                # Python dependencies
├── src/
│   ├── __init__.py
│   ├── config.py                   # Central configuration & parameters
│   ├── simulation/                 # Milestone 1 & 2
│   │   ├── __init__.py
│   │   ├── physics/
│   │   │   ├── __init__.py
│   │   │   ├── thermal_model.py    # 3R2C ODE network & RK4 solver
│   │   │   ├── psychrometrics.py   # Humidity & latent heat dynamics
│   │   │   └── weather.py          # Stochastic diurnal weather generator
│   │   ├── controllers/
│   │   │   ├── __init__.py
│   │   │   ├── baseline.py         # ASHRAE 90.1 dual-setpoint thermostat
│   │   │   └── rl_agent.py         # RL optimizer & reward engine
│   │   ├── environment.py          # Gymnasium-compatible HVAC environment
│   │   ├── dual_twin.py            # Synchronized Dual-Twin runner
│   │   └── telemetry.py            # State logging & circular buffer
│   ├── nlp/                        # Milestone 3
│   │   ├── __init__.py
│   │   ├── schemas.py              # Pydantic constraint models
│   │   ├── translator.py           # Dual-engine (Gemini + Deterministic fallback)
│   │   ├── fallback_parser.py      # Zero-hallucination semantic regex parser
│   │   └── constraint_bridge.py    # Dynamic setpoint decay manager
│   ├── api/                        # Milestone 4
│   │   ├── __init__.py
│   │   ├── server.py               # FastAPI application definition
│   │   ├── routes.py               # REST API endpoints
│   │   ├── sse.py                  # Server-Sent Events real-time broadcast
│   │   └── coordinator.py          # Closed-loop simulation coordinator
│   └── static/                     # Milestone 5
│       ├── index.html              # Modern responsive single-page dashboard
│       ├── css/
│       │   └── style.css           # Custom styles & Tailwind integration
│       └── js/
│           ├── app.js              # State management & SSE consumer
│           ├── charts.js           # Chart.js live comparative graphs
│           └── chat.js             # Occupant chat drawer & JSON inspector
└── tests/                          # E2E Testing Track & Unit Tests
    ├── __init__.py
    ├── test_thermal_physics.py     # Physics conservation & RK4 stability
    ├── test_baseline_and_rl.py     # Dual-twin execution & 100+ episode benchmark
    ├── test_nlp_engine.py          # 5+ canonical complaints & schema validity
    ├── test_fastapi_endpoints.py   # REST & SSE integration
    ├── test_e2e_closed_loop.py     # Full closed-loop feedback -> physics -> UI
    └── e2e_suite/                  # 4-tier comprehensive E2E test suite
        ├── test_tier1_features.py  # Tier 1: Feature isolation tests (>=5/feature)
        ├── test_tier2_boundaries.py# Tier 2: Boundary & corner cases (>=5/feature)
        ├── test_tier3_pairwise.py  # Tier 3: Cross-feature interactions
        └── test_tier4_scenarios.py # Tier 4: Real-world building workload scenarios
```
