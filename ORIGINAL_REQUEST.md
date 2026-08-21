# Original User Request

## 2026-08-14T11:09:26Z

# Teamwork Project Prompt — Draft

> Status: Launched
> Goal: Craft prompt → get user approval → delegate to teamwork_preview
> Requested team: [none — teamwork routes from the description]

Build a "Digital Twin" Building Optimizer with NLP Feedback. It is an autonomous, closed-loop AI prototype that minimizes HVAC energy consumption while maximizing human comfort by dynamically translating natural language occupant feedback into structured constraints for a Reinforcement Learning-driven digital twin simulation.

Working directory: C:\Users\thebh\.gemini\antigravity\scratch\teamwork_projects\digital_twin_hvac
Integrity mode: demo

## Requirements

### R1. Standalone Web App Interface & Dashboard
A functional standalone web application prototype that collects unstructured comfort feedback via a chat-like interface and visualizes the RL agent's optimized energy consumption against a standard baseline.

### R2. LLM Translation Engine
A backend pipeline using Generative AI to interpret subjective, unstructured complaints (e.g., "It's freezing in the lobby") and translate them into a precise, structured JSON format containing environmental constraints (location, temperature offset, humidity adjustments).

### R3. Digital Twin & RL Simulator
A custom Python-based simulated environment (simplified to medium complexity) where a Reinforcement Learning agent dynamically adjusts HVAC setpoints in response to the LLM constraints, simulated weather, and energy data. 

## Acceptance Criteria

### Interface & Integration
- [ ] The web app successfully starts and exposes a frontend UI and backend API on a local port.
- [ ] End-to-end integration: Submitting a natural language complaint in the UI triggers the LLM translation and updates the simulator state.

### LLM Translation
- [ ] A programmatic test script passes 5 distinct, vague human complaints through the LLM engine, and all 5 return correctly formatted JSON objects with no hallucinatory keys.

### Simulator & Agent
- [ ] A test script can successfully step the custom RL simulator through at least 100 episodes/timesteps without crashing.
- [ ] The simulator outputs metric logs comparing baseline energy vs optimized energy that the dashboard can ingest and visualize.

## 2026-08-14T11:18:19Z

The user wants to see the implementation plan first before you proceed with full implementation. Can you share the current plan you are working on, or pause and provide your step-by-step plan for review?

## 2026-08-17T06:49:38Z

# Teamwork Project Prompt — Draft

> Status: Launched
> Goal: Craft prompt → get user approval → delegate to teamwork_preview
> Requested team: Full team

Implement the "Aura Rule System Improved Specification" which refactors the NLP pipeline to emit semantic `ComfortEvent`s rather than direct physical HVAC offsets. Introduce a deterministic constraint mapping layer, a decaying preference weight system, and a final safety shield to authorize HVAC actions.

Working directory: D:\digitalTwin
Integrity mode: demo

## Requirements

### R1. Semantic LLM Extraction & Validation
Refactor `translator.py` and `schemas.py` so the LLM outputs a `ComfortEvent` (intent, severity, suspected cause, confidence) without hallucinating physical temperature offsets. Implement strict schema and semantic validation.

### R2. Deterministic Constraint Mapping & Decay
Implement a deterministic mapper that converts `ComfortEvent`s into bounded physical preferences based on intent and severity. Replace the fixed time decay with a dynamic weight equation ($w(t)$) modulated by sensor evidence and a cooldown period.

### R3. Safety Shield Authorization Layer
Introduce a final safety layer between the controller (Baseline/RL) and the simulation. This layer must enforce hard bounds on temperature, rate limits for sudden setpoint reversals, and actuator saturation clipping before passing commands to the physics engine.

## Acceptance Criteria

### Unit Testing & Objective Verification
- [ ] A new test script (e.g. `test_enhanced_rules.py`) is written and executed successfully via `pytest`.
- [ ] Test case passes: "It is freezing in the lobby" returns a `TOO_COLD` intent, the correct zone, a bounded preference, and high severity.
- [ ] Test case passes: An LLM timeout/failure verifies the deterministic fallback parser successfully catches it and creates a low-confidence event without throwing an unhandled exception.
- [ ] Test case passes: The Safety Shield intercepts and successfully clips/blocks a physical action that violates the maximum rate limit (sudden setpoint reversal).
- [ ] The full test suite executes and passes.
