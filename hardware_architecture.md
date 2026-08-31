# Hardware-in-the-Loop Architecture

Transitioning the Digital BMS from a pure simulation to a **Physical Cyber-Physical System (Hardware-in-the-Loop)** evolves the platform into a true **Cognitive Digital Twin (CDT)**. 

In this architecture, the simulation does not disappear. Instead, it transitions into a **Shadow Twin & Predictive Sandbox** that benchmarks real energy savings and simulates AI actions before deploying them to physical actuators.

---

## 1. High-Level Hardware-in-the-Loop Architecture

```
+-------------------------------------------------------------------------------------------------+
|                                     1. PRESENTATION LAYER                                       |
|   - 3D WebGL Digital Twin (Live physical sensor heatmaps & real-time astronomical lighting)     |
|   - 2D Global Command Dashboard (Physical vs. Baseline KPI energy/cost monitoring)              |
|   - Occupant Feedback AI (Natural language comfort requests mapped to physical zones)           |
+-----------------------------------------------+-------------------------------------------------+
                                                | HTTP REST / SSE Stream (/api/stream)
+-----------------------------------------------v-------------------------------------------------+
|                              2. COORDINATOR & AURA RULE SYSTEM                                  |
|   - Semantic Intent Extraction (LLM + Regex Fallback)                                           |
|   - Deterministic Constraint Mapper & Tripartite Dynamic Decay w(t)                             |
|   - Physical Safety Shield Gate (Slew-rate limiter, hard bounds, anti-short-cycling protection) |
+----------------------+--------------------------------------------------+-----------------------+
                       |                                                  |
+----------------------v------------------------+ +-----------------------v-----------------------+
|  3. SHADOW DIGITAL TWIN & PREDICTIVE SANDBOX  | |   4. HARDWARE ABSTRACTION LAYER (HAL) & EDGE  |
| - Continuous State Estimator & Calibration    | | - Protocol Adapters: BACnet/IP, Modbus, MQTT  |
| - Virtual Baseline Twin (What ASHRAE 90.1     | | - Inbound: Sensor telemetry ingest & cleaning |
|   would have used under real weather)         | | - Outbound: Write authorized setpoints/relays |
| - Counterfactual Energy Savings Delta ($/kWh) | | - Edge Heartbeat Watchdog & Local Failsafes   |
+-----------------------------------------------+ +-----------------------+-----------------------+
                                                                          | Fieldbus (RS-485 / IP / Zigbee)
+-------------------------------------------------------------------------v-----------------------+
|                                5. PHYSICAL SENSORS & ACTUATORS LAYER                            |
|                                                                                                 |
|   [ SENSORS ]                                     [ ACTUATORS / CONTROLLERS ]                   |
|   • Temperature & Humidity (DHT22 / BME680 / RS485)• Smart Thermostats (Nest / Ecobee / BACnet) |
|   • Air Quality / CO2 (SCD30 / SCD40)             • VAV Damper Actuators (0-10V / Modbus)       |
|   • Occupancy / PIR / Thermal Imaging             • HVAC Chillers / Heat Pump Relays            |
|   • Real-Time CT Power Clamps (Current Transformers)• Variable Frequency Drives (VFDs)          |
+-------------------------------------------------------------------------------------------------+
```

---

## 2. Key Architectural Changes

### A. Hardware Abstraction Layer (HAL) & Gateway
Instead of reading and writing state directly to the Python `environment.py` ODE solver, a new **HAL** (`src/hardware/`) handles the physical plane:
* **Inbound Telemetry Pipeline**: Polls/subscribes to physical IoT sensors at regular intervals (e.g., 5s–30s). Applies Kalman filtering, anomaly detection, and unit normalization ($^\circ\text{C}$, $\text{RH}\%$, $\text{kW}$).
* **Outbound Actuation Pipeline**: Translates authorized AI actions into protocol-specific commands (e.g., Modbus register writes, BACnet `AnalogValue` writes, or MQTT topics).

### B. The Role of the Digital Twin (From Pure Sim $\to$ Shadow Twin)
The physics engine operates as a **Synchronized Shadow Twin**:
1. **Counterfactual Baseline Tracking**: Because you cannot physically run two controllers on the same real building simultaneously, the physical building runs the **AI Controller**, while the **Baseline Twin** simulates in parallel using the *exact physical weather and occupancy* to compute true real-world ROI and kWh saved.
2. **Predictive What-If Sandbox**: Before a radical setpoint change is applied to real equipment, the physics engine can fast-forward into the future to verify thermal inertia and comfort stability.

### C. Physical-Grade Safety Shield (Critical Addition)
When controlling physical hardware, software errors can cause physical damage or freeze lines. The Safety Shield adds hardware-grade protections:
* **Anti-Short Cycling**: Ensures compressors/chillers cannot cycle ON and OFF faster than a 3–5 minute threshold (prevents motor burnout).
* **Freeze & Overheat Hard Limiters**: Absolute cutoffs (e.g., minimum $16.0^\circ\text{C}$ / maximum $28.0^\circ\text{C}$) executed at both the software coordinator and the edge controller levels.
* **Watchdog Heartbeat / Autonomous Fallback**: If the Python AI server crashes or the network drops for $>60\text{s}$, the edge hardware automatically falls back to standard local standalone thermostat operation.

---

## 3. Recommended Hardware & Communication Stacks

Depending on the deployment scale, the hardware and protocol stack varies:

| Component | DIY / IoT Lab Prototype | Commercial / Industrial Grade |
|---|---|---|
| **Edge Gateway** | Raspberry Pi 4/5 running Mosquitto MQTT & Python HAL | Industrial Edge PC (e.g., Advantech / Siemens Microbox) |
| **Sensors** | ESP32 + BME680 (Temp/RH/Pressure) + SCD40 (CO2) | Modbus RS-485 or BACnet/IP Room Sensors |
| **Power Monitoring** | Shelly EM / PZEM-004T CT Clamps | Schneider Electric / Siemens Smart Power Meters |
| **HVAC Actuation** | Smart Wi-Fi Relays (Shelly Pro) or Modbus DACs (0-10V) | BACnet MS/TP VAV Controllers & Chiller Modbus Cards |
| **Python Libraries** | `paho-mqtt`, `pyserial`, `requests` | `BAC0` (BACnet), `pymodbus` (Modbus), `asyncua` (OPC-UA) |

---

## 4. Implementation Checklist

1. **Hardware Driver Integration (`src/hardware/`)**:
   - `src/hardware/mqtt_client.py` or `src/hardware/bacnet_client.py`
   - `src/hardware/sensor_manager.py` (Ingestion & Filtering)
   - `src/hardware/actuator_manager.py` (Command Translation)
2. **Coordinator Upgrade (`src/api/coordinator.py`)**:
   - Add a `SIMULATION_MODE: "simulated" | "hybrid" | "physical"` configuration flag.
   - In `physical` mode, substitute the gym environment input state with live sensor reads from the `SensorManager`.
3. **Telemetry Streaming (`/api/stream`)**:
   - Feed live, filtered sensor data to the 3D HUD & 2D Dashboard instead of simulated ODE results.
   - Broadcast real power consumption alongside the baseline's simulated power consumption to calculate energy delta.
