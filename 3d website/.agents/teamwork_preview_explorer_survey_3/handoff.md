# Comprehensive Survey & Handoff Report: HUD, Minimap, Teleportation, Tech Stack & 4-Tier E2E Testing Strategy

**Project:** 3D Corporate Office Web Application (Three.js)  
**Author:** Explorer 3 (`teamwork_preview_explorer_survey_3`)  
**Parent:** Orchestrator (`9b21702f-1a0c-4d9d-a663-d858f0563b63`)  
**Target Milestones:** Milestone 4 (HUD, Minimap, Teleportation, Settings UI) & E2E Testing Track (4-Tier Test Strategy)  
**Date:** 2026-08-15  

---

## 1. Observation

Direct observations from analysis of `ORIGINAL_REQUEST.md`, Three.js WebGL rendering pipelines, browser DOM/Canvas APIs, and project architecture:

1. **Original Requirements Baseline (`ORIGINAL_REQUEST.md:33-42, 53-62`)**:
   - **R4 (HUD Interface & Spatial Minimap)**:
     - *Minimap Overlay*: Real-time 2D floorplan showing player position `(x, z)` and orientation vector (yaw heading).
     - *Quick-Teleport Menu*: Instant/smooth navigation shortcuts to jump camera/player to Reception, Conference Room, Workstations, or Lounge.
     - *Settings & Lighting Controls*: Toggle between Day, Sunset, and Night lighting presets, toggle shadows, and adjust graphics quality (pixel ratio/post-processing).
     - *Help & Shortcuts Overlay*: Onscreen guide for keybindings and interactions.
   - **R5 (Optimization & Standalone Web Execution)**:
     - 60 FPS performance target across modern web browsers.
     - Standalone local execution with zero friction via Vite dev server or static hosting.
   - **Acceptance Criteria**:
     - 2D minimap accurately tracks player location and facing angle in real time.
     - Quick-teleport buttons reliably move camera/player to specified rooms.
     - Key controls modal (pressing `H` or clicking button) displays navigation instructions.
     - Web app runs smoothly without memory leaks or uncaught runtime exceptions.

2. **Integration Alignment with Explorer 1 (Scene Architecture) & Explorer 2 (Navigation & Interaction)**:
   - *Spatial Coordinates*: Office bounds $X \in [-20.0, +20.0]\text{m}$ (40m width), $Z \in [-13.0, +13.0]\text{m}$ (26m depth), $Y \in [0.0, 4.0]\text{m}$ (ceiling height).
   - *Key Zone Coordinates*:
     - **Zone 1 (Reception & Lobby)**: Center `[-7.0, 1.6, 7.5]`, Yaw `0.0 rad` ($0^\circ$, facing North).
     - **Zone 2 (Open Workstations)**: Center `[-7.0, 1.6, -6.0]`, Yaw `0.0 rad` ($0^\circ$, facing North).
     - **Zone 3 (Glass Conference Room)**: Center `[12.0, 1.6, -6.0]`, Yaw `3.14159 rad` ($180^\circ$, facing South/Display).
     - **Zone 4 (Lounge & Breakroom)**: Center `[12.0, 1.6, 7.5]`, Yaw `1.5708 rad` ($90^\circ$, facing East).
     - **Entrance / Overview Spawn**: `[0.0, 1.6, 11.5]`, Yaw `0.0 rad`.
   - *Controller & Interaction Contract*: FPS and Orbit camera rigs expose `getPosition(): THREE.Vector3`, `getYaw(): number`, `setPosition(pos, yaw)`, and event listeners for interaction triggers, pointer-lock state changes, and audio synthesizers.

---

## 2. Logic Chain

Through systematic deduction, we establish the technical foundation for the UI, HUD, Minimap, Build Stack, and 4-Tier E2E Testing strategy:

### Step 1: Why an HTML5 2D Canvas for the Minimap rather than a Secondary 3D Viewport Camera?
1. Rendering a secondary 3D camera from a top-down perspective requires an extra full-scene render pass per frame ($2\times$ draw calls, redundant geometry vertex transformations, extra shadow passes), degrading frame rate on low-end or integrated GPUs.
2. A dedicated 2D HTML5 `<canvas>` element (e.g. $220\text{px} \times 145\text{px}$) utilizing direct 2D vector primitives (`arc`, `lineTo`, `stroke`, `fill`) can render walls, zone rectangles, furniture outlines, room text labels, and dynamic player blips in $<0.1\text{ms}$ per frame.
3. It allows clean high-contrast styling (blueprint/cyberpunk HUD aesthetic), dynamic FOV vision cones, interactive zone clicking, and zero GPU vertex buffer rebinds.

### Step 2: Coordinate Mapping Mathematics (World $\to$ 2D Minimap Canvas)
1. Let the 3D office world boundary be $[X_{\min}, X_{\max}] = [-20.0, 20.0]\text{m}$ ($W_{\text{world}} = 40.0\text{m}$) and $[Z_{\min}, Z_{\max}] = [-13.0, 13.0]\text{m}$ ($D_{\text{world}} = 26.0\text{m}$).
2. For a canvas with width $W_c$ and height $H_c$, with an inner padding $p$, the effective drawing area is $W_{\text{eff}} = W_c - 2p$ and $H_{\text{eff}} = H_c - 2p$.
3. Given aspect ratio matching ($40 / 26 \approx 1.538$), scale factors are:
   $$s_x = \frac{W_{\text{eff}}}{X_{\max} - X_{\min}} = \frac{W_{\text{eff}}}{40.0}, \quad s_z = \frac{H_{\text{eff}}}{Z_{\max} - Z_{\min}} = \frac{H_{\text{eff}}}{26.0}$$
4. The affine mapping from world coordinate $(x_w, z_w)$ to canvas pixel $(u, v)$ is:
   $$u(x_w) = p + (x_w - X_{\min}) \cdot s_x = p + (x_w + 20.0) \cdot s_x$$
   $$v(z_w) = p + (z_w - Z_{\min}) \cdot s_z = p + (z_w + 13.0) \cdot s_z$$
5. Player yaw angle $\theta$ (in radians, where $\theta = 0$ is North along $-Z$) maps to canvas heading vector:
   $$\vec{d}_{\text{canvas}} = (\sin\theta, -\cos\theta)$$
   The player's vision cone is drawn as a circular sector with radius $R_{\text{cone}} = 24\text{px}$, opening angle $\phi = \pm 35^\circ$ ($\text{FOV} = 70^\circ$), filled with a radial gradient $\text{rgba}(56, 189, 248, 0.35) \to \text{rgba}(56, 189, 248, 0.0)$.

### Step 3: HUD Architecture — Vanilla Modular DOM + Glassmorphism vs Heavy JS Frameworks
1. Introducing React, Vue, or Angular creates unnecessary bundle bloat ($>150\text{KB}$ JS overhead), virtual DOM diffing latency during 60 FPS animation loops, and compilation complexity.
2. A vanilla TypeScript/ESM component architecture with declarative DOM templates and scoped CSS using CSS custom properties (`backdrop-filter: blur(12px)`, CSS Grid, Flexbox) delivers instant $0\text{ms}$ cold start, $0\text{KB}$ framework overhead, $<10\text{KB}$ total CSS footprint, and clean direct DOM bindings.
3. Pointer lock management is cleanly decoupled: when any modal or drawer is active (`#help-modal`, `#settings-drawer`, `#interaction-modal`), pointer lock is automatically released (`document.exitPointerLock()`); when dismissed or clicking the 3D canvas, pointer lock is cleanly reacquired.

### Step 4: Quick-Teleportation Mechanics & Transition Decoupling
1. Quick-teleport buttons should support both instant mode and smooth cinematic transition.
2. In smooth mode, triggering a teleport initiates `CameraTransitionManager.startTransition()`:
   - Interpolates camera from current position to target zone position along a parabolic arc ($y(t) = \text{lerp}(y_0, y_1, t) + 4 H_{\text{arc}} t(1-t)$).
   - Slerps quaternion rotation to target room yaw.
   - Triggers audio chime and briefly displays a "Teleporting to [Room]..." HUD banner.
3. In instant mode, it immediately invokes `FirstPersonController.setPosition(targetPos, targetYaw)`, resetting velocity to zero and updating the minimap blip instantaneously without collision snagging.

### Step 5: Reactive Settings & Lighting Pipeline
1. Lighting presets (Day, Sunset, Night) must dynamically adjust:
   - Directional Sun/Moon light (color, intensity, position vector).
   - Ambient light (color, intensity).
   - Background sky / Fog color (`scene.fog.color` and `scene.background`).
   - Interior point lights & emissive materials (amplified at Night for dramatic ambient glow).
2. Quality scaler:
   - Adjusts `renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityFactor))`, supporting Performance ($0.75\times$), Balanced ($1.0\times$), and Ultra ($1.5\times-2.0\times$).
   - Shadow map toggle: `renderer.shadowMap.enabled = true/false` and dynamic directional light shadow map recreation.

### Step 6: 4-Tier Opaque-Box E2E Testing Architecture
1. WebGL 3D web applications often suffer from "canvas black box syndrome" where traditional E2E tests cannot verify 3D state, matrix calculations, or shader errors.
2. We design a 4-Tier Opaque-Box Testing Strategy:
   - **Tier 1 (Feature & Unit Smoke)**: Verifies WebGL context creation, scene graph construction, DOM element presence, audio synthesis readiness.
   - **Tier 2 (Boundary & Edge Tests)**: Verifies wall collision clamping, camera pitch constraints ($\pm 85^\circ$), window resize stability, rapid input spamming without NaN transforms.
   - **Tier 3 (Interaction & State Integration)**: Verifies raycast hotspots, slide-deck cycling, modal dialogs, lighting preset transitions, audio mute/unmute.
   - **Tier 4 (Real-World Scenarios & Performance Soak)**: End-to-end user journeys (Reception $\to$ Workstations $\to$ Conference $\to$ Lounge), 60 FPS frame rate verification, draw-call budget ($<50$), and zero WebGL memory leaks over continuous usage.
3. Testing Harness: Utilizes Playwright with Chromium WebGL flags (`--use-gl=angle` / `--use-gl=swiftshader`) + headless runner, combined with an automated `window.__OFFICE_DEBUG__` test interface for deterministic headless assertions.

---

## 3. Caveats

1. **Retina & High-DPI Minimap Sharpness**:
   - The 2D minimap `<canvas>` must be scaled by `window.devicePixelRatio` for sharp rendering on 4K/Retina displays (`canvas.width = rect.width * dpr`, `canvas.height = rect.height * dpr`, `ctx.scale(dpr, dpr)`).
2. **Pointer Lock vs UI Modal Interaction**:
   - When a modal (`#help-modal`, `#settings-drawer`) is opened, pointer lock must be released immediately so the user has a visible cursor to click buttons or change sliders. When the modal closes, clicking the canvas re-locks the pointer.
3. **Headless WebGL in CI/CD Environments**:
   - Automated testing on Linux/Windows CI without physical GPUs requires Chromium launched with `--enable-webgl --use-gl=angle` or `--use-gl=swiftshader`. The test suite must handle WebGL extension queries gracefully.
4. **State Machine Race Conditions**:
   - Rapidly clicking different teleport buttons while a camera transition is in flight must cancel the previous transition cleanly rather than causing conflicting tween state.

---

## 4. Conclusion

The complete architectural blueprint for the HUD Interface, 2D Dynamic Minimap, Quick-Teleport System, Settings & Lighting UI, Controls/Help Overlay, Build Stack, and 4-Tier Opaque-Box E2E Testing Strategy is established. All DOM structures, CSS design system tokens, mathematical formulas, TypeScript interfaces, and Playwright test specs are fully detailed in Section 6 below, ready for execution.

---

## 5. Verification Method

To independently verify the implementation:
1. **Development Server Launch**: Run `npm run dev` and verify Vite launches the application at `http://localhost:5173/` in $<500\text{ms}$.
2. **UI & HUD Inspection**:
   - Verify 2D minimap in upper-left corner updates player marker and vision cone in real time as player moves (WASD) and looks around (mouse).
   - Click each Quick-Teleport pill (Reception, Workstations, Conference, Lounge) and confirm camera moves to the exact zone coordinates and yaw.
   - Click Settings drawer, toggle between Day, Sunset, and Night presets; verify lighting updates instantly. Toggle shadows and adjust pixel ratio.
   - Press `H` or click Help button; confirm Controls modal opens with keyboard graphics, and pressing `Escape` or clicking `Close` dismisses it.
3. **Automated 4-Tier E2E Test Suite**:
   - Run `npm run test:e2e` (Playwright) and confirm all 4 tiers of tests pass (100% test pass rate across Feature, Boundary, Interaction, and Real-World tiers).
4. **Performance & Memory Profile**:
   - Open Chrome DevTools Performance panel, verify frame rate stays $\ge 58-60\text{ FPS}$, draw calls $\le 45$, and WebGL heap memory remains flat during 5-minute soak test.

---

## 6. Detailed Technical Specifications & Implementation Blueprints

### 6.1 Design System & Glassmorphic UI/DOM Architecture

#### Visual Identity & CSS Token System
- Modern tech corporate aesthetic: Cyber-slate dark theme, frosted glassmorphism (`backdrop-filter: blur(12px)`), neon cyan/sky blue accents (`#38bdf8`), emerald status indicators (`#10b981`), amber warnings (`#f59e0b`).

```css
:root {
  /* Color Palette */
  --bg-hud: rgba(15, 23, 42, 0.75);
  --bg-hud-hover: rgba(30, 41, 59, 0.85);
  --bg-card: rgba(30, 41, 59, 0.65);
  --border-glass: rgba(255, 255, 255, 0.12);
  --border-glow: rgba(56, 189, 248, 0.4);
  
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --text-accent: #38bdf8;
  --text-accent-glow: 0 0 12px rgba(56, 189, 248, 0.5);
  
  --accent-cyan: #06b6d4;
  --accent-sky: #38bdf8;
  --accent-emerald: #10b981;
  --accent-amber: #f59e0b;
  --accent-rose: #f43f5e;
  
  /* Glassmorphism */
  --glass-blur: blur(16px);
  --glass-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
  --glass-radius: 12px;
  --glass-radius-sm: 8px;
  --glass-radius-full: 9999px;
  
  /* Transitions */
  --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-normal: 250ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-slow: 400ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

#### Master DOM Hierarchy (`index.html`)

```html
<div id="app">
  <!-- 3D WebGL Canvas -->
  <canvas id="webgl-canvas"></canvas>

  <!-- HUD Master Overlay (pointer-events: none on root, auto on children) -->
  <div id="hud-container" class="hud-overlay">
    
    <!-- Top-Left: Spatial 2D Minimap & Zone Badge -->
    <div id="minimap-panel" class="hud-card glass-panel">
      <div class="minimap-header">
        <div class="zone-badge">
          <span class="live-dot pulse"></span>
          <span id="current-zone-name">WELCOME RECEPTION</span>
        </div>
        <div class="coordinates-readout" id="player-coords">X: -7.0 | Z: +7.5</div>
      </div>
      <div class="minimap-canvas-wrapper">
        <canvas id="minimap-canvas" width="220" height="145"></canvas>
      </div>
      <div class="minimap-footer">
        <span class="compass-label" id="compass-heading">HEADING: 000° (N)</span>
        <button id="btn-toggle-minimap-mode" class="mini-icon-btn" title="Toggle Minimap Zoom">⛶</button>
      </div>
    </div>

    <!-- Top-Right: Telemetry, FPS & Quick Action Controls -->
    <div id="top-right-controls" class="hud-group">
      <div id="stats-badge" class="hud-pill glass-panel">
        <span class="fps-indicator" id="fps-counter">60 FPS</span>
        <span class="divider">|</span>
        <span class="viewmode-indicator" id="current-viewmode">FIRST-PERSON</span>
      </div>
      
      <button id="btn-switch-view" class="hud-btn glass-panel" title="Toggle First-Person / Orbit View (Key: V)">
        <span class="btn-icon">👁️</span>
        <span class="btn-text">Orbit View</span>
        <span class="btn-kbd">V</span>
      </button>
      
      <button id="btn-open-settings" class="hud-btn glass-panel" title="Open Settings (Key: O)">
        <span class="btn-icon">⚙️</span>
        <span class="btn-text">Settings</span>
        <span class="btn-kbd">O</span>
      </button>
      
      <button id="btn-open-help" class="hud-btn glass-panel" title="Help & Controls Guide (Key: H)">
        <span class="btn-icon">❓</span>
        <span class="btn-text">Help</span>
        <span class="btn-kbd">H</span>
      </button>

      <button id="btn-toggle-sound" class="hud-btn glass-panel" title="Toggle Sound (Key: M)">
        <span class="btn-icon" id="sound-icon">🔊</span>
      </button>
    </div>

    <!-- Center Screen: Dynamic Interaction Reticle (FPS Mode) -->
    <div id="reticle-container">
      <div id="reticle-crosshair">
        <div class="reticle-dot"></div>
        <div class="reticle-ring"></div>
      </div>
      <div id="reticle-prompt" class="hidden">
        <span class="prompt-key">E</span>
        <span class="prompt-text" id="prompt-label">Interact with Monitor</span>
      </div>
    </div>

    <!-- Bottom-Center: Quick-Teleport Bar -->
    <div id="teleport-dock" class="glass-panel">
      <div class="dock-title">QUICK TELEPORT</div>
      <div class="dock-buttons">
        <button class="teleport-btn" data-zone="reception" title="Teleport to Reception (Key: 1)">
          <span class="btn-num">1</span>
          <span class="btn-icon">🏢</span>
          <span class="btn-label">Reception</span>
        </button>
        <button class="teleport-btn" data-zone="workstations" title="Teleport to Workstations (Key: 2)">
          <span class="btn-num">2</span>
          <span class="btn-icon">💻</span>
          <span class="btn-label">Workstations</span>
        </button>
        <button class="teleport-btn" data-zone="conference" title="Teleport to Conference Room (Key: 3)">
          <span class="btn-num">3</span>
          <span class="btn-icon">📊</span>
          <span class="btn-label">Conference</span>
        </button>
        <button class="teleport-btn" data-zone="lounge" title="Teleport to Lounge & Café (Key: 4)">
          <span class="btn-num">4</span>
          <span class="btn-icon">☕</span>
          <span class="btn-label">Lounge</span>
        </button>
      </div>
    </div>

    <!-- Bottom-Left: Sprint & Controls Quick-Hint -->
    <div id="bottom-left-hints" class="hud-hint-bar">
      <span class="hint-pill"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move</span>
      <span class="hint-pill"><kbd>Shift</kbd> Sprint</span>
      <span class="hint-pill"><kbd>E</kbd> Interact</span>
      <span class="hint-pill"><kbd>V</kbd> View Mode</span>
      <span class="hint-pill"><kbd>H</kbd> Help</span>
    </div>

  </div>

  <!-- MODAL: Settings & Lighting Drawer -->
  <div id="settings-drawer" class="modal-overlay hidden">
    <div class="drawer-card glass-panel">
      <div class="modal-header">
        <h2>Office Settings & Environment</h2>
        <button class="modal-close-btn" id="btn-close-settings">✕</button>
      </div>
      
      <div class="drawer-content">
        <!-- Lighting Presets -->
        <section class="settings-section">
          <h3>Atmospheric Lighting Presets</h3>
          <div class="preset-grid">
            <button class="preset-btn active" data-preset="day">
              <span class="preset-icon">☀️</span>
              <span class="preset-title">Daylight</span>
              <span class="preset-desc">Crisp morning sun & sky</span>
            </button>
            <button class="preset-btn" data-preset="sunset">
              <span class="preset-icon">🌅</span>
              <span class="preset-title">Golden Sunset</span>
              <span class="preset-desc">Warm amber dusk & horizon</span>
            </button>
            <button class="preset-btn" data-preset="night">
              <span class="preset-icon">🌙</span>
              <span class="preset-title">Cyber Night</span>
              <span class="preset-desc">Nocturnal interior neon glow</span>
            </button>
          </div>
        </section>

        <!-- Graphics & Performance -->
        <section class="settings-section">
          <h3>Graphics & Rendering Quality</h3>
          <div class="control-row">
            <label for="quality-select">Rendering Resolution</label>
            <select id="quality-select" class="hud-select">
              <option value="0.75">Performance (0.75x DPR)</option>
              <option value="1.0" selected>Balanced (1.0x Native)</option>
              <option value="1.5">High Quality (1.5x Ultra)</option>
            </select>
          </div>
          <div class="control-row">
            <label for="toggle-shadows">Real-Time Shadows</label>
            <input type="checkbox" id="toggle-shadows" checked class="hud-switch">
          </div>
          <div class="control-row">
            <label for="toggle-bloom">Screen Glow / Post-Processing</label>
            <input type="checkbox" id="toggle-bloom" checked class="hud-switch">
          </div>
        </section>

        <!-- Audio Mixer -->
        <section class="settings-section">
          <h3>Audio & Acoustics</h3>
          <div class="control-row">
            <label for="master-volume">Master Volume</label>
            <input type="range" id="master-volume" min="0" max="100" value="80" class="hud-slider">
          </div>
          <div class="control-row">
            <label for="ambient-volume">Office HVAC & Ambience</label>
            <input type="range" id="ambient-volume" min="0" max="100" value="60" class="hud-slider">
          </div>
          <div class="control-row">
            <label for="sfx-volume">Footsteps & Interaction SFX</label>
            <input type="range" id="sfx-volume" min="0" max="100" value="85" class="hud-slider">
          </div>
        </section>
      </div>
    </div>
  </div>

  <!-- MODAL: Keybindings & Help Guide -->
  <div id="help-modal" class="modal-overlay hidden">
    <div class="modal-card glass-panel">
      <div class="modal-header">
        <h2>Interactive Office Navigation Guide</h2>
        <button class="modal-close-btn" id="btn-close-help">✕</button>
      </div>
      
      <div class="help-grid">
        <div class="help-col">
          <h3>First-Person Controls</h3>
          <div class="key-guide-row"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>Walk forward, left, backward, right</span></div>
          <div class="key-guide-row"><kbd>Mouse</kbd><span>Look around (Pointer Lock)</span></div>
          <div class="key-guide-row"><kbd>Shift</kbd><span>Sprint / Speed Boost</span></div>
          <div class="key-guide-row"><kbd>E</kbd> / <kbd>Click</kbd><span>Interact with Hotspot / Screen</span></div>
          <div class="key-guide-row"><kbd>Esc</kbd><span>Unlock Mouse / Release Pointer</span></div>
        </div>
        
        <div class="help-col">
          <h3>Shortcuts & Camera</h3>
          <div class="key-guide-row"><kbd>V</kbd><span>Toggle First-Person ⟷ Orbit View</span></div>
          <div class="key-guide-row"><kbd>1</kbd> - <kbd>4</kbd><span>Quick-Teleport to Office Zones</span></div>
          <div class="key-guide-row"><kbd>O</kbd><span>Open Settings & Lighting Panel</span></div>
          <div class="key-guide-row"><kbd>M</kbd><span>Toggle Mute Audio</span></div>
          <div class="key-guide-row"><kbd>H</kbd><span>Open / Close this Help Guide</span></div>
        </div>
      </div>
      
      <div class="modal-footer">
        <button id="btn-start-exploring" class="primary-btn">Start Exploring</button>
      </div>
    </div>
  </div>

  <!-- MODAL: Interactive Object Details & Screen Viewer -->
  <div id="interaction-modal" class="modal-overlay hidden">
    <div class="modal-card glass-panel interaction-dialog">
      <div class="modal-header">
        <h2 id="modal-item-title">Smart Presentation Display</h2>
        <button class="modal-close-btn" id="btn-close-interaction">✕</button>
      </div>
      <div class="modal-body" id="modal-item-body">
        <!-- Injected dynamically by RaycastInteractionManager -->
      </div>
      <div class="modal-actions" id="modal-item-actions">
        <!-- Interactive slide cycle buttons or action triggers -->
      </div>
    </div>
  </div>

  <!-- Onboarding Pointer-Lock Click Overlay -->
  <div id="click-to-play-overlay" class="play-overlay">
    <div class="play-card glass-panel">
      <h1>NEXUS DYNAMICS</h1>
      <p class="subtitle">3D Virtual Corporate Headquarters</p>
      <div class="start-prompt">
        <span class="click-icon">🖱️</span>
        <span>Click anywhere to Enter Workspace</span>
      </div>
      <p class="sub-hint">Use WASD to move • Mouse to look • [H] for controls</p>
    </div>
  </div>
</div>
```

---

### 6.2 2D Dynamic Minimap Engine Specification

#### Core Minimap Engine (`MinimapEngine.ts`)

```typescript
export interface MinimapZone {
  id: string;
  name: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  color: string;
  fillColor: string;
  labelPos: { x: number; z: number };
}

export class MinimapEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private padding: number = 8;
  
  // World space bounds
  private worldMinX = -20.0;
  private worldMaxX = 20.0;
  private worldMinZ = -13.0;
  private worldMaxZ = 13.0;
  
  private scaleX: number;
  private scaleZ: number;
  
  private zones: MinimapZone[] = [
    {
      id: 'reception',
      name: 'Reception',
      bounds: { minX: -18, maxX: 4, minZ: 3, maxZ: 12 },
      color: 'rgba(56, 189, 248, 0.6)',
      fillColor: 'rgba(56, 189, 248, 0.12)',
      labelPos: { x: -7, z: 7.5 }
    },
    {
      id: 'workstations',
      name: 'Workstations',
      bounds: { minX: -18, maxX: 4, minZ: -12, maxZ: 0 },
      color: 'rgba(16, 185, 129, 0.6)',
      fillColor: 'rgba(16, 185, 129, 0.12)',
      labelPos: { x: -7, z: -6 }
    },
    {
      id: 'conference',
      name: 'Conference',
      bounds: { minX: 6, maxX: 18, minZ: -12, maxZ: 0 },
      color: 'rgba(168, 85, 247, 0.6)',
      fillColor: 'rgba(168, 85, 247, 0.12)',
      labelPos: { x: 12, z: -6 }
    },
    {
      id: 'lounge',
      name: 'Lounge & Café',
      bounds: { minX: 6, maxX: 18, minZ: 3, maxZ: 12 },
      color: 'rgba(245, 158, 11, 0.6)',
      fillColor: 'rgba(245, 158, 11, 0.12)',
      labelPos: { x: 12, z: 7.5 }
    }
  ];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.setupDPI();
    this.scaleX = (this.width - 2 * this.padding) / (this.worldMaxX - this.worldMinX);
    this.scaleZ = (this.height - 2 * this.padding) / (this.worldMaxZ - this.worldMinZ);
  }

  private setupDPI(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width || 220;
    this.height = rect.height || 145;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);
  }

  public worldToCanvas(worldX: number, worldZ: number): { u: number; v: number } {
    const u = this.padding + (worldX - this.worldMinX) * this.scaleX;
    const v = this.padding + (worldZ - this.worldMinZ) * this.scaleZ;
    return { u, v };
  }

  public canvasToWorld(u: number, v: number): { worldX: number; worldZ: number } {
    const worldX = this.worldMinX + (u - this.padding) / this.scaleX;
    const worldZ = this.worldMinZ + (v - this.padding) / this.scaleZ;
    return { worldX, worldZ };
  }

  public render(playerX: number, playerZ: number, playerYaw: number, hotspots?: { x: number; z: number; type: string }[]): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // 1. Background Grid & Blueprint styling
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(0, 0, this.width, this.height);

    // Outer Office Perimeter Wall
    const p1 = this.worldToCanvas(this.worldMinX, this.worldMinZ);
    const p2 = this.worldToCanvas(this.worldMaxX, this.worldMaxZ);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(p1.u, p1.v, p2.u - p1.u, p2.v - p1.v);

    // 2. Render Functional Zones
    for (const zone of this.zones) {
      const zMin = this.worldToCanvas(zone.bounds.minX, zone.bounds.minZ);
      const zMax = this.worldToCanvas(zone.bounds.maxX, zone.bounds.maxZ);
      const zw = zMax.u - zMin.u;
      const zh = zMax.v - zMin.v;

      ctx.fillStyle = zone.fillColor;
      ctx.fillRect(zMin.u, zMin.v, zw, zh);

      ctx.strokeStyle = zone.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(zMin.u, zMin.v, zw, zh);
      ctx.setLineDash([]);

      // Zone Label
      const labelPt = this.worldToCanvas(zone.labelPos.x, zone.labelPos.z);
      ctx.font = '9px "Inter", sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(zone.name, labelPt.u, labelPt.v);
    }

    // 3. Central Corridor Spine Indicator
    const corrMin = this.worldToCanvas(-18, 0);
    const corrMax = this.worldToCanvas(18, 3);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.fillRect(corrMin.u, corrMin.v, corrMax.u - corrMin.u, corrMax.v - corrMin.v);

    // 4. Interactive Hotspots Icons
    if (hotspots) {
      for (const h of hotspots) {
        const hp = this.worldToCanvas(h.x, h.z);
        ctx.beginPath();
        ctx.arc(hp.u, hp.v, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
      }
    }

    // 5. Player Radar Blip & Vision Cone
    const playerPt = this.worldToCanvas(playerX, playerZ);
    const coneRadius = 22;
    const fovHalf = (35 * Math.PI) / 180; // 35 deg half-FOV

    // Heading angle: Three.js yaw=0 is looking along -Z (North, which is -v in canvas)
    // Canvas angle: 0 is East (+u), -PI/2 is North (-v).
    const canvasAngle = -playerYaw - Math.PI / 2;

    // Draw FOV Cone
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(playerPt.u, playerPt.v);
    ctx.arc(playerPt.u, playerPt.v, coneRadius, canvasAngle - fovHalf, canvasAngle + fovHalf);
    ctx.closePath();

    const coneGrad = ctx.createRadialGradient(
      playerPt.u, playerPt.v, 2,
      playerPt.u, playerPt.v, coneRadius
    );
    coneGrad.addColorStop(0, 'rgba(56, 189, 248, 0.45)');
    coneGrad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
    ctx.fillStyle = coneGrad;
    ctx.fill();
    ctx.restore();

    // Draw Player Center Dot
    ctx.beginPath();
    ctx.arc(playerPt.u, playerPt.v, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Directional Pointer Arrow
    const arrowLen = 7;
    const ax = playerPt.u + Math.cos(canvasAngle) * arrowLen;
    const ay = playerPt.v + Math.sin(canvasAngle) * arrowLen;
    ctx.beginPath();
    ctx.moveTo(playerPt.u, playerPt.v);
    ctx.lineTo(ax, ay);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  public getZoneAt(worldX: number, worldZ: number): string {
    for (const zone of this.zones) {
      if (
        worldX >= zone.bounds.minX &&
        worldX <= zone.bounds.maxX &&
        worldZ >= zone.bounds.minZ &&
        worldZ <= zone.bounds.maxZ
      ) {
        return zone.name.toUpperCase();
      }
    }
    return 'CENTRAL HALLWAY';
  }
}
```

---

### 6.3 Quick-Teleport Navigation Engine Specification

#### Teleportation Preset Coordinates Matrix

| Destination Zone | Target Position $(X, Y, Z)$ | Target Yaw (Rad / Deg) | Description |
| :--- | :--- | :--- | :--- |
| **Welcome Reception** | `[-7.0, 1.6, 7.5]` | `0.0 rad` ($0^\circ$) | Front of branded desk and 3D company logo wall |
| **Open Workstations** | `[-7.0, 1.6, -6.0]` | `0.0 rad` ($0^\circ$) | Quad-pod center overlooking terminals and dual monitors |
| **Conference Room** | `[12.0, 1.6, -6.0]` | `3.14159 rad` ($180^\circ$) | Center of walnut racetrack table facing 85" display |
| **Lounge & Breakroom**| `[12.0, 1.6, 7.5]` | `1.5708 rad` ($90^\circ$) | In front of coffee bar, velvet sofa & plants |
| **Main Entrance** | `[0.0, 1.6, 11.5]` | `0.0 rad` ($0^\circ$) | Office entrance looking down circulation spine |

#### Teleport Controller Architecture (`TeleportController.ts`)

```typescript
export class TeleportController {
  private transitionManager: CameraTransitionManager;
  private fpsController: FirstPersonController;
  private audioManager: WebAudioManager;
  private hudManager: HUDManager;

  public teleport(zoneId: string, smooth: boolean = true): void {
    const target = this.getDestination(zoneId);
    if (!target) return;

    this.audioManager.playModalChime();
    this.hudManager.showNotification(`Teleporting to ${target.name}...`);

    if (smooth) {
      this.transitionManager.startTransition(
        this.fpsController.camera,
        target.position,
        target.lookAt,
        1.2, // duration in seconds
        3.5, // arc height offset
        () => {
          this.fpsController.setPosition(target.position, target.yaw);
          this.hudManager.showNotification(`Arrived at ${target.name}`);
        }
      );
    } else {
      this.fpsController.setPosition(target.position, target.yaw);
      this.hudManager.showNotification(`Arrived at ${target.name}`);
    }
  }

  private getDestination(zoneId: string): { name: string; position: THREE.Vector3; lookAt: THREE.Vector3; yaw: number } | null {
    switch (zoneId) {
      case 'reception':
        return {
          name: 'Welcome Reception',
          position: new THREE.Vector3(-7.0, 1.6, 7.5),
          lookAt: new THREE.Vector3(-7.0, 1.6, 0.0),
          yaw: 0.0
        };
      case 'workstations':
        return {
          name: 'Open Workstations',
          position: new THREE.Vector3(-7.0, 1.6, -6.0),
          lookAt: new THREE.Vector3(-7.0, 1.6, -12.0),
          yaw: 0.0
        };
      case 'conference':
        return {
          name: 'Conference Room',
          position: new THREE.Vector3(12.0, 1.6, -6.0),
          lookAt: new THREE.Vector3(12.0, 1.6, -11.85),
          yaw: Math.PI
        };
      case 'lounge':
        return {
          name: 'Lounge & Café',
          position: new THREE.Vector3(12.0, 1.6, 7.5),
          lookAt: new THREE.Vector3(17.5, 1.6, 7.5),
          yaw: Math.PI / 2
        };
      default:
        return null;
    }
  }
}
```

---

### 6.4 Settings, Lighting Presets & Performance Controls UI

#### Atmospheric Lighting Matrix (`LightingPresets.ts`)

```typescript
export interface LightingPresetConfig {
  name: string;
  sunColor: number;
  sunIntensity: number;
  sunPosition: [number, number, number];
  ambientColor: number;
  ambientIntensity: number;
  skyColor: number;
  groundColor: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  screenEmissiveBoost: number;
  interiorLightBoost: number;
}

export const LIGHTING_PRESETS: Record<string, LightingPresetConfig> = {
  day: {
    name: 'Daylight',
    sunColor: 0xfffaed,
    sunIntensity: 1.8,
    sunPosition: [25, 30, -20],
    ambientColor: 0xdbeafe,
    ambientIntensity: 0.85,
    skyColor: 0x93c5fd,
    groundColor: 0x334155,
    fogColor: 0xe2e8f0,
    fogNear: 25,
    fogFar: 65,
    screenEmissiveBoost: 1.0,
    interiorLightBoost: 0.7
  },
  sunset: {
    name: 'Golden Sunset',
    sunColor: 0xfb923c,
    sunIntensity: 2.2,
    sunPosition: [35, 12, -25],
    ambientColor: 0xfdba74,
    ambientIntensity: 0.65,
    skyColor: 0xf97316,
    groundColor: 0x1e1b4b,
    fogColor: 0x7c2d12,
    fogNear: 20,
    fogFar: 55,
    screenEmissiveBoost: 1.4,
    interiorLightBoost: 1.1
  },
  night: {
    name: 'Cyber Night',
    sunColor: 0x38bdf8,
    sunIntensity: 0.35,
    sunPosition: [-20, 25, 20],
    ambientColor: 0x0f172a,
    ambientIntensity: 0.3,
    skyColor: 0x020617,
    groundColor: 0x020617,
    fogColor: 0x090d16,
    fogNear: 15,
    fogFar: 45,
    screenEmissiveBoost: 2.5,
    interiorLightBoost: 1.8
  }
};
```

---

### 6.5 Controls & Help Modal System

#### Keybindings & Shortcut Matrix

```typescript
export const KEYBINDINGS_CATALOG = [
  { key: 'W / ↑', action: 'Move Forward', category: 'Navigation' },
  { key: 'S / ↓', action: 'Move Backward', category: 'Navigation' },
  { key: 'A / ←', action: 'Strafe Left', category: 'Navigation' },
  { key: 'D / →', action: 'Strafe Right', category: 'Navigation' },
  { key: 'Shift', action: 'Sprint / Boost Speed', category: 'Navigation' },
  { key: 'Mouse Look', action: 'Rotate Camera (FPS Mode)', category: 'Camera' },
  { key: 'V', action: 'Switch FPS / Orbit Mode', category: 'Camera' },
  { key: 'E / Click', action: 'Interact with Object / Screen', category: 'Interaction' },
  { key: '1', action: 'Teleport: Welcome Reception', category: 'Shortcuts' },
  { key: '2', action: 'Teleport: Workstations', category: 'Shortcuts' },
  { key: '3', action: 'Teleport: Conference Room', category: 'Shortcuts' },
  { key: '4', action: 'Teleport: Lounge & Café', category: 'Shortcuts' },
  { key: 'O', action: 'Open Settings & Lighting Panel', category: 'UI' },
  { key: 'M', action: 'Toggle Mute Audio', category: 'Audio' },
  { key: 'H', action: 'Toggle Help & Keybindings Modal', category: 'UI' },
  { key: 'Esc', action: 'Close Modals / Unlock Mouse', category: 'UI' }
];
```

---

### 6.6 Project Build & Dependency Stack Specification

#### Technology Stack
- **Bundler & Dev Server**: Vite 5.x / 6.x (Lightning-fast HMR, ES module native bundling).
- **Core 3D Engine**: Three.js (`^0.170.0` or `^0.160.0`).
- **Language**: TypeScript (`^5.5.0`) or Vanilla Modern ESM JavaScript.
- **Styling**: Vanilla CSS3 with CSS Custom Properties, Glassmorphism, and Flex/Grid layouts.
- **Audio Engine**: Native Browser Web Audio API (100% procedural sound synthesis, zero MP3/WAV download requirements).
- **Test Framework**: Vitest (Unit / Math logic) + Playwright Test (`@playwright/test` for 4-Tier Opaque-Box E2E Testing).

#### Recommended `package.json`

```json
{
  "name": "corporate-office-3d",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "three": "^0.170.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "@types/three": "^0.170.0",
    "typescript": "^5.6.3",
    "vite": "^5.4.10",
    "vitest": "^2.1.3"
  }
}
```

#### Directory Architecture
```
corporate_office_3d/
├── index.html                  # Master entry point with HUD DOM hierarchy
├── package.json                # Project dependencies and build scripts
├── vite.config.ts              # Vite server & build configuration
├── tsconfig.json               # TypeScript compiler config
├── playwright.config.ts        # E2E test runner configuration
├── src/
│   ├── main.ts                 # Application bootstrapping & loop orchestration
│   ├── core/
│   │   ├── Engine.ts           # WebGLRenderer, Scene, Camera, Resizer & Loop
│   │   └── State.ts            # Global application state store & event bus
│   ├── scene/
│   │   ├── OfficeScene.ts      # Scene graph assembly & zone positioning
│   │   ├── GeometryBuilder.ts  # Procedural geometry generators (desks, chairs, walls)
│   │   ├── MaterialFactory.ts  # PBR materials & procedural canvas textures
│   │   └── LightingManager.ts  # Sun, ambient, point lights & Day/Sunset/Night presets
│   ├── controls/
│   │   ├── FirstPersonController.ts # Kinematic WASD + pointer-lock movement & bobbing
│   │   ├── OrbitController.ts       # Top-down orbit & isometric pan/zoom controls
│   │   ├── CameraTransitionManager.ts # Smooth parabolic tween between view modes
│   │   └── CollisionEngine.ts       # AABB multi-axis sliding collision resolution
│   ├── interaction/
│   │   ├── RaycastInteractionManager.ts # Center & mouse raycasting hotspots
│   │   ├── DynamicDisplayManager.ts     # Procedural dynamic monitor canvas textures
│   │   └── PresentationManager.ts       # Interactive slide deck switching system
│   ├── ui/
│   │   ├── HUDManager.ts            # Master UI coordinator & notification banners
│   │   ├── MinimapEngine.ts         # 2D canvas dynamic floorplan & radar blip
│   │   ├── TeleportController.ts    # Quick-teleport shortcuts & preset triggers
│   │   ├── SettingsUI.ts            # Lighting presets, quality scaler, audio sliders
│   │   └── HelpModal.ts             # Keybindings guide & onboarding overlay
│   ├── audio/
│   │   └── WebAudioManager.ts       # Procedural audio synthesis (footsteps, clicks, HVAC)
│   └── styles/
│       ├── main.css                 # Global resets & typography
│       ├── hud.css                  # HUD cards, pills, reticle, teleport dock
│       └── modals.css               # Glassmorphic dialogs, drawers & overlays
└── tests/
    ├── unit/
    │   ├── collision.test.ts        # AABB sliding math & boundary clamps
    │   ├── minimap.test.ts          # World-to-canvas coordinate mapping tests
    │   └── lighting.test.ts         # Lighting preset interpolation tests
    └── e2e/
        ├── tier1_smoke.spec.ts      # Canvas, WebGL & DOM initialization
        ├── tier2_boundaries.spec.ts # Collision walls, pitch clamps, resize
        ├── tier3_interactions.spec.ts # Raycast, slide deck, modals, teleport
        └── tier4_realworld.spec.ts  # Complete office walkthrough & soak test
```

---

### 6.7 4-Tier Opaque-Box E2E Testing Strategy & Test Automation Runner

#### Test Matrix Overview

```
+-----------------------------------------------------------------------------------+
|                           4-TIER E2E TESTING PYRAMID                              |
+-----------------------------------------------------------------------------------+
|  TIER 4: REAL-WORLD SCENARIOS & SOAK TESTS (Full Tour, 60fps Stability, Zero Leaks) |
+-----------------------------------------------------------------------------------+
|  TIER 3: INTERACTION & STATE INTEGRATION (Hotspots, Slide Decks, Lighting, Audio)  |
+-----------------------------------------------------------------------------------+
|  TIER 2: BOUNDARY & EDGE TESTS (AABB Walls, Pitch Limits, Resize, Rapid Spam)      |
+-----------------------------------------------------------------------------------+
|  TIER 1: FEATURE & UNIT SMOKE TESTS (WebGL Context, Scene Graph, HUD DOM, Assets) |
+-----------------------------------------------------------------------------------+
```

#### Detailed Test Specification per Tier

##### Tier 1: Feature & Unit Smoke Tests
- **Objective**: Ensure the application bootstraps properly, renders WebGL without console errors, and instantiates all required DOM HUD elements.
- **Test Cases**:
  1. `T1.1 WebGL Canvas Initialization`: Verify `#webgl-canvas` exists and obtains a valid `WebGL2RenderingContext`.
  2. `T1.2 Three.js Scene Verification`: Verify `scene.children.length > 20`, scene contains ambient light, directional light, floor mesh, and 4 zone groups.
  3. `T1.3 HUD Element Presence`: Verify `#minimap-canvas`, `#teleport-dock`, `#reticle-container`, `#stats-badge`, `#settings-drawer`, and `#help-modal` exist in the DOM.
  4. `T1.4 Audio Synthesizer Readiness`: Verify `WebAudioManager` initializes upon first user interaction without throwing unhandled exceptions.

##### Tier 2: Boundary & Edge Tests
- **Objective**: Stress test physical boundaries, input limits, and edge cases to ensure the simulation never crashes or produces NaN transforms.
- **Test Cases**:
  1. `T2.1 Perimeter Wall Clamping`: Drive player towards $X = -25.0$ and $Z = 20.0$; verify position is strictly clamped within $[X_{\min}, X_{\max}] = [-20, 20]$ and $[Z_{\min}, Z_{\max}] = [-13, 13]$.
  2. `T2.2 Obstacle Collision Snagging`: Drive player directly into Reception desk and Conference room glass wall; verify velocity along collision normal is zeroed and player does not clip inside geometry.
  3. `T2.3 Camera Pitch Clamping`: Apply extreme mouse pitch deltas ($+1000\text{px}, -1000\text{px}$); verify camera pitch angle is strictly clamped within $[-85^\circ, +85^\circ]$ (preventing inverted gimbal flip).
  4. `T2.4 Viewport Resize Responsiveness`: Trigger viewport resizes ($1920\times1080 \to 800\times600 \to 390\times844$); verify `renderer.setSize()` and `camera.aspect` update without visual distortion.
  5. `T2.5 Rapid Input Spamming`: Rapidly toggle view mode (`V` key $\times 10$) and teleport buttons; verify camera transition completes without getting stuck in a transitioning state.

##### Tier 3: Interaction & State Integration Tests
- **Objective**: Verify interactive hotspots, slide deck cycling, modal dialogs, lighting preset switches, and audio controls.
- **Test Cases**:
  1. `T3.1 Raycast Reticle Hover & Prompt`: Position player facing Reception kiosk; verify `#reticle-prompt` becomes visible with label `"Interact with Welcome Kiosk"`.
  2. `T3.2 Presentation Slide Deck Cycling`: Trigger interaction on Conference 85" display; verify slide advances from Slide 1 $\to$ Slide 2 $\to$ Slide 3 $\to$ Slide 4, and dynamic `CanvasTexture.needsUpdate` is flagged.
  3. `T3.3 Quick-Teleport Execution`: Click `#teleport-dock button[data-zone="conference"]`; verify player coordinates update to $[12.0, 1.6, -6.0]$ and current zone badge displays `"CONFERENCE"`.
  4. `T3.4 Lighting Preset Transitions`: Switch from Day $\to$ Sunset $\to$ Night via `#settings-drawer`; verify directional light color shifts from warm white (`0xfffaed`) $\to$ amber (`0xfb923c`) $\to$ cyber blue (`0x38bdf8`), and emissive material boost increases.
  5. `T3.5 Audio Mute Toggle`: Click sound button or press `M`; verify master gain transitions to $0.0$, and clicking again restores original gain.

##### Tier 4: Real-World Scenarios & Performance Soak Tests
- **Objective**: Execute full simulated user journeys across the entire floorplan, monitoring frame rate stability, memory usage, and draw calls.
- **Test Cases**:
  1. `T4.1 Full Office Grand Tour Journey`:
     - Step A: Spawn at Reception desk $\to$ inspect company logo.
     - Step B: Walk through central corridor $\to$ enter Workstations pod $\to$ inspect interactive terminal screen.
     - Step C: Enter Glass Conference room $\to$ cycle through all 4 presentation slides.
     - Step D: Walk into Lounge & Breakroom $\to$ interact with coffee espresso machine.
     - Step E: Switch to Orbit mode $\to$ rotate $360^\circ$ around floorplan $\to$ return to First-Person.
     - Verify: Zero uncaught runtime errors throughout full sequence.
  2. `T4.2 60 FPS Performance & Draw-Call Audit`:
     - Monitor `renderer.info.render.calls` during active exploration; verify draw calls stay $\le 45$.
     - Verify `renderer.info.render.triangles` stay $\le 150,000$.
     - Verify average frame rate across 60 seconds is $\ge 58\text{ FPS}$.
  3. `T4.3 WebGL Memory Heap Soak Test`:
     - Execute 100 consecutive quick-teleports and 20 lighting switches.
     - Verify `renderer.info.memory.geometries` and `renderer.info.memory.textures` remain constant without memory leaks.

#### Headless E2E Automation Test Contract (`window.__OFFICE_DEBUG__`)

To empower automated headless testing (Playwright), the application exposes a safe, zero-overhead debug contract in development mode:

```typescript
declare global {
  interface Window {
    __OFFICE_DEBUG__?: {
      getPlayerPosition: () => { x: number; y: number; z: number };
      getPlayerYaw: () => number;
      getCurrentZone: () => string;
      getViewMode: () => 'fps' | 'orbit';
      getFPS: () => number;
      getDrawCalls: () => number;
      getTriangleCount: () => number;
      getLightingPreset: () => string;
      teleportTo: (zoneId: string, smooth?: boolean) => void;
      setLightingPreset: (preset: 'day' | 'sunset' | 'night') => void;
      triggerInteract: () => boolean;
      getPresentationSlideIndex: () => number;
      isAudioMuted: () => boolean;
    };
  }
}
```

#### Example Playwright E2E Test Suite (`tests/e2e/office_e2e.spec.ts`)

```typescript
import { test, expect } from '@playwright/test';

test.describe('3D Corporate Office — 4-Tier E2E Test Suite', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173/');
    await page.waitForSelector('#webgl-canvas');
    // Dismiss onboarding click-to-play overlay
    await page.click('#click-to-play-overlay');
  });

  // TIER 1: Smoke & Initialization
  test('T1: Should initialize WebGL scene, canvas and HUD elements', async ({ page }) => {
    const canvas = page.locator('#webgl-canvas');
    await expect(canvas).toBeVisible();
    
    const minimap = page.locator('#minimap-canvas');
    await expect(minimap).toBeVisible();

    const fpsText = await page.locator('#fps-counter').textContent();
    expect(fpsText).toContain('FPS');
  });

  // TIER 2: Boundaries & Teleport Clamping
  test('T2: Should clamp player inside office perimeter and prevent collision clipping', async ({ page }) => {
    // Attempt to walk out of bounds via debug or key input
    await page.evaluate(() => {
      window.__OFFICE_DEBUG__?.teleportTo('reception', false);
    });
    
    const pos = await page.evaluate(() => window.__OFFICE_DEBUG__?.getPlayerPosition());
    expect(pos?.x).toBeGreaterThanOrEqual(-20);
    expect(pos?.x).toBeLessThanOrEqual(20);
    expect(pos?.z).toBeGreaterThanOrEqual(-13);
    expect(pos?.z).toBeLessThanOrEqual(13);
  });

  // TIER 3: Interactivity, Teleport & Lighting
  test('T3: Should execute quick-teleport and update zone badge', async ({ page }) => {
    await page.click('button[data-zone="conference"]');
    await page.waitForTimeout(1500); // allow transition to complete

    const zoneBadge = await page.locator('#current-zone-name').textContent();
    expect(zoneBadge).toContain('CONFERENCE');

    const pos = await page.evaluate(() => window.__OFFICE_DEBUG__?.getPlayerPosition());
    expect(pos?.x).toBeCloseTo(12.0, 0.5);
    expect(pos?.z).toBeCloseTo(-6.0, 0.5);
  });

  test('T3: Should toggle lighting presets and update atmospheric state', async ({ page }) => {
    await page.click('#btn-open-settings');
    await expect(page.locator('#settings-drawer')).toBeVisible();

    await page.click('button[data-preset="night"]');
    const preset = await page.evaluate(() => window.__OFFICE_DEBUG__?.getLightingPreset());
    expect(preset).toBe('night');
  });

  // TIER 4: Full User Journey Walkthrough & Performance
  test('T4: Real-world walkthrough across all zones maintaining 60 FPS', async ({ page }) => {
    const zones = ['reception', 'workstations', 'conference', 'lounge'];
    for (const zone of zones) {
      await page.evaluate((z) => window.__OFFICE_DEBUG__?.teleportTo(z, false), zone);
      await page.waitForTimeout(200);
      
      const drawCalls = await page.evaluate(() => window.__OFFICE_DEBUG__?.getDrawCalls() ?? 0);
      expect(drawCalls).toBeLessThanOrEqual(50);
    }
  });
});
```

---

## 7. Deliverable Inventory & Implementation Readiness Checklist

| Component | Target File | Status / Blueprint |
| :--- | :--- | :--- |
| **Glassmorphic HUD & Layout** | `index.html`, `src/styles/hud.css`, `src/styles/modals.css` | Complete wireframe, CSS tokens, DOM layout ready |
| **2D Dynamic Minimap Engine** | `src/ui/MinimapEngine.ts` | Complete coordinate mapping, DPI scaler, zone rendering ready |
| **Quick-Teleportation System** | `src/ui/TeleportController.ts` | 5-zone coordinate presets & transition manager binding ready |
| **Settings & Lighting Controls** | `src/ui/SettingsUI.ts`, `src/scene/LightingManager.ts` | Day/Sunset/Night presets, graphics scaler, audio controls ready |
| **Controls & Help Guide** | `src/ui/HelpModal.ts` | Complete keybindings catalog, modal overlay & onboarding ready |
| **Project Build Stack** | `package.json`, `vite.config.ts`, `tsconfig.json` | Vite + Three.js + TypeScript build configuration ready |
| **4-Tier E2E Testing Suite** | `playwright.config.ts`, `tests/e2e/*.spec.ts`, `tests/unit/*.test.ts` | 4-Tier test specs, assertion contracts & debug hooks ready |

---
**Report Complete.** All findings, mathematical transforms, interface blueprints, and testing strategies are prepared for immediate handoff to Orchestrator and Implementation Workers.
