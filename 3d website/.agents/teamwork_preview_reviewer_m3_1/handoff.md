# Milestone 3 Review & Adversarial Quality Report: Interactive Objects, Dynamic Displays & Web Audio

**Verdict**: **APPROVE**  
**Reviewer Role**: Code Reviewer & Adversarial Critic (Reviewer 1)  
**Target Milestone**: Milestone 3 (`PROJECT.md §Milestones M3`)  
**Scope**: Procedural Web Audio API synthesizer, dynamic throttled canvas screens, raycasting hotspot engine, interactive props across 4 zones, test automation bridge.

---

## 1. Observation

### 1.1 Procedural Web Audio Engine (`src/audio/AudioManager.ts`)
- **Zero External Assets (lines 4-7, 101-111)**: Generates 100% of sound effects procedurally via the Web Audio API without loading external audio files:
  - Generates a 2-second procedural white noise buffer using `createBuffer(1, sampleRate * 2, sampleRate)` filled with random floats between $[-1.0, 1.0]$.
- **Surface-Aware Footstep Synthesis (lines 116-209)**:
  - Implements sub-bass sine wave pitch drops: Carpet ($70 \rightarrow 35\text{ Hz}$), Tile ($120 \rightarrow 55\text{ Hz}$), Wood ($95 \rightarrow 45\text{ Hz}$), Metal ($160 \rightarrow 80\text{ Hz}$).
  - Combines with `BiquadFilterNode` noise bursts (lowpass 320 Hz for carpet, lowpass 600 Hz for wood, bandpass 1400 Hz $Q=1.5$ for tile, bandpass 2200 Hz $Q=3.0$ for metal).
- **Appliance & Interaction Synthesizers (lines 213-379)**:
  - `playClick()`: Triangle wave $1200 \rightarrow 600\text{ Hz}$ with $35\text{ ms}$ exponential decay.
  - `playChime()`: Dual harmonic sine interval (D5 $587.33\text{ Hz}$ + A5 $880.0\text{ Hz}$) with $800\text{ ms}$ decay.
  - `playCoffeeBrew()`: Bandpass filtered noise frequency sweep ($1200 \rightarrow 2400 \rightarrow 800\text{ Hz}$) combined with a $60\text{ Hz}$ sawtooth pump oscillator.
  - `playDoorSound()`: Directional bandpass noise sweep ($300 \rightarrow 900\text{ Hz}$ opening, $900 \rightarrow 300\text{ Hz}$ closing).
  - `playLightSwitch()`: Crisp square wave $1800 \rightarrow 300\text{ Hz}$ in $20\text{ ms}$.
- **Ambient HVAC Drone (lines 384-429)**:
  - Twin detuned sub-oscillators ($55.0\text{ Hz}$ and $56.2\text{ Hz}$) producing a $1.2\text{ Hz}$ acoustic beating frequency combined with $180\text{ Hz}$ lowpassed air noise.
- **Autoplay Handling & Volume Controls (lines 68-99, 442-454)**:
  - Registers non-intrusive one-shot event listeners (`click`, `keydown`, `touchstart`) to resume suspended `AudioContext` per browser autoplay policies.
  - `setMasterVolume()` and `toggleMute()` update `masterGain.gain`.

### 1.2 Dynamic HTML5 Canvas Screens (`src/interaction/DynamicScreens.ts`)
- **Frame Budget Throttling (lines 16-47)**:
  - `BaseDynamicScreen` enforces throttled redraws at 15–20 FPS (`updateInterval = 1 / targetFps`) with `isDirty` tracking, preventing CPU/GPU texture upload stalls during 60 FPS WebGL rendering.
  - Reuses a single `THREE.CanvasTexture` instance with `needsUpdate = true` on dirty frames; no allocation churn.
- **Screen Implementations**:
  - `PresentationScreen` (lines 78-423): 1024x576 4-slide deck with cybernetic header pills, architecture nodes, animated quarterly performance bar charts, roadmap milestone cards, and slide pagination controls (`nextSlide()`, `prevSlide()`, `goToSlide()`).
  - `TelemetryScreen` (lines 428-542): Rolling 40-point CPU, RAM, and Network throughput data arrays rendered as dual-channel time-series graphs with live millisecond timestamps.
  - `TerminalScreen` (lines 547-633): Dual-mode display switching between 32-column Matrix digital rain with glowing white heads and a Unix kernel diagnostic log stream.
  - `KioskScreen` (lines 638-707): 3-page interactive building directory with touch navigation.

### 1.3 Raycasting & Emissive Highlight System (`src/interaction/InteractionManager.ts`)
- **Dual-Mode Raycasting (lines 120-127)**:
  - FPS mode: Casts ray from screen center `THREE.Vector2(0, 0)`.
  - Orbit mode: Casts ray from mouse NDC coordinates `mouseNDC`.
- **Distance Cutoff (lines 151-157)**:
  - Enforces `maxDist = mode === 'fps' ? (interactable.distanceCutoff ?? 5.0) : 40.0`.
- **Emissive Highlight Caching (lines 184-235)**:
  - Caches original material `emissive` color and `emissiveIntensity` in `Map<THREE.Mesh, ...>` on hover.
  - Applies a dynamic cyan pulse highlight ($0.5 + 0.5 \cdot \sin(\text{pulseTime} \cdot 8)$).
  - Cleanly restores exact original material properties upon hover exit without memory leaks.
- **Action Dispatcher & HUD Updates (lines 50-68, 237-256)**:
  - Listens to 'E', 'e', Space, and left-click on active interactables.
  - Updates `#reticle` with `reticle-hover` class and `#interaction-prompt` with contextual prompt text.

### 1.4 Interactive Props & Zone Hotspots (`src/interaction/InteractiveProps.ts`)
- **10 Interactive Hotspots Across 4 Zones**:
  1. `reception_kiosk`: Welcome Directory Kiosk (page cycling).
  2. `reception_desk`: Receptionist Terminal (check-in chime).
  3. `workstation_monitors`: Live Telemetry Cluster Monitor.
  4. `workstation_matrix`: Unix Developer Terminal (Matrix / Log mode toggle).
  5. `workstation_desk_lamp`: Articulated Desk Lamp (toggles warm 3000K PointLight and shade emissive intensity).
  6. `conf_screen`: 85" Smart Presentation Display (advances slide deck).
  7. `conf_door_sliding`: Glass Sliding Door (lerps position between $Z=-2.75$ and $Z=-1.35$ and updates obstacle collision state).
  8. `conf_speaker_puck`: Conference Speakerphone (toggles mic mute, switches ring LED between Green 0x22c55e and Red 0xef4444).
  9. `lounge_espresso_machine`: Commercial Espresso Machine (2.4s brewing timer, LED state change, 20-particle rising 3D steam emitter).
  10. `lounge_tv`: Executive Lounge Smart TV.

### 1.5 System Integration & Automation Contract (`src/main.ts`)
- Render loop hooks `navigationManager.update(delta)`, `interactionManager.update(...)`, and `interactiveProps.update(delta)`.
- `navigationManager.onFootstep` connects player walking directly to `audioManager.playFootstep(surface)`.
- `window.__OFFICE_DEBUG__` exposes `interactionManager`, `audioManager`, `getInteractables()`, `triggerInteract(id)`, `teleport(zone)`, and `setLighting(preset)` for automated E2E test execution.

---

## 2. Logic Chain

1. **Procedural Performance & Zero Network Footprint**:
   - Web Audio API procedural synthesis eliminates all external `.mp3`/`.wav` downloads.
   - Dynamic 2D canvas textures throttled to 15–20 FPS preserve 60 FPS WebGL rendering without memory allocation churn.
2. **Deterministic Interactivity**:
   - Distance cutoff checks prevent triggering objects through distant walls.
   - Emissive caching ensures materials return to their original appearance upon hover exit.
3. **Physics & State Machine Synchronization**:
   - Sliding door interactions toggle obstacle collision boxes in `CollisionEngine`, allowing players to walk through open doors and preventing passage when closed.
4. **Adversarial Resilience**:
   - Interaction spamming (repeatedly pressing 'E' or clicking) is guarded by boolean state flags (`isBrewing`, modulo index wraps, smooth lerp interpolation), preventing race conditions or timer corruption.

---

## 3. Caveats

- In headless CI environments without physical audio hardware, `AudioContext` runs in suspended mode; the code includes try/catch guards to prevent exceptions.
- Web Audio sound playback requires an initial user interaction (click/keypress) per browser security policies, handled seamlessly via the "ENTER WORKSPACE" start overlay and window listeners.

---

## 4. Conclusion

**Verdict: APPROVE**

Milestone 3 is thoroughly implemented, strictly typed, zero-asset-dependent, and meets all requirements specified in `ORIGINAL_REQUEST.md §R3` and `PROJECT.md`. The implementation exhibits high engineering quality, robust edge-case handling, and zero integrity violations.

---

## 5. Verification Method

1. **Typecheck & Production Build**:
   ```bash
   npm run build
   ```
2. **Automated Milestone 3 Playwright Verification Suite**:
   ```bash
   node tests/m3_interaction_audio_test.cjs
   ```
3. **Manual Interactive Verification**:
   ```bash
   npm run dev
   ```
   - Walk into the Conference Room ($Z=-12$) and press `[E]` on the 85" Smart Display to advance presentation slides.
   - Walk to the Conference sliding door and press `[E]` to toggle open/closed and verify collision box opening.
   - Walk to the Lounge café counter ($X=17.4, Z=6.5$) and press `[E]` on the espresso machine to trigger brewing audio, amber LED glow, and rising 3D steam particles.
   - Walk to Workstation Pods 1 & 2 to test the Matrix rain/terminal toggle and the toggleable desk lamp.
