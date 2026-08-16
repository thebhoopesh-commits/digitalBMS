# Handoff Report: Milestone 1 Scaffolding, Build Infrastructure & Core TypeScript Architecture

**Agent**: `teamwork_preview_explorer_m1_1`  
**Milestone**: M1 (Core Engine, Scaffolding & 3D Scene Architecture)  
**Date**: 2026-08-15  
**Working Directory**: `C:\Users\thebh\.gemini\antigravity\scratch\corporate_office_3d\.agents\teamwork_preview_explorer_m1_1`

---

## 1. Observation

Direct observations from inspecting `ORIGINAL_REQUEST.md`, `PROJECT.md`, `TEST_INFRA.md`, and the architectural environment:

1. **System & Scope Requirements**:
   - `ORIGINAL_REQUEST.md`: R1 (Multi-zone layout & PBR assets), R2 (Dual navigation FPS/Orbit & AABB collision), R3 (Raycasting interactions, dynamic canvas screens, audio), R4 (2D Minimap, quick teleport, glassmorphic HUD, settings), R5 (60 FPS optimization, standalone local execution).
   - `PROJECT.md`: Detailed module layout spanning `src/scene`, `src/navigation`, `src/interaction`, `src/audio`, `src/ui`, `src/types`, and `tests/e2e`.
   - `TEST_INFRA.md`: 4-Tier E2E test harness relying on `window.__OFFICE_DEBUG__` automation contract with Playwright headless WebGL execution.

2. **Core Dependencies Baseline**:
   - Three.js: `three@^0.160.0` with `@types/three@^0.160.0`.
   - Build Tooling: `vite@^5.0.12` with `typescript@^5.3.3` targeting `ES2022`/`ESNext`.
   - Test Framework: `@playwright/test@^1.41.0` with `@types/node@^20.11.0`.

3. **Current Workspace State**:
   - The root workspace `C:\Users\thebh\.gemini\antigravity\scratch\corporate_office_3d` is a clean greenfield repository ready for immediate instantiation of scaffolding configuration files, DOM template, and shared interface contracts.

---

## 2. Logic Chain

1. **Why Vite + TypeScript ESNext (`bundler` module resolution)?**
   - Three.js r160+ uses modern ES modules and `three/addons/*` imports (such as `OrbitControls`, `BufferGeometryUtils`).
   - Vite provides lightning-fast HMR (<50ms), native TypeScript transpilation with zero config bloat, and tree-shakeable production builds.
   - Using `"moduleResolution": "bundler"` in `tsconfig.json` ensures seamless resolution of Three.js addon subpaths and absolute path aliases (`@/*` -> `src/*`).

2. **Why Pure Standard Web APIs & Zero External Runtime Dependencies?**
   - Avoids third-party CSS/UI bloat (no React/Vue/Tailwind runtime overhead), keeping bundle size < 500 KB gzipped.
   - Canvas-based procedural textures and Web Audio synthesis eliminate external binary file loading failures, asset 404s, CORS restrictions, and network latency.

3. **Why Structured Glassmorphic HUD & Dedicated Mount Containers in `index.html`?**
   - The WebGL `<canvas>` requires an absolute-positioned container (`#webgl-container`) with `overflow: hidden` and `touch-action: none`.
   - The HUD overlay (`#hud-layer`) sits on top with `pointer-events: none`, enabling HUD child elements (`pointer-events: auto`) to receive clicks while allowing mouse movement and pointer lock to pass through to the 3D canvas unimpeded.

4. **Why Strict Centralized Type System (`src/types/index.ts`)?**
   - All 5 subsequent milestones (M1 through M5) and the parallel E2E testing track depend on shared contracts.
   - Centralizing all interfaces (`ISceneManager`, `INavigationManager`, `IInteractionManager`, `IAudioManager`, `IHUDManager`, `IMinimap`, and `IOfficeDebug`) ensures 100% compile-time type safety, zero circular dependency bugs, and seamless integration with Playwright test specs.

---

## 3. Caveats

1. **AudioContext Autoplay Policy**: Modern browsers block `AudioContext` until the user interacts with the page. The scaffolding in `index.html` includes an initial click-to-start overlay (`#overlay-start`) that initializes both `AudioContext` and Pointer Lock upon first user interaction.
2. **WebGL Context Loss & High-DPI Scaling**: High-DPI screens (e.g. Retina / 4K) can cause frame drops if `devicePixelRatio` exceeds 2.0. The `ISceneManager` quality setting caps DPR dynamically (`Math.min(window.devicePixelRatio, qualityDpr)`).
3. **Pointer Lock API Lifecycle**: In FPS mode, pressing `Escape` or clicking UI modals automatically exits pointer lock. The HUD and Navigation subsystems must properly synchronize pointer lock state transitions.

---

## 4. Conclusion & Concrete Implementation Blueprints

The concrete implementation strategy for Milestone 1 scaffolding is formulated below. Milestone Workers can directly write these exact file contents to initialize the repository.

---

### Blueprint 1: `package.json`
**Target Path**: `corporate_office_3d/package.json`

```json
{
  "name": "corporate-office-3d",
  "version": "1.0.0",
  "description": "High-performance immersive 3D corporate office web application built with Three.js and TypeScript",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview --port 3000",
    "typecheck": "tsc --noEmit",
    "test": "playwright test",
    "test:tier1": "playwright test tests/e2e/tier1-feature.spec.ts",
    "test:tier2": "playwright test tests/e2e/tier2-boundary.spec.ts",
    "test:tier3": "playwright test tests/e2e/tier3-combination.spec.ts",
    "test:tier4": "playwright test tests/e2e/tier4-scenario.spec.ts",
    "test:headed": "playwright test --headed"
  },
  "dependencies": {
    "three": "^0.160.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.41.0",
    "@types/node": "^20.11.0",
    "@types/three": "^0.160.0",
    "typescript": "^5.3.3",
    "vite": "^5.0.12"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

---

### Blueprint 2: `tsconfig.json`
**Target Path**: `corporate_office_3d/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,

    /* Strict Type-Checking Options */
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": false,
    "noImplicitThis": true,
    "alwaysStrict": true,

    /* Additional Quality Checks */
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": false,

    /* Path Aliases & Interop */
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": [
    "src/**/*.ts",
    "src/**/*.d.ts",
    "tests/**/*.ts",
    "vite.config.ts"
  ]
}
```

---

### Blueprint 3: `vite.config.ts`
**Target Path**: `corporate_office_3d/vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: './',
  base: './',
  server: {
    port: 3000,
    host: true,
    open: false,
    strictPort: false
  },
  preview: {
    port: 3000,
    host: true,
    strictPort: false
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html')
      }
    }
  }
});
```

---

### Blueprint 4: `index.html`
**Target Path**: `corporate_office_3d/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
  <title>Aura Corp 3D — Virtual Office Headquarters</title>
  <meta name="description" content="Immersive 3D Corporate Office with First-Person & Orbit navigation, interactive screens, and spatial audio built with Three.js" />
  <link rel="stylesheet" href="/src/ui/styles.css" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
</head>
<body>
  <div id="app">
    <!-- WebGL Canvas Viewport -->
    <div id="webgl-container"></div>

    <!-- HUD Overlay Layer -->
    <div id="hud-layer">
      <!-- Top Navigation & Status Bar -->
      <header class="hud-header">
        <div class="hud-brand">
          <div class="brand-logo-icon">🏢</div>
          <div class="brand-info">
            <span class="brand-name">AURA HQ</span>
            <span class="brand-tag">3D WORKSPACE</span>
          </div>
        </div>

        <div class="hud-center-status">
          <div id="zone-banner" class="hud-pill zone-pill">
            <span class="status-pulse-dot"></span>
            <span id="zone-text">Reception & Welcome</span>
          </div>
          <div id="mode-badge" class="hud-pill mode-pill mode-fps">
            <span class="mode-icon">👁️</span>
            <span id="mode-text">FPS WALKTHROUGH</span>
          </div>
        </div>

        <div class="hud-header-right">
          <div id="perf-stats" class="hud-pill perf-pill" title="Performance Telemetry">
            <span id="fps-stat">60 FPS</span>
            <span class="stat-divider">|</span>
            <span id="draw-stat">36 DC</span>
            <span class="stat-divider">|</span>
            <span id="poly-stat">45k Tri</span>
          </div>
        </div>
      </header>

      <!-- Center Crosshair / Reticle for FPS Mode -->
      <div id="reticle" class="reticle reticle-idle">
        <div class="reticle-center-dot"></div>
        <div class="reticle-outer-ring"></div>
      </div>

      <!-- Contextual Interaction Prompt -->
      <div id="interaction-prompt" class="interaction-prompt hidden">
        <span class="prompt-key-badge">[E]</span>
        <span id="prompt-action-text">Interact</span>
      </div>

      <!-- Real-Time Minimap & Teleport Dock -->
      <aside id="minimap-container" class="minimap-container">
        <div class="minimap-header">
          <div class="minimap-title-row">
            <span class="radar-dot"></span>
            <span class="minimap-label">SPATIAL RADAR</span>
          </div>
          <button id="btn-toggle-minimap" class="icon-btn" title="Toggle Minimap">➖</button>
        </div>
        <div class="minimap-canvas-wrapper">
          <canvas id="minimap-canvas" width="220" height="143"></canvas>
        </div>
        <div class="quick-teleport-grid">
          <button class="teleport-btn" data-zone="reception" title="Jump to Reception (Key 1)">
            <span class="tp-num">1</span> Reception
          </button>
          <button class="teleport-btn" data-zone="workstations" title="Jump to Workstations (Key 2)">
            <span class="tp-num">2</span> Desks
          </button>
          <button class="teleport-btn" data-zone="conference" title="Jump to Conference (Key 3)">
            <span class="tp-num">3</span> Conf. Room
          </button>
          <button class="teleport-btn" data-zone="lounge" title="Jump to Lounge (Key 4)">
            <span class="tp-num">4</span> Lounge
          </button>
        </div>
      </aside>

      <!-- Bottom Action Bar -->
      <footer class="hud-footer">
        <div class="hud-controls-toolbar">
          <button id="btn-mode-toggle" class="toolbar-btn" title="Switch View Mode [V / Tab]">
            <span class="btn-icon">🔄</span>
            <span class="btn-text">Orbit View [V]</span>
          </button>
          <button id="btn-settings" class="toolbar-btn" title="Open Settings Drawer [O]">
            <span class="btn-icon">⚙️</span>
            <span class="btn-text">Settings</span>
          </button>
          <button id="btn-help" class="toolbar-btn" title="Controls & Shortcuts Guide [H]">
            <span class="btn-icon">❓</span>
            <span class="btn-text">Guide [H]</span>
          </button>
          <button id="btn-audio-mute" class="toolbar-btn icon-only" title="Toggle Sound [M]">
            <span class="btn-icon" id="audio-icon">🔊</span>
          </button>
        </div>
      </footer>

      <!-- Slide-Out Settings & Customization Drawer -->
      <div id="settings-drawer" class="settings-drawer hidden">
        <div class="drawer-header">
          <h3>Workspace Settings</h3>
          <button id="btn-close-settings" class="icon-btn" title="Close Settings">✕</button>
        </div>
        <div class="drawer-content">
          <!-- Lighting Presets Section -->
          <div class="setting-group">
            <label class="setting-label">Atmospheric Lighting</label>
            <div class="preset-button-row">
              <button class="preset-btn active" data-preset="day">
                <span class="preset-icon">☀️</span> Day
              </button>
              <button class="preset-btn" data-preset="sunset">
                <span class="preset-icon">🌅</span> Sunset
              </button>
              <button class="preset-btn" data-preset="night">
                <span class="preset-icon">🌙</span> Night
              </button>
            </div>
          </div>

          <!-- Graphics & Rendering Section -->
          <div class="setting-group">
            <label class="setting-label">Graphics Quality</label>
            <div class="setting-row">
              <span>Dynamic Shadows</span>
              <label class="toggle-switch">
                <input type="checkbox" id="toggle-shadows" checked />
                <span class="slider"></span>
              </label>
            </div>
            <div class="setting-row">
              <span>DPR Resolution</span>
              <select id="select-quality" class="setting-select">
                <option value="performance">Performance (0.75x)</option>
                <option value="standard" selected>Balanced (1.0x)</option>
                <option value="high">High Detail (1.5x)</option>
                <option value="ultra">Ultra Native (2.0x)</option>
              </select>
            </div>
          </div>

          <!-- Audio Mixer Section -->
          <div class="setting-group">
            <label class="setting-label">Audio Environment</label>
            <div class="setting-row">
              <span>Master Volume</span>
              <input type="range" id="slider-volume" min="0" max="1" step="0.05" value="0.7" class="setting-range" />
            </div>
            <div class="setting-row">
              <span>Ambient Office Hum</span>
              <label class="toggle-switch">
                <input type="checkbox" id="toggle-ambient" checked />
                <span class="slider"></span>
              </label>
            </div>
            <div class="setting-row">
              <span>Interaction & Footstep SFX</span>
              <label class="toggle-switch">
                <input type="checkbox" id="toggle-sfx" checked />
                <span class="slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- Controls & Help Modal -->
      <div id="help-modal" class="modal-backdrop hidden">
        <div class="modal-dialog">
          <div class="modal-header">
            <h3>Navigation & Controls Guide</h3>
            <button id="btn-close-help" class="icon-btn">✕</button>
          </div>
          <div class="modal-body">
            <div class="controls-grid">
              <div class="control-item"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>Walk in First-Person</span></div>
              <div class="control-item"><kbd>Shift</kbd><span>Sprint / Fast Run (1.8x)</span></div>
              <div class="control-item"><kbd>Mouse Look</kbd><span>Aim & Look Around (Click canvas to lock)</span></div>
              <div class="control-item"><kbd>E</kbd> / <kbd>Click</kbd><span>Interact with Object / Screen</span></div>
              <div class="control-item"><kbd>V</kbd> / <kbd>Tab</kbd><span>Toggle FPS ↔ Orbit Overview</span></div>
              <div class="control-item"><kbd>1</kbd> - <kbd>4</kbd><span>Teleport to Zones (Reception, Desks, Conf, Lounge)</span></div>
              <div class="control-item"><kbd>O</kbd><span>Toggle Settings Drawer</span></div>
              <div class="control-item"><kbd>H</kbd><span>Toggle Controls Help Modal</span></div>
              <div class="control-item"><kbd>Esc</kbd><span>Release Pointer Lock</span></div>
            </div>
          </div>
          <div class="modal-footer">
            <button id="btn-ack-help" class="primary-btn">Got It</button>
          </div>
        </div>
      </div>

      <!-- Interactive Object Info Modal -->
      <div id="info-modal" class="modal-backdrop hidden">
        <div class="modal-dialog modal-interactive">
          <div class="modal-header">
            <div class="modal-title-box">
              <span id="modal-category-badge" class="badge">Screen</span>
              <h3 id="modal-title">Interactive Terminal</h3>
            </div>
            <button id="btn-close-info" class="icon-btn">✕</button>
          </div>
          <div class="modal-body">
            <p id="modal-description">Terminal output and telemetry data.</p>
            <div id="modal-interactive-content" class="interactive-panel"></div>
          </div>
          <div class="modal-footer" id="modal-actions-container">
            <button id="btn-close-info-footer" class="primary-btn">Close</button>
          </div>
        </div>
      </div>

      <!-- Initial Welcome / Click-to-Start Overlay -->
      <div id="overlay-start" class="welcome-overlay">
        <div class="welcome-card">
          <div class="welcome-icon">🏢</div>
          <h1>AURA CORP HEADQUARTERS</h1>
          <p class="welcome-subtitle">Immersive 3D Corporate Workspace & Interactive Twin</p>
          <div class="features-preview-row">
            <div class="preview-badge">✨ 4 Distinct Zones</div>
            <div class="preview-badge">🎮 Dual FPS / Orbit Navigation</div>
            <div class="preview-badge">💻 Interactive Live Screens</div>
            <div class="preview-badge">🔊 Spatial Audio Synthesizer</div>
          </div>
          <button id="btn-start-app" class="start-app-btn">ENTER WORKSPACE</button>
          <p class="start-hint">Clicking initiates WebGL, Audio Engine & Pointer Lock</p>
        </div>
      </div>

    </div>
  </div>

  <!-- Application Bootstrap Entrypoint -->
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

---

### Blueprint 5: `src/types/index.ts`
**Target Path**: `corporate_office_3d/src/types/index.ts`

```typescript
import * as THREE from 'three';

// ==========================================
// 1. Scene & Lighting Subsystem
// ==========================================

export type LightingPresetName = 'day' | 'sunset' | 'night';

export interface ILightingPreset {
  ambientColor: number;
  ambientIntensity: number;
  sunColor: number;
  sunIntensity: number;
  sunPosition: [number, number, number];
  skyColor: number;
  groundColor: number;
  fogColor: number;
  fogDensity: number;
  windowLightIntensity: number;
  ceilingLightIntensity: number;
  emissiveIntensity: number;
}

export interface ILightingManager {
  currentPreset: LightingPresetName;
  ambientLight: THREE.AmbientLight;
  sunLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  interiorLights: THREE.PointLight[];
  setPreset(preset: LightingPresetName): void;
  setShadowsEnabled(enabled: boolean): void;
  update(delta: number): void;
}

export interface IPerformanceMetrics {
  fps: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

export interface ISceneManager {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  lightingManager: ILightingManager;
  init(container: HTMLElement): void;
  render(): void;
  onResize(width: number, height: number): void;
  setLightingPreset(preset: LightingPresetName): void;
  setShadowsEnabled(enabled: boolean): void;
  setQuality(dprScale: number): void;
  getPerformanceMetrics(): IPerformanceMetrics;
}

// ==========================================
// 2. Navigation & Physics Subsystem
// ==========================================

export type NavigationMode = 'fps' | 'orbit' | 'transitioning';
export type ZoneId = 'reception' | 'workstations' | 'conference' | 'lounge';

export interface IZoneDefinition {
  id: ZoneId;
  name: string;
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  spawnPoint: {
    x: number;
    y: number;
    z: number;
    yaw: number;
  };
  description: string;
}

export interface AABBObstacle {
  min: THREE.Vector3;
  max: THREE.Vector3;
  name?: string;
}

export interface ICollisionEngine {
  obstacles: AABBObstacle[];
  addObstacle(box: THREE.Box3, name?: string): void;
  clearObstacles(): void;
  resolveMovement(
    currentPos: THREE.Vector3,
    desiredMovement: THREE.Vector3,
    playerRadius: number,
    playerHeight: number
  ): THREE.Vector3;
  isPositionValid(position: THREE.Vector3, playerRadius: number): boolean;
}

export interface IFirstPersonController {
  isLocked: boolean;
  isSprinting: boolean;
  velocity: THREE.Vector3;
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
  init(domElement: HTMLElement, camera: THREE.PerspectiveCamera): void;
  update(delta: number): void;
  setPosition(pos: THREE.Vector3, yaw?: number): void;
  lock(): void;
  unlock(): void;
  setEnabled(enabled: boolean): void;
  onFootstep?: (surface?: SurfaceType) => void;
}

export interface IOrbitController {
  camera: THREE.PerspectiveCamera;
  target: THREE.Vector3;
  distance: number;
  polarAngle: number;
  azimuthalAngle: number;
  init(domElement: HTMLElement, camera: THREE.PerspectiveCamera): void;
  update(delta: number): void;
  setTarget(target: THREE.Vector3): void;
  setEnabled(enabled: boolean): void;
}

export interface INavigationManager {
  mode: NavigationMode;
  playerRig: THREE.Object3D;
  camera: THREE.PerspectiveCamera;
  collisionEngine: ICollisionEngine;
  getPosition(): THREE.Vector3;
  getYaw(): number;
  getPitch(): number;
  setPosition(pos: THREE.Vector3, yaw?: number): void;
  setMode(mode: 'fps' | 'orbit', smooth?: boolean): void;
  teleportTo(zone: ZoneId, smooth?: boolean): void;
  update(delta: number): void;
  addObstacle(box: THREE.Box3, name?: string): void;
  getCurrentZone(): ZoneId;
  onFootstep?: () => void;
}

// ==========================================
// 3. Interaction & Dynamic Screens Subsystem
// ==========================================

export type InteractableCategory = 'screen' | 'light' | 'door' | 'appliance' | 'board' | 'seating';

export interface InteractableDetails {
  title: string;
  category: string;
  description: string;
  actions?: string[];
  metadata?: Record<string, string | number>;
}

export interface IInteractable {
  id: string;
  name: string;
  category: InteractableCategory;
  mesh: THREE.Object3D;
  prompt: string;
  distanceCutoff?: number;
  onHover?: (isHovered: boolean) => void;
  onInteract?: () => void;
  getDetails?: () => InteractableDetails;
}

export type ScreenDisplayType = 'slides' | 'telemetry' | 'matrix' | 'terminal' | 'whiteboard';

export interface IDynamicScreen {
  id: string;
  type: ScreenDisplayType;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  mesh: THREE.Mesh;
  update(delta: number): void;
  nextSlide?(): void;
  prevSlide?(): void;
  toggleTheme?(): void;
}

export interface IInteractionManager {
  register(interactable: IInteractable): void;
  unregister(id: string): void;
  update(camera: THREE.Camera, mode: NavigationMode, mouseNDC?: THREE.Vector2): void;
  triggerPrimaryAction(): void;
  getActiveInteractable(): IInteractable | null;
  getInteractables(): IInteractable[];
}

// ==========================================
// 4. Audio Subsystem
// ==========================================

export type SurfaceType = 'carpet' | 'tile' | 'wood' | 'metal';

export interface IAudioManager {
  isMuted: boolean;
  masterVolume: number;
  isAmbientPlaying: boolean;
  init(): Promise<void>;
  playFootstep(surface?: SurfaceType): void;
  playClick(): void;
  playChime(): void;
  playCoffeeBrew(): void;
  playDoorSound(open?: boolean): void;
  playLightSwitch(on?: boolean): void;
  setAmbientEnabled(enabled: boolean): void;
  setMasterVolume(volume: number): void;
  toggleMute(): boolean;
}

// ==========================================
// 5. HUD, Minimap & Settings UI Subsystem
// ==========================================

export type ReticleState = 'idle' | 'hover' | 'interact' | 'hidden';
export type GraphicsQuality = 'performance' | 'standard' | 'high' | 'ultra';

export interface IMinimap {
  init(container: HTMLElement): void;
  update(playerPos: THREE.Vector3, playerYaw: number): void;
  setVisible(visible: boolean): void;
  onZoneClick?: (zoneName: ZoneId) => void;
}

export interface IHUDManager {
  init(container: HTMLElement): void;
  setModeBadge(mode: 'fps' | 'orbit'): void;
  setZoneBanner(zoneName: string): void;
  setReticleState(state: ReticleState): void;
  showInteractionPrompt(text: string | null, keyHint?: string): void;
  hideInteractionPrompt(): void;
  showModal(title: string, content: HTMLElement | string, actions?: string[]): void;
  hideModal(): void;
  showHelpModal(): void;
  hideHelpModal(): void;
  updatePerformanceStats(metrics: IPerformanceMetrics): void;
}

export interface ISettingsDrawer {
  isOpen: boolean;
  init(container: HTMLElement): void;
  open(): void;
  close(): void;
  toggle(): void;
  onLightingChange?: (preset: LightingPresetName) => void;
  onShadowsChange?: (enabled: boolean) => void;
  onQualityChange?: (quality: GraphicsQuality) => void;
  onVolumeChange?: (volume: number) => void;
}

// ==========================================
// 6. Automation Debug Contract (Playwright Harness)
// ==========================================

export interface IOfficeDebug {
  sceneManager: ISceneManager;
  navigationManager: INavigationManager;
  interactionManager: IInteractionManager;
  audioManager: IAudioManager;
  hudManager?: IHUDManager;
  minimap?: IMinimap;
  getFPS(): number;
  getDrawCalls(): number;
  getTriangleCount(): number;
  getPlayerPosition(): { x: number; y: number; z: number; yaw: number };
  getInteractables(): string[];
  triggerInteract(id: string): boolean;
  teleport(zone: string): boolean;
  setLighting(preset: string): boolean;
  setMode(mode: string): boolean;
}

declare global {
  interface Window {
    __OFFICE_DEBUG__?: IOfficeDebug;
  }
}
```

---

### Blueprint 6: `playwright.config.ts`
**Target Path**: `corporate_office_3d/playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: {
    timeout: 5000
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--ignore-gpu-blocklist',
        '--no-sandbox'
      ]
    }
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
```

---

## 5. Verification Method

To independently verify the scaffolding once implemented:
1. **TypeScript Static Typecheck**: Run `npx tsc --noEmit` from the project root; confirm zero type errors across `src/types/index.ts`, `vite.config.ts`, and `playwright.config.ts`.
2. **Vite Dev Server Boot**: Run `npm run dev` and navigate to `http://localhost:3000`; confirm `index.html` loads cleanly with zero console runtime errors.
3. **DOM Layout & Elements Presence**: Inspect the DOM in Chrome DevTools to verify:
   - `#webgl-container` exists and has dimensions `100vw x 100vh`.
   - `#hud-layer`, `#reticle`, `#zone-banner`, `#mode-badge`, and `#minimap-canvas` exist with proper CSS classes.
   - Modals (`#help-modal`, `#info-modal`, `#settings-drawer`) are properly hidden by default with the `.hidden` class.
4. **Vite Production Build**: Run `npm run build` and ensure `dist/` is generated cleanly with all assets correctly bundled.
