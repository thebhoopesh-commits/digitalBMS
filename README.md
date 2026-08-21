# Digital BMS — AI-Driven Building Management System

> An autonomous, closed-loop Digital Twin that minimises HVAC energy consumption while maximising human comfort — powered by Reinforcement Learning, Gemini LLM, and a real-time 3D interface.

---

## Overview

**Digital BMS** is a full-stack prototype that simulates a 3-zone commercial office building and uses an AI pipeline to dynamically optimise its HVAC system. Occupants can submit natural-language comfort feedback (e.g. *"It's freezing in the open office"*), which the system semantically interprets and translates into physical HVAC adjustments — all without human intervention.

The project won a prize at the **CDT AI Applications Hackathon** and demonstrates how Generative AI, Reinforcement Learning, and physics-based simulation can be combined into a single coherent control loop.

---

## Architecture

```
Occupant Text
     │
     ▼
┌─────────────────────────────────────────────────────────┐
│                  Layer 1 – NLP Preprocessor             │
│   Text sanitisation, zone entity resolution ([ZONE:X])  │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Layer 2 – LLM Translator                   │
│  Gemini API → ComfortEvent (intent, severity, zone)     │
│  Automatic fallback to DeterministicFallbackParser      │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│         Layer 3 – Deterministic Constraint Bridge       │
│  ComfortEvent → BoundedPreference (temperature offset)  │
│  Dynamic decay, anti-thrashing cooldown, severity scale │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Layer 4 – Safety Shield                    │
│  Hard bounds enforcement, rate-of-change limits,        │
│  actuator saturation clipping                           │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│          Dual-Twin Simulation (DualTwinRunner)          │
│  Twin A: ASHRAE 90.1 Baseline Controller                │
│  Twin B: Fast Tabular RL Agent (Q-learning)             │
│  3R-2C per-zone thermal physics model                   │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│        FastAPI Backend + SSE Telemetry Stream           │
│  REST API · Server-Sent Events · Pydantic schemas       │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│          Real-Time 3D Dashboard (Vite + Three.js)       │
│  First-person walkthrough · Zone HUD overlays           │
│  Occupant AI Chat panel · Spatial Radar                 │
└─────────────────────────────────────────────────────────┘
```

---

## Key Features

| Feature | Description |
|---|---|
| **Semantic NLP** | Gemini LLM extracts `intent`, `severity`, and `zone` — never raw offsets |
| **Deterministic Fallback** | Zero-dependency regex parser guarantees 100% uptime if LLM is unavailable |
| **Constraint Bridge** | Maps semantic events → bounded physical preferences with temporal decay |
| **Safety Shield** | Hard-clips any RL or NLP action that would violate physical or safety bounds |
| **Dual-Twin Comparison** | Baseline vs RL agent run in parallel — energy savings tracked in real-time |
| **3D Immersive UI** | First-person 3D office with zone HUD panels, NPC occupants, and chat AI |
| **SSE Streaming** | Live telemetry pushed to the frontend via Server-Sent Events |

---

## Project Structure

```
digitalBMS/
├── src/
│   ├── api/
│   │   ├── server.py          # FastAPI app factory
│   │   ├── routes.py          # REST endpoints (/chat, /metrics, /stream, /zones)
│   │   ├── coordinator.py     # Thread-safe sim ↔ async bridge
│   │   └── sse.py             # Server-Sent Events generator
│   │
│   ├── nlp/
│   │   ├── schemas.py         # ComfortEvent, SemanticTranslationResult (Pydantic)
│   │   ├── translator.py      # Gemini LLM engine + retry/fallback logic
│   │   ├── fallback_parser.py # Deterministic regex-based fallback parser
│   │   ├── constraint_bridge.py # ComfortEvent → BoundedPreference mapper
│   │   └── preprocessor.py   # Text sanitisation + zone entity resolution
│   │
│   ├── simulation/
│   │   ├── dual_twin.py       # Dual-twin runner (Baseline + RL)
│   │   ├── safety_shield.py   # Safety layer: hard bounds + rate limiting
│   │   ├── telemetry.py       # StepTelemetry schema + circular buffer
│   │   ├── environment.py     # Physics environment wrapper
│   │   ├── physics/           # 3R-2C thermal model, psychrometrics, weather
│   │   └── controllers/       # ASHRAE Baseline + Fast Tabular RL policy
│   │
│   └── config.py              # BuildingConfig, ZoneConfig, SimulationConfig
│
├── 3d website/                # Vite + Three.js real-time 3D dashboard
│   ├── src/
│   │   ├── main.ts            # Scene bootstrap and animation loop
│   │   ├── scene/             # Office floorplan, materials, NPC manager
│   │   ├── hud/               # Zone HUD canvas overlays
│   │   ├── interaction/       # Chat AI panel, interactive props
│   │   ├── data/              # HVACDataStore (SSE consumer + smooth values)
│   │   └── navigation/        # First-person camera + spatial radar
│   └── index.html
│
└── tests/                     # pytest test suite
    ├── test_enhanced_rules.py         # Semantic extraction + safety shield tests
    ├── test_thermal_physics.py        # 3R-2C thermal model validation
    ├── test_challenger_stress.py      # Stress tests for RL agent
    └── test_m1_challenger_physics_stress.py
```

---

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- A [Google Gemini API key](https://aistudio.google.com/app/apikey) *(optional — system falls back gracefully)*

### Backend Setup

```bash
# 1. Clone the repo
git clone https://github.com/thebhoopesh-commits/digitalBMS.git
cd digitalBMS

# 2. Create and activate a virtual environment
python -m venv venv
venv\Scripts\activate       # Windows
# source venv/bin/activate  # macOS/Linux

# 3. Install dependencies
pip install -r requirements.txt

# 4. Set your API key (optional)
# Create a .env file:
echo GEMINI_API_KEY=your_key_here > .env

# 5. Start the backend
python -m uvicorn src.api.server:app --port 8000 --reload
```

### Frontend Setup

```bash
cd "3d website"
npm install
npm run dev
# Opens at http://localhost:3000
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/status` | System health, sim state, LLM active flag |
| `POST` | `/api/chat` | Submit occupant feedback (NLP translation + constraint injection) |
| `GET` | `/api/zones` | Current zone states (temperature, humidity, setpoint, occupancy) |
| `GET` | `/api/metrics` | Energy comparison metrics (Baseline vs RL) + history |
| `GET` | `/api/stream` | SSE real-time telemetry stream |
| `POST` | `/api/simulation/control` | `start` / `pause` / `reset` / `step` / `set_speed` |

### Example Chat Request

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "It is freezing in the open office!", "history": []}'
```

```json
{
  "is_applicable": true,
  "applied": true,
  "response_text": "I have logged your request that the open office feels too cold.",
  "translation": {
    "events": [{
      "zone_id": "open_office",
      "intent": "too_cold",
      "severity": "high",
      "confidence": 0.95
    }]
  }
}
```

---

## NLP Pipeline

The NLP system is a **4-layer pipeline** designed to be reliable, explainable, and hallucination-free:

1. **Preprocessor** — Strips PII, resolves zone synonyms (*"lobby"*, *"reception"*, *"foyer"* → `lobby`)
2. **LLM Translator** — Calls Gemini to extract semantic `ComfortEvent` JSON *(intent only, no physical values)*
3. **Fallback Parser** — Deterministic regex engine with comprehensive keyword lexicons — always produces a valid result
4. **Constraint Bridge** — Maps `ComfortEvent` → `BoundedPreference` with severity scaling, temporal decay, and anti-thrashing cooldown

**Supported intents:** `too_cold` · `too_warm` · `too_humid` · `too_dry` · `stuffy` · `drafty` · `comfortable`

**Supported zones:** `lobby` · `open_office` · `conference_room` · `server_room`

---

## Simulation

The building is modelled as a **3-zone commercial office** with a per-zone **3R-2C (3-resistance, 2-capacitance) thermal network**:

- Envelope heat transfer (wall conduction + infiltration)
- Solar gain through glazing (SHGC-weighted)
- Internal loads (occupants + equipment)
- Inter-zone heat exchange

Two controllers run in parallel for direct comparison:

| Controller | Description |
|---|---|
| **ASHRAE Baseline** | Proportional dead-band controller per ASHRAE 90.1 |
| **RL Agent** | Fast tabular Q-learning with NLP-modulated state space |

---

## Running Tests

```bash
pytest tests/ -v
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python · FastAPI · Uvicorn · Pydantic |
| AI / NLP | Google Gemini API · Custom regex fallback parser |
| Simulation | NumPy · Custom 3R-2C thermal physics |
| Frontend | TypeScript · Three.js · Vite · WebGL |
| Streaming | Server-Sent Events (SSE) |
| Testing | pytest |

---

## License

MIT
