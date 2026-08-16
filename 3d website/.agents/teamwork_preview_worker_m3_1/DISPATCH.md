# Subagent Assignment: Worker M3 (Interactive Objects, Dynamic Displays & Web Audio)

## Identity
- Role: Implementation Worker
- Working Directory: C:\Users\thebh\.gemini\antigravity\scratch\corporate_office_3d\.agents\teamwork_preview_worker_m3_1

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A forensic auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Context & Architecture
You are implementing Milestone 3 of the 3D Corporate Office Web Application.
- Read C:\Users\thebh\.gemini\antigravity\scratch\corporate_office_3d\ORIGINAL_REQUEST.md (MANDATORY)
- Read C:\Users\thebh\.gemini\antigravity\scratch\corporate_office_3d\PROJECT.md
- Read C:\Users\thebh\.gemini\antigravity\scratch\corporate_office_3d\src\types\index.ts
- Read C:\Users\thebh\.gemini\antigravity\scratch\corporate_office_3d\src\scene\SceneManager.ts
- Read C:\Users\thebh\.gemini\antigravity\scratch\corporate_office_3d\src\scene\OfficeFloorplan.ts

## Task & Scope of Work
Implement all Milestone 3 components according to the interface contracts in `PROJECT.md`:

1. **`src/interaction/DynamicScreens.ts`**:
   - Create dynamic 2D HTML5 Canvas texture renderers:
     - `PresentationScreen`: multi-slide presentation deck (e.g. Title, Architecture Diagram, Q3 Metrics, Next Steps) with slide advance/previous, title headers, bullet points, charts.
     - `TelemetryScreen`: live animated telemetry dashboard (multi-line performance graph, CPU/Memory/Network gauges, updating timestamps).
     - `TerminalScreen`: animated Matrix digital rain and Unix system status log.
   - Throttle updates to ~15-20 FPS or dirty-state triggers to maintain 60 FPS rendering performance.
   - Return `THREE.CanvasTexture` instances with `minFilter = THREE.LinearFilter`, `magFilter = THREE.LinearFilter`.

2. **`src/audio/AudioManager.ts`**:
   - Implement pure procedural Web Audio API synthesizer (0 external audio files):
     - `playFootstep(surface)`: noise buffer + low-pass filter thump with velocity sensitivity.
     - `playClick()`: clean sine/triangle chirp.
     - `playChime()`: dual-tone bell chime with exponential gain decay.
     - `playCoffeeBrew()`: bubbling bandpass noise + steam hiss envelope.
     - `setAmbientEnabled(enabled)`: ambient low HVAC drone + faint room presence.
     - `masterVolume`, `isMuted`, `toggleMute()`, `setMasterVolume(vol)`.
     - User interaction unlock handler (AudioContext resume).

3. **`src/interaction/InteractionManager.ts`**:
   - Raycaster implementation:
     - In FPS mode: cast from camera center `(0, 0)`.
     - In Orbit mode: cast from mouse pointer coordinates.
     - Max interaction distance: 5.0m in FPS mode.
   - Emissive hover highlight pulse on targeted meshes.
   - Hover state callbacks and reticle status updates (`idle` vs `hover`).
   - Primary action execution (click / 'E' key press / Space).
   - Hotspot registry (`register`, `unregister`, `getActiveInteractable`, `getInteractables`).

4. **`src/interaction/InteractiveProps.ts`**:
   - Instantiate and register interactive objects throughout the 4 zones:
     - Conference Room: Main 85-inch Presentation Display (advances slides on click + chime).
     - Workstations: Telemetry Monitor Pod (cycles metrics on click) & Terminal Matrix Monitor (toggles matrix stream).
     - Lounge: Premium Espresso / Coffee Machine (triggers brewing state + steam particle effect + brew audio).
     - Reception: Interactive Welcome Kiosk (triggers company info display modal / prompt).
     - Lighting / Lamps: Desk lamps and wall sconces that toggle emissive & point lights.
     - Conference Glass Door: Animated sliding/pivoting door with audio.

5. **Integration & Automation Contract (`src/scene/SceneManager.ts`, `src/main.ts`)**:
   - Wire `InteractionManager` and `AudioManager` into `SceneManager` animation loop.
   - Connect footstep events from `FirstPersonController` / `NavigationManager.onFootstep` to `AudioManager.playFootstep()`.
   - Update `window.__OFFICE_DEBUG__` with `interactionManager`, `audioManager`, `getInteractables()`, and `triggerInteract(id)`.

6. **Testing & Build Verification**:
   - Create comprehensive unit/integration test script `tests/m3_interaction_audio_test.cjs` validating raycasting, interactable triggers, canvas texture updates, audio synthesis, and debug contract.
   - Verify `npx tsc --noEmit` and `npm run build` pass cleanly with 0 errors.
   - Execute `node tests/m3_interaction_audio_test.cjs`.

## Output
Write your comprehensive handoff report to `C:\Users\thebh\.gemini\antigravity\scratch\corporate_office_3d\.agents\teamwork_preview_worker_m3_1\handoff.md` and send a message when done.
