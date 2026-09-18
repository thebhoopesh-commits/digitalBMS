# Digital BMS — AI-Driven Cognitive Digital Twin

> **An autonomous, closed-loop Building Management System (BMS) Digital Twin that minimizes HVAC energy consumption while maximizing occupant comfort — powered by Reinforcement Learning, Local Edge AI (Raspberry Pi 4), and an interactive 3D WebGL interface.**

---

## Overview

**Digital BMS** is a full-stack, cyber-physical building optimization platform that couples high-fidelity thermodynamics with modern AI and interactive 3D visualization. Occupants submit unstructured natural-language feedback (e.g., *"It's freezing in the open office"* or *"The conference room feels stuffy"*), which the system translates into structured semantic constraints (`ComfortEvent`). 

These semantic constraints are deterministically validated by a **Safety Shield** and fed into a **Closed-Loop Reinforcement Learning (RL) Engine** that dynamically balances energy expenditure against human comfort in real-time.

### What's New in Recent Updates:
- 🍓 **Local Edge AI on Raspberry Pi 4**: 100% private, zero-cloud-dependency inference using Ollama (`qwen3:1.7b` / `gemma3:1b`) with prompt-prefix caching, sub-second time-to-first-token (TTFT), and `/no_think` artifact scrubbing.
- 🏢 **Multi-Environment 3D Simulation**: Real-time switching between **Corporate Office** (Lobby, Open Office, Conference Room, Server Room) and **Healthcare / Hospital** (Lobby, Clinical Areas, Staff Areas, Support HVAC) with dynamic collision meshes and spatial radar.
- 🤖 **Interactive 3D Mascot & EmotionEngine**: 13 Luma 3D GLB reactions dynamically mirroring real-time building state and occupant feedback (idle, thinking, freezing, overheating, alert, celebration).
- 📊 **Operations View HUD**: Fullscreen Glassmorphism facilities management console (toggle with `X`) with real-time zone telemetry, setpoint sliders, and energy comparisons.
- ⚡ **Hardware-in-the-Loop (HITL)**: ESP32 HTTP/MQTT sensor ingestion with automated fallback to simulated twin states.
- 🚀 **Greeting & Telemetry Fast-Paths**: Sub-15ms instantaneous responses for common greetings and real-time zone metric queries.

---

## System Architecture

```
                                  OCCUPANT FEEDBACK
              (3D In-World Chatbot / 2D Operator Dashboard / Voice)
                                          │
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 1: EDGE AI SEMANTIC EXTRACTION (Local Ollama on Raspberry Pi 4)           │
│  • Endpoint: http://10.100.177.51:11434 (qwen3:1.7b @ 4-bit GGUF)                │
│  • Fast-Path Router: Instant responses for greetings & live telemetry reads     │
│  • Live Grounding Block: Injects real-time twin state without hallucination      │
│  • Fallback: Deterministic Regex Parser (100% uptime guaranteed)                │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │  ComfortEvent (Intent, Severity, Cause)
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 2: CONSTRAINT BRIDGE & DECAY ENGINE                                       │
│  • Semantic Intent → Bounded Physical Setpoint Offsets (ΔT, ΔRH)                 │
│  • Dynamic Preference Decay w(t) modulated by sensor evidence and cooldown      │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │  Proposed Setpoints
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 3: DETERMINISTIC SAFETY SHIELD                                            │
│  • ASHRAE 55 / ISO 7730 Comfort Boundaries (19.0°C – 26.0°C)                    │
│  • Slew-Rate Limiting: Prevents rapid actuator cycling & thermal shock          │
│  • Actuator Saturation & Equipment Protection Clipping                          │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │  Authorized Setpoints
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 4: DUAL-TWIN SIMULATION & RL CONTROLLER (DualTwinRunner)                 │
│  • Twin A (Baseline): ASHRAE 90.1 proportional dead-band controller             │
│  • Twin B (RL Agent): Tabular Q-learning optimizer (Comfort vs kWh reward)       │
│  • Physics Model: 3R-2C per-zone thermal network (solar, envelope, internal)    │
│  • Hardware Integration: Live ESP32 telemetry (SensorManager)                   │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │  Live SSE Telemetry Stream (/api/stream)
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  LAYER 5: DUAL-INTERFACE PRESENTATION                                            │
│  ┌────────────────────────────────────────┐ ┌──────────────────────────────────┐ │
│  │ 3D Digital Twin (Three.js + WebGL)     │ │ Operations View HUD Overlay      │ │
│  │ • Multi-Environment (Office/Hospital)  │ │ • Zone Telemetry Cards & Sliders │ │
│  │ • 13-Reaction Animated 3D Mascot       │ │ • Live kWh & Cost Analytics      │ │
│  │ • First-Person Nav & Spatial Minimap   │ │ • Comfort Compliance Radar       │ │
│  └────────────────────────────────────────┘ └──────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Features

### 1. Local Edge AI with Raspberry Pi 4
- **Private & Local**: Runs on-premise on Raspberry Pi 4 hardware (ARM Cortex-A72, 4GB/8GB RAM).
- **Ollama REST API**: Communicates via `http://10.100.177.51:11434` running quantized `qwen3:1.7b`.
- **Low Latency SSE Streaming**: Generates real-time conversational chunks directly into the UI with sub-second time-to-first-token.
- **Reasoning Suppression (`"think": False`)**: Suppresses internal chain-of-thought tokens, eliminating 30+ seconds of unnecessary token generation on CPU.
- **Zero-Cloud Fallback**: Includes `DeterministicFallbackParser` and `MockBackend` to ensure complete functionality even if the edge device is offline.

### 2. Dual-Environment 3D Simulation
- **Corporate Office**: Lobby, Open Office, Conference Room, Server Room.
- **Healthcare Facility**: Hospital Lobby, Clinical Areas, Staff Areas, Support HVAC.
- **Dynamic Scene Management**: `EnvironmentManager` dynamically transitions models, lighting, collision bounds, and zone telemetry meshes without page reload.
- **Navigation & Minimap**: First-person controls (`WASD` + Mouse Pointer Lock) with real-time zone heatmaps and collision detection.

### 3. Animated 3D Mascot & EmotionEngine
- Powered by 13 bespoke Luma 3D `.glb` character animations.
- The `EmotionEngine` evaluates building state and occupant interactions, smoothly transitioning the mascot between emotional states:
  - `idle`, `happy`, `thinking`, `alert`, `celebration`
  - `freezing` (room undercooled), `overheating` (room overheated), `stuffy`
  - Reacts immediately to occupant feedback submitted in the chat panel.

### 4. Operations View HUD (Hotkey `X`)
- Fullscreen semi-transparent operations dashboard accessible directly from the 3D twin.
- Real-time temperature, humidity, setpoint, and occupancy metrics per zone.
- Manual setpoint override sliders with instant safety-shield clipping feedback.
- Energy comparison graphs (Baseline vs. RL Agent) and ASHRAE comfort index gauges.

### 5. Reinforcement Learning vs. ASHRAE Baseline
- Runs dual simulation twins concurrently:
  - **Baseline Controller**: Fixed dead-band controller strictly following ASHRAE Standard 90.1.
  - **RL Controller**: Tabular Q-Learning agent rewarded for energy conservation and penalized for occupant discomfort.
- Real-time telemetry exposes cumulative kWh consumed, peak load, and percentage energy saved.

---

## Project Structure

```
digitalBMS/
├── src/
│   ├── api/
│   │   ├── server.py              # FastAPI server entrypoint & static mounting
│   │   ├── routes.py              # REST endpoints & SSE streaming handlers
│   │   ├── coordinator.py         # Thread-safe simulation coordinator
│   │   └── sse.py                 # Server-Sent Events generator
│   │
│   ├── hardware/                  # Hardware-in-the-Loop (HITL) subsystem
│   │   ├── sensor_manager.py      # Telemetry cache & validation
│   │   ├── telemetry_tools.py     # Deterministic sensor lookup tools
│   │   ├── esp32_http.py          # ESP32 polling & push ingestion
│   │   ├── mqtt_client.py         # MQTT sensor subscriber
│   │   └── models.py              # SensorSnapshot & Metric schemas
│   │
│   ├── nlp/                       # NLP & Edge AI Translation Pipeline
│   │   ├── local_translator.py    # Ollama REST, LlamaCpp & Mock backend adapters
│   │   ├── translator.py          # Semantic translation dispatcher
│   │   ├── schemas.py             # Pydantic schemas (ComfortEvent, Intent, Severity)
│   │   ├── fallback_parser.py     # Deterministic regex fallback parser
│   │   ├── constraint_bridge.py   # Semantic event to physical constraint mapper
│   │   └── preprocessor.py        # Entity extraction & zone normalization
│   │
│   ├── simulation/                # Thermodynamics & Control Simulation
│   │   ├── dual_twin.py           # Dual simulation runner (Baseline vs RL)
│   │   ├── safety_shield.py       # Hard bounds, rate limiting, and clipping
│   │   ├── environment.py         # Gym-compatible building environment
│   │   ├── telemetry.py           # Telemetry metrics buffer & aggregator
│   │   ├── controllers/           # Baseline and Tabular Q-Learning policies
│   │   └── physics/               # 3R-2C thermal model & psychrometric math
│   │
│   └── ui/                        # 2D Operator Dashboard static assets
│       ├── index.html
│       ├── app.js
│       └── styles.css
│
├── 3d website/                    # Vite + Three.js 3D Digital Twin
│   ├── index.html                 # 3D viewport entrypoint & HUD layout
│   ├── src/
│   │   ├── main.ts                # Application bootstrap & render loop
│   │   ├── scene/
│   │   │   ├── EnvironmentManager.ts # Corporate vs Healthcare scene switching
│   │   │   ├── MascotManager.ts   # 13-state 3D animated character controller
│   │   │   ├── NPCManager.ts      # Animated occupants & paths
│   │   │   ├── corporate/         # Corporate office floorplan & assets
│   │   │   └── healthcare/        # Hospital & clinical zone floorplan
│   │   ├── hud/
│   │   │   ├── OperationsView.ts  # Fullscreen facility management HUD
│   │   │   ├── operations_view.css # Glassmorphism styling
│   │   │   ├── Minimap.ts         # Spatial radar & zone heatmap
│   │   │   └── GlassBoard.ts      # Floating in-world telemetry canvases
│   │   ├── data/
│   │   │   └── HVACDataStore.ts   # SSE consumer with state interpolation
│   │   ├── navigation/
│   │   │   ├── NavigationManager.ts # FPS camera controls
│   │   │   └── CollisionEngine.ts # Raycast dynamic collision detection
│   │   └── interaction/
│   │       ├── ChatManager.ts     # In-world occupant chat interface
│   │       └── DynamicScreens.ts  # In-world interactive video/data screens
│   └── vite.config.ts
│
├── tests/                         # Comprehensive pytest test suite
│   ├── test_local_translator_mock.py # Ollama & parsing tests (65+ cases)
│   ├── test_enhanced_rules.py        # Semantic mapping & safety shield tests
│   ├── test_thermal_physics.py       # 3R-2C physics validation
│   └── test_challenger_stress.py     # System stress tests
│
├── requirements.txt               # Python backend dependencies
└── README.md
```

---

## Quickstart Guide

### Prerequisites
- **Python**: 3.10, 3.11, or 3.12
- **Node.js**: 18.x or 20.x with `npm`
- **Raspberry Pi 4 / Ollama** (Optional): If running edge AI on a physical Pi, install Ollama and pull `qwen3:1.7b`:
  ```bash
  ollama pull qwen3:1.7b
  ```

---

### 1. Backend Setup

```bash
# Clone the repository
git clone https://github.com/thebhoopesh-commits/digitalBMS.git
cd digitalBMS

# Create and activate Python virtual environment
python -m venv venv
# On Windows:
venv\Scripts\activate
# On Linux/macOS:
# source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

Create or verify `.env` in the root directory:
```ini
# Raspberry Pi Edge AI Endpoint
OLLAMA_URL=http://10.100.177.51:11434
OLLAMA_MODEL=qwen3:1.7b
OLLAMA_TIMEOUT_SECONDS=180.0

# Optional cloud fallback API key
GEMINI_API_KEY=your_gemini_api_key_here
```

Start the FastAPI backend server:
```bash
python -m src.api.server
# Server starts at http://localhost:8000
```

---

### 2. 3D Frontend Setup

Open a new terminal window:
```bash
cd "3d website"

# Install frontend packages
npm install

# Start Vite development server
npm run dev
# Vite runs at http://localhost:3000 (proxies /api -> http://localhost:8000)
```

Visit **`http://localhost:3000`** in any modern WebGL-enabled browser (Chrome, Edge, Brave, Firefox).

---

## Navigation & Controls

| Control | Action |
|---|---|
| **`W` / `A` / `S` / `D`** | Move forward / left / backward / right |
| **Mouse Drag / Pointer Lock** | Look around 360° |
| **`Shift`** | Sprint / walk faster |
| **`X`** | Toggle **Operations View HUD** (or click `🏢 Operations View` in toolbar) |
| **`C`** | Open / close the **Occupant Feedback Chat** panel |
| **`M`** | Toggle **Spatial Minimap** |
| **`E`** | Interact with highlighted in-world objects / thermostats |
| **`ESC`** | Release pointer lock / exit overlay |

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/status` | Current system health, active environment, simulation speed, and LLM connectivity status. |
| `POST` | `/api/chat` | Submit occupant natural-language feedback. Streams conversational tokens and emits structured `ComfortEvent`. |
| `GET` | `/api/stream` | Server-Sent Events (SSE) telemetry stream pushing live zone temperatures, setpoints, power, and mascot emotions. |
| `GET` | `/api/zones` | Snapshot of all zone states in the active environment. |
| `GET` | `/api/metrics` | Cumulative energy comparison metrics (Baseline kWh vs RL kWh, cost, emissions). |
| `POST` | `/api/simulation/control` | Control simulation lifecycle (`start`, `pause`, `reset`, `set_speed`). |
| `POST` | `/api/sensors/ingest` | Ingest physical ESP32 sensor telemetry (`temperature`, `humidity`, `co2`). |

### Example Chat Request:
```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "It is freezing in the lobby!", "environment_id": "corporate"}'
```

---

## Running Tests

### Python Backend Tests
Run the complete test suite including local Ollama mock tests, semantic translation validation, and thermal physics checks:
```bash
pytest -o pythonpath="src src/nlp" tests/test_local_translator_mock.py tests/test_enhanced_rules.py
```

### Frontend TypeScript & Build Check
Verify TypeScript typing and production bundle build:
```bash
cd "3d website"
npm run typecheck
npm run build
```

---

## Technology Stack

- **Edge AI & NLP**: Raspberry Pi 4 (Cortex-A72), Ollama, Qwen 2.5/3 (1.7B), GBNF Grammars, spaCy, Pydantic v2
- **Thermodynamics & Control**: Custom 3R-2C RC-network simulation, Tabular Q-Learning, ASHRAE Standard 55 & 90.1
- **Backend & Streaming**: Python 3.12, FastAPI, Uvicorn, Server-Sent Events (SSE), HTTPX
- **3D Visualization**: TypeScript, Three.js, WebGL, Vite, Luma AI 3D GLB Animations, Glassmorphism CSS
- **Hardware Integration**: ESP32 Microcontrollers, MicroPython/C++, HTTP REST & MQTT Protocols

---

## License

This project is licensed under the MIT License.
