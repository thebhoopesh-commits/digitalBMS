# Digital BMS — System Architecture Specification

## 1. Overview & High-Level System Topology

The **AI-Driven Cognitive Digital Twin (CDT) Building Management System (BMS)** is a real-time, closed-loop cyber-physical platform designed to minimize commercial building HVAC energy consumption while dynamically maintaining occupant thermal comfort. 

The architecture bridges continuous multi-zone physical simulations, reinforcement learning controllers, natural language understanding, real-world meteorological forecasts, and interactive 3D/2D spatial interfaces.

```
+-----------------------------------------------------------------------------------------------+
|                                    PRESENTATION LAYER                                         |
|  +----------------------------------------------------+ +----------------------------------+  |
|  |     3D WebGL Digital Twin (Vite / Three.js)        | |  2D Global Dashboard             |  |
|  | - Spatial multi-zone floorplan & emissive HUDs     | | - Multi-zone grid telemetry      |  |
|  | - SunCalc real-world astronomical sun tracking     | | - KPI energy savings monitor     |  |
|  | - Occupant feedback chat drawer & time override    | | - Direct simulation control UI   |  |
|  +----------------------------------------------------+ +----------------------------------+  |
+-----------------------------------------------+-----------------------------------------------+
                                                | HTTP REST / SSE Stream (/api/stream)
+-----------------------------------------------v-----------------------------------------------+
|                                 COORDINATOR & API LAYER (FastAPI)                             |
|  - REST Endpoints: /api/chat, /api/zones, /api/metrics, /api/simulation/control, /api/status  |
|  - Server-Sent Events (SSE) Broadcast Engine with async thread-safe telemetry queue           |
|  - Circular ring buffer for rolling historical telemetry and safety override event logs       |
+----------------------+--------------------------------------------------+---------------------+
                       |                                                  |
+----------------------v------------------------+ +-----------------------v---------------------+
|      NLP & AURA RULE CONSTRAINT BRIDGE        | |     SYNCHRONIZED DUAL-TWIN PHYSICS ENGINE   |
|  - Layer 1: Semantic ComfortEvent Extraction  | |  - State-Space 3R2C Coupled Thermal Network  |
|  - Layer 2: Deterministic Constraint Mapping  | |  - Psychrometric Moisture Mass Balance      |
|  - Layer 3: Tripartite Dynamic Decay w(t)     | |  - 4th-Order Runge-Kutta (RK4) Solver       |
|  - Layer 4: Non-Bypassable Safety Shield      | |  - ASHRAE 90.1 Baseline Thermostat Twin     |
|                                               | |  - Adaptive Tabular Q-Learning RL Twin      |
|                                               | |  - Open-Meteo Real-Time Weather Integration |
+-----------------------------------------------+ +---------------------------------------------+
```

---

## 2. The 4-Layer Aura Rule System

To prevent large language model hallucinations from directly perturbing physical actuators, the platform implements the **Aura Rule System**—a strict 4-layer cyber-physical separation of concerns.

```
 Occupant Feedback ("It's freezing in the lobby")
                    |
                    v
 +-----------------------------------------------------+
 | Layer 1: Semantic Extraction (translator.py)        |  --> Strict Pydantic ComfortEvent (No physical offsets)
 +-----------------------------------------------------+
                    |
                    v
 +-----------------------------------------------------+
 | Layer 2: Deterministic Mapping (constraint_bridge.py)|  --> Bounded physical preference (ΔT, ΔRH, w0)
 +-----------------------------------------------------+
                    |
                    v
 +-----------------------------------------------------+
 | Layer 3: Dynamic Decay w(t) (constraint_bridge.py)  |  --> w(t) = w0 · φ_temp(t) · ψ_sensor(t) · γ_cooldown(t)
 +-----------------------------------------------------+
                    |
                    v
 +-----------------------------------------------------+
 | Layer 4: Safety Shield Authorization Layer          |  --> Slew rate limiter, hard bounds [16°C, 28°C],
 |          (safety_shield.py)                         |      reversal blocker, actuator saturation clip
 +-----------------------------------------------------+
                    |
                    v
            Physics Simulation
```

### Layer 1: Semantic LLM Extraction & Validation
* **Data Contracts (`src/nlp/schemas.py`)**: Defines strict Pydantic models (`ComfortEvent`, `ComfortIntent`, `SeverityLevel`, `SuspectedCause`) configured with `extra="forbid"`.
* **Zero Numerical Hallucination**: The LLM prompt extracts only semantic attributes (`too_cold`, `high_occupancy`, `high` severity) without numerical degree offsets.
* **Deterministic Fallback Regex Parser (`src/nlp/fallback_parser.py`)**: If the OpenAI/Gemini SDK times out or is unreachable, a zero-failure regex parser parses standard intent phrases into valid `ComfortEvent`s.

### Layer 2: Deterministic Constraint Mapping
* **Fixed Transformation Matrix (`src/nlp/constraint_bridge.py`)**: Maps `(ComfortIntent, SeverityLevel)` pairs to bounded physical setpoint offsets ($\Delta T \in [-3.0^\circ\text{C}, +3.0^\circ\text{C}]$, $\Delta RH \in [-15\%, +15\%]$) and base weights $w_0 \in [0.4, 1.0]$.

### Layer 3: Tripartite Dynamic Weight Decay
The constraint weight $w(t)$ decays dynamically rather than linearly, combining temporal decay, closed-loop sensor error feedback, and anti-thrashing cooldowns:

$$w(t) = w_0 \cdot \phi_{temp}(t) \cdot \psi_{sensor}(t) \cdot \gamma_{cooldown}(t)$$

1. **Temporal Decay $\phi_{temp}(t)$**: Constant plateau followed by exponential half-life decay.
2. **Sensor Feedback Modulation $\psi_{sensor}(t)$**: Accelerates decay as the measured zone temperature reaches the requested comfort target.
3. **Anti-Thrashing Cooldown $\gamma_{cooldown}(t)$**: Applies a 15-minute refractory period to suppress rapid oscillating complaints from the same zone.

### Layer 4: Safety Shield Authorization Layer (`src/simulation/safety_shield.py`)
A non-bypassable supervisory gate between controllers (Baseline/RL) and the simulation physics:
* **Hard Setpoint Bounds**: Clamps standard zones to $[16.0^\circ\text{C}, 28.0^\circ\text{C}]$ and server rooms to $[15.0^\circ\text{C}, 24.0^\circ\text{C}]$.
* **Slew Rate Limiting**: Caps setpoint changes at $\le 1.0^\circ\text{C}/\text{min}$ ($2.0^\circ\text{C}$ per discrete simulation step).
* **Thermal Shock / Rapid Reversal Blocker**: Prevents sudden switching between full cooling and full heating.
* **Actuator Saturation Clipping**: Enforces $\dot{Q}_{hvac} \in [-\dot{Q}_{cool,max}, +\dot{Q}_{heat,max}]$.
* **Forensic Audit Logging**: Records all intercepted and clamped actions in telemetry flags.

---

## 3. Synchronized Dual-Twin Physics Engine

The simulation engine runs two synchronized building models in parallel to benchmark performance in real-time:
1. **ASHRAE 90.1 Baseline Twin**: Standard industrial deadband thermostat controller.
2. **Adaptive RL Twin**: Tabular Q-learning agent optimizing energy consumption, peak demand charges, and occupant comfort penalties.

```
                           +----------------------------------------+
                           |       Weather & Tariff Generator       |
                           |   (Open-Meteo Live API / Presets)      |
                           +-------------------+--------------------+
                                               |
                       +-----------------------+-----------------------+
                       |                                               |
+----------------------v-----------------------+ +---------------------v-----------------------+
|             BASELINE TWIN                    | |                  RL TWIN                    |
| - ASHRAE 90.1 Rule-Based Deadband Control    | | - Tabular Q-Learning Agent                  |
| - 3R2C Coupled Thermal ODE State-Space Model | | - Reward: - (Energy Cost + Comfort Penalty) |
| - Psychrometric Moisture Balance             | | - Dynamically Ingests Aura Rule Constraints |
| - RK4 Integration (dt = 120s)                | | - Non-Bypassable Safety Shield Gate         |
+----------------------+-----------------------+ +---------------------+-----------------------+
                       |                                               |
                       +-----------------------+-----------------------+
                                               |
                                   +-----------v-----------+
                                   | Comparative Telemetry |
                                   | - Energy Saved (%)    |
                                   | - Cost Delta ($)      |
                                   | - PPD / PMV Comfort   |
                                   +-----------------------+
```

### Multi-Zone 3R2C Lumped-Parameter Thermal Network
Each zone $i$ (Lobby, Open Office, Conference Room, Server Room) tracks indoor air temperature $T_{z,i}$ and wall envelope temperature $T_{w,i}$ governed by coupled differential equations:

$$C_{z,i} \frac{dT_{z,i}}{dt} = \frac{T_{w,i} - T_{z,i}}{R_{w,i}} + \frac{T_{amb} - T_{z,i}}{R_{inf,i}} + \sum_{j \in \mathcal{N}(i)} \frac{T_{z,j} - T_{z,i}}{R_{inter,i,j}} + \dot{Q}_{sol,z,i} + \dot{Q}_{int,i} + \dot{Q}_{hvac,i}$$

$$C_{w,i} \frac{dT_{w,i}}{dt} = \frac{T_{amb} - T_{w,i}}{R_{amb,i}} + \frac{T_{z,i} - T_{w,i}}{R_{w,i}} + \dot{Q}_{sol,w,i}$$

### Psychrometric Moisture Balance
Zone humidity ratio $W_{z,i}$ ($\text{kg}_{w}/\text{kg}_{da}$) is modeled alongside temperature:

$$V_i \rho_{air} \frac{dW_{z,i}}{dt} = \dot{m}_{inf,i}(W_{amb} - W_{z,i}) + \dot{m}_{occ,i} - \dot{m}_{dehum,i}$$

### Real-World Weather API (`src/simulation/physics/weather.py`)
* Integrated with the keyless **Open-Meteo API**.
* When `WeatherPreset.REAL_TIME` is active, the simulation pulls down a 48-hour live forecast for the exact geographic coordinates (Latitude: `12.9184`, Longitude: `79.1325`) and interpolates dry-bulb temperature, relative humidity, and direct normal solar irradiance ($\text{W}/\text{m}^2$) to the current simulation time step.

---

## 4. Frontend Architecture & Real-Time Rendering

### 3D WebGL Digital Twin (`3d website/src/`)
Built with **Vite**, **TypeScript**, and **Three.js**:
* **Scene Graph (`SceneManager.ts`, `OfficeFloorplan.ts`)**: Procedurally constructed corporate facility featuring perimeter curtain walls, executive conference rooms, structural columns, and interactive assets.
* **Astronomical Solar Tracking (`LightingManager.ts`)**: Utilizes `suncalc` to calculate the exact azimuth and altitude of the sun in real time based on simulation hour and latitude/longitude, casting dynamic directional shadows across the interior floor.
* **Dynamic HUD Glassboards (`GlassBoard.ts`)**: Emissive in-scene displays projected on office glass partitions rendering live zone telemetry (temperature, humidity, HVAC state, power).
* **Navigation Subsystem (`NavigationManager.ts`)**: Dual-mode First-Person (WASD + mouse look with AABB collision resolution) and Smooth Orbit Controls.
* **Procedural Audio Engine (`AudioManager.ts`)**: Synthesized spatial footsteps (carpet, wood, metal), HVAC hum, door sliders, and UI interactions.
* **Testing Sim Window (`time-drawer`)**: Independent floating UI window with frosted glass backdrop filter allowing manual time override for solar physics inspection.

### 2D Global Control Dashboard (`3d website/dashboard.html`, `dashboard.ts`)
* Standalone lightweight interface consuming `/api/stream` SSE events.
* Provides real-time KPI telemetry (total energy saved %, cost savings, instantaneous power load) across all zones, paired with global simulation controls (Speed, Pause/Resume, Weather Preset selection).

---

## 5. Codebase Directory Structure

```
digitalTwin/
├── 3d website/                     # Three.js / TypeScript Frontend
│   ├── index.html                  # 3D WebGL Digital Twin viewport & HUD
│   ├── dashboard.html              # Dedicated 2D multi-zone dashboard
│   ├── package.json                # Dependencies (three, suncalc, etc.)
│   └── src/
│       ├── main.ts                 # Application bootstrap & lifecycle loop
│       ├── dashboard.ts            # 2D Dashboard SSE subscriber & control UI
│       ├── types/                  # TypeScript interface contracts
│       ├── scene/                  # Three.js scene, floorplan, lighting & NPCs
│       ├── navigation/             # First-person & orbit navigation controllers
│       ├── interaction/            # Raycasting, interactable props & chat drawer
│       ├── hud/                    # Glassboard HUDs, minimap, alerts
│       ├── audio/                  # Web Audio API procedural sound synthesizer
│       └── data/                   # HVACDataStore & SSE stream consumer
├── docs/                           # Documentation & Technical Reports
│   └── project_report.md           # Formal CDT engineering report
├── src/                            # Python Backend & Simulation Engine
│   ├── config.py                   # Global constants, zone geometry, weather presets
│   ├── api/
│   │   ├── app.py                  # FastAPI application & route definitions
│   │   ├── coordinator.py          # DualTwin coordinator & telemetry broadcaster
│   │   └── sse.py                  # Server-Sent Events streaming handler
│   ├── nlp/
│   │   ├── schemas.py              # Pydantic models (ComfortEvent, BoundedPreference)
│   │   ├── translator.py           # OpenAI/Gemini SDK translation client
│   │   ├── fallback_parser.py      # Deterministic zero-failure regex fallback parser
│   │   └── constraint_bridge.py    # Deterministic mapper, dynamic decay & cooldown
│   └── simulation/
│       ├── environment.py          # Gymnasium simulation environment wrapper
│       ├── dual_twin.py            # Synchronized Baseline vs. RL simulation runner
│       ├── safety_shield.py        # Non-bypassable safety authorization gate
│       ├── telemetry.py            # Telemetry models & safety override logging
│       ├── controllers/
│       │   ├── baseline.py         # ASHRAE 90.1 rule-based thermostat controller
│       │   └── rl_agent.py         # Tabular Q-learning HVAC optimizer
│       └── physics/
│           ├── building.py         # 3R2C multi-zone thermal network & RK4 solver
│           ├── psychrometrics.py   # Humidity ratio & moisture mass balance
│           └── weather.py          # Open-Meteo live API client & weather generator
├── tests/                          # Automated Testing Suites
│   ├── test_enhanced_rules.py      # Aura rule verification (R1, R2, R3)
│   └── test_api.py                 # REST & SSE endpoint unit tests
├── architecture.md                 # System architecture specification (this file)
├── project.md                      # Milestone & interface specification
├── requirements.txt                # Python backend dependencies
└── README.md                       # Project summary & run instructions
```

---

## 6. Communication Protocols & Interface Contracts

### Telemetry SSE Stream (`GET /api/stream`)
The FastAPI coordinator broadcasts telemetry at regular intervals (default 2 Hz) with the payload schema:
```json
{
  "timestamp_sim_hour": 14.25,
  "sim_speed": 1.0,
  "weather": {
    "outdoor_temp_c": 31.4,
    "outdoor_rh_pct": 62.0,
    "solar_irradiance_w_m2": 780.0,
    "electricity_price_kwh": 0.18
  },
  "zones": {
    "lobby": {
      "temperature_c": 23.1,
      "humidity_pct": 52.4,
      "occupancy": 8,
      "hvac_power_w": 3450.0,
      "active_setpoint_c": 22.5,
      "comfort_pmv": -0.15
    }
  },
  "comparative": {
    "baseline_energy_kwh": 142.8,
    "rl_energy_kwh": 118.2,
    "energy_saved_pct": 17.22,
    "cost_savings_usd": 4.43
  },
  "safety_events": []
}
```

### Occupant Feedback Endpoint (`POST /api/chat`)
Accepts natural language comfort input and routes it through the Aura Rule System:
* **Request**: `{"message": "It is way too cold in the open office area", "zone_id": "open_office"}`
* **Response**:
```json
{
  "reply": "I've noted that it's too cold in the Open Office. Adjusting target temperature slightly upward.",
  "event": {
    "event_id": "evt_9b83a12",
    "zone_id": "open_office",
    "intent": "too_cold",
    "severity": "high",
    "suspected_cause": "unspecified",
    "confidence": 0.95
  },
  "active_offsets": {
    "open_office": { "temp_offset_c": 1.5, "weight": 0.8 }
  }
}
```
