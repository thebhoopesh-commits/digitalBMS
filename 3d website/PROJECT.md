# Project: 3D Corporate Office Web Application (Three.js)

## Architecture
- **Rendering Engine**: Three.js WebGL Renderer with PBR workflow (`MeshStandardMaterial`, `MeshPhysicalMaterial`, procedural canvas textures, shadow mapping, dynamic lighting).
- **Coordinate Space**: Master floorplan $40\text{m} \times 26\text{m} \times 4\text{m}$ ($X \in [-20, 20]$, $Z \in [-13, 13]$, $Y \in [0, 4]$) centered at `(0, 0, 0)`.
- **Navigation Architecture**: Dual-mode camera rig (First-Person Kinematic with sliding AABB collision and head-bobbing $\leftrightarrow$ Isometric Orbit view with smooth parabolic arc transitions).
- **Interactivity Engine**: Raycaster with context-aware screen-center/mouse casting, emissive hover pulsing, dynamic canvas textures (slide decks, live telemetry, terminal matrix), and Web Audio API synthesizer.
- **HUD & UI**: Vanilla TypeScript modular DOM with glassmorphism CSS, dynamic 2D HTML5 Canvas minimap with affine coordinate projection, quick-teleport system, and reactive settings/lighting controls.
- **Testing Architecture**: 4-Tier Opaque-Box E2E Testing Harness using Playwright and `window.__OFFICE_DEBUG__` automation contract.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Master Floorplan & Zones | 4 distinct functional zones (Reception, Workstations, Conference Room, Lounge) + Corridor in 40x26m layout | M1 | ORIGINAL_REQUEST §R1 |
| 2 | Procedural PBR Asset Library | Desks, chairs, monitors, keyboards, lamps, sofa, coffee bar, logo, foliage, glass partitions with procedural PBR textures | M1 | ORIGINAL_REQUEST §R1 |
| 3 | Atmospheric Lighting Rig | Day, Sunset, and Night lighting presets with directional sun/moon shadows, ambient fill, and emissive fixtures | M1 | ORIGINAL_REQUEST §R1 |
| 4 | First-Person Controller | WASD movement, pointer-lock mouse look, sprint toggle (Shift), dual-harmonic head bobbing, eye-height lock | M2 | ORIGINAL_REQUEST §R2 |
| 5 | Sliding AABB Collision Engine | Decoupled X/Z collision resolution preventing wall/furniture penetration and sticky corners | M2 | ORIGINAL_REQUEST §R2 |
| 6 | Orbit / Overview Mode | Top-down / isometric orbit camera with smooth pan, rotate, zoom controls | M2 | ORIGINAL_REQUEST §R2 |
| 7 | Smooth Camera Transitions | Parabolic arc interpolation with quintic smoothstep easing and quaternion slerp between FPS and Orbit modes | M2 | ORIGINAL_REQUEST §R2 |
| 8 | Raycasting Hotspot Engine | Center-screen & mouse raycasting, distance cutoff, hover outline/emissive pulse, cursor changes | M3 | ORIGINAL_REQUEST §R3 |
| 9 | Dynamic Screen Displays | Interactive screens rendering switchable slide decks, animated telemetry charts, and terminal dashboards | M3 | ORIGINAL_REQUEST §R3 |
| 10 | Interactive Office Objects | Coffee machine with brewing effect, toggleable lamps/lights, opening doors, conference presentation display | M3 | ORIGINAL_REQUEST §R3 |
| 11 | Procedural Web Audio Engine | Footstep cadences, interaction clicks/chirps, conference chime, coffee brewing SFX, ambient office HVAC hum | M3 | ORIGINAL_REQUEST §R3 |
| 12 | 2D Dynamic Minimap | Real-time HTML5 Canvas floorplan overlay displaying player position blip, yaw orientation, vision FOV cone | M4 | ORIGINAL_REQUEST §R4 |
| 13 | Quick-Teleport System | Instant & smooth navigation shortcuts jumping player/camera to Reception, Workstations, Conference, Lounge | M4 | ORIGINAL_REQUEST §R4 |
| 14 | Settings & Quality Controls | Day/Sunset/Night lighting presets, shadow map toggle, DPR graphics quality scaler, audio mute/volume mixer | M4 | ORIGINAL_REQUEST §R4 |
| 15 | Controls & Help Overlay | Keybindings guide modal (pressing 'H' or clicking button), dismissible HUD hints, pointer lock lifecycle | M4 | ORIGINAL_REQUEST §R4 |
| 16 | 60 FPS Performance Optimization | InstancedMesh geometry reuse, merged static walls, throttled 15 FPS canvas texture updates, draw calls < 50 | M1/M5 | ORIGINAL_REQUEST §R5 |
| 17 | Standalone Local Execution | Zero-external-dependency local execution via Vite dev server and production static build | M1/M5 | ORIGINAL_REQUEST §R5 |
| 18 | Opaque-Box E2E Test Suite | 4-Tier E2E automated test suite (Tiers 1-4) with headless browser test runner and zero-leak verification | E2E Track | ORIGINAL_REQUEST §Acceptance |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core Engine, Scaffolding & 3D Scene Architecture | Project setup (Vite, Three.js, TS), procedural asset generators, PBR materials, 4-zone office layout, lighting presets rig | none | DONE |
| M2 | Dual Navigation, Collision Physics & Transitions | First-person controller (WASD, sprint, head bob), sliding AABB collision engine, orbit overview mode, smooth camera transitions | M1 | DONE |
| M3 | Interactive Objects, Dynamic Displays & Web Audio | Raycasting hotspots, interactive screens (slides, charts, terminal), appliance interactions, procedural Web Audio synthesizer | M1, M2 | IN_PROGRESS |
| M4 | HUD System, Real-Time Minimap & Settings UI | Real-time 2D Canvas minimap with FOV cone, quick-teleport menu, lighting/quality/audio settings drawer, help modal | M1, M2, M3 | PLANNED |
| M5 | E2E Integration, Full Test Pass & Hardening | Pass 100% of E2E test suite (Tiers 1-4), perform adversarial stress testing (Tier 5), performance soak at 60 FPS | M1-M4, E2E Track | PLANNED |
| E2E | E2E Testing Track | Requirement-driven opaque-box test harness & test suite (Tiers 1-4) covering all features, boundaries, and scenarios | M1 | IN_PROGRESS |

## Interface Contracts

### 1. Scene Engine (`src/scene/SceneManager.ts`)
```typescript
export interface ISceneManager {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  lightingManager: ILightingManager;
  init(container: HTMLElement): void;
  render(): void;
  onResize(width: number, height: number): void;
  setLightingPreset(preset: 'day' | 'sunset' | 'night'): void;
  setShadowsEnabled(enabled: boolean): void;
  setQuality(dprScale: number): void;
}
```

### 2. Navigation & Camera Controller (`src/navigation/NavigationManager.ts`)
```typescript
export interface INavigationManager {
  mode: 'fps' | 'orbit' | 'transitioning';
  playerRig: THREE.Object3D;
  camera: THREE.PerspectiveCamera;
  getPosition(): THREE.Vector3;
  getYaw(): number;
  setPosition(pos: THREE.Vector3, yaw?: number): void;
  setMode(mode: 'fps' | 'orbit', smooth?: boolean): void;
  teleportTo(zone: 'reception' | 'workstations' | 'conference' | 'lounge', smooth?: boolean): void;
  update(delta: number): void;
  addObstacle(box: THREE.Box3): void;
  onFootstep?: () => void;
}
```

### 3. Interaction Engine (`src/interaction/InteractionManager.ts`)
```typescript
export interface IInteractable {
  id: string;
  name: string;
  category: 'screen' | 'light' | 'door' | 'appliance' | 'board';
  mesh: THREE.Object3D;
  prompt: string;
  onHover?: (isHovered: boolean) => void;
  onInteract?: () => void;
  getDetails?: () => { title: string; description: string; actions?: string[] };
}

export interface IInteractionManager {
  register(interactable: IInteractable): void;
  unregister(id: string): void;
  update(camera: THREE.Camera, mode: 'fps' | 'orbit', mouseNDC?: THREE.Vector2): void;
  triggerPrimaryAction(): void;
  getActiveInteractable(): IInteractable | null;
}
```

### 4. Audio Engine (`src/audio/AudioManager.ts`)
```typescript
export interface IAudioManager {
  isMuted: boolean;
  masterVolume: number;
  init(): Promise<void>;
  playFootstep(surface?: 'carpet' | 'tile' | 'wood'): void;
  playClick(): void;
  playChime(): void;
  playCoffeeBrew(): void;
  setAmbientEnabled(enabled: boolean): void;
  setMasterVolume(volume: number): void;
  toggleMute(): boolean;
}
```

### 5. Minimap & HUD (`src/ui/Minimap.ts`, `src/ui/HUDManager.ts`)
```typescript
export interface IMinimap {
  init(container: HTMLElement): void;
  update(playerPos: THREE.Vector3, playerYaw: number): void;
  onZoneClick?: (zoneName: string) => void;
}

export interface IHUDManager {
  init(container: HTMLElement): void;
  setModeBadge(mode: 'fps' | 'orbit'): void;
  setZoneBanner(zoneName: string): void;
  showReticle(show: boolean, state?: 'idle' | 'hover'): void;
  showTooltip(text: string | null): void;
  showModal(title: string, content: HTMLElement | string): void;
  hideModal(): void;
}
```

### 6. Automation Debug Contract (`window.__OFFICE_DEBUG__`)
```typescript
export interface IOfficeDebug {
  sceneManager: ISceneManager;
  navigationManager: INavigationManager;
  interactionManager: IInteractionManager;
  audioManager: IAudioManager;
  getFPS(): number;
  getDrawCalls(): number;
  getTriangleCount(): number;
  getPlayerPosition(): { x: number; y: number; z: number; yaw: number };
  getInteractables(): string[];
  triggerInteract(id: string): boolean;
  teleport(zone: string): boolean;
  setLighting(preset: string): boolean;
}
```

## Code Layout
```
corporate_office_3d/
├── index.html                  # Main application entry point & HUD DOM scaffold
├── package.json                # Project dependencies and test scripts
├── tsconfig.json               # TypeScript configuration
├── vite.config.ts              # Vite bundler configuration
├── src/
│   ├── main.ts                 # Main bootstrap & game loop
│   ├── scene/
│   │   ├── SceneManager.ts     # Three.js scene, camera, renderer, animation loop
│   │   ├── LightingManager.ts  # Day/Sunset/Night presets, shadows, sun/moon/fixtures
│   │   ├── Materials.ts        # Procedural PBR textures & materials singleton
│   │   └── OfficeFloorplan.ts  # Multi-zone geometry builders & instancing
│   ├── navigation/
│   │   ├── NavigationManager.ts# Mode coordination, transitions & obstacle registry
│   │   ├── FirstPersonController.ts # Kinematic FPS movement, pointer lock, head-bob
│   │   ├── OrbitController.ts  # Top-down / isometric orbit camera
│   │   └── CollisionEngine.ts  # Decoupled sliding AABB collision resolver
│   ├── interaction/
│   │   ├── InteractionManager.ts # Raycasting, hover emissive pulse, click dispatcher
│   │   ├── DynamicScreens.ts   # Canvas 2D texture generators (slides, telemetry, matrix)
│   │   └── InteractiveProps.ts # Hotspot definitions (monitors, lights, coffee machine)
│   ├── audio/
│   │   └── AudioManager.ts     # Procedural Web Audio API sound synthesizer
│   ├── ui/
│   │   ├── HUDManager.ts       # Reticle, tooltips, modals, notifications, controls
│   │   ├── Minimap.ts          # Real-time HTML5 2D canvas minimap with FOV cone
│   │   ├── SettingsDrawer.ts   # Lighting presets, quality scaler, audio volume
│   │   └── styles.css          # Glassmorphic HUD styling and layout
│   └── types/
│       └── index.ts            # Shared interfaces and type definitions
└── tests/
    ├── e2e/
    │   ├── tier1-feature.spec.ts    # Tier 1: Feature verification & unit smoke tests
    │   ├── tier2-boundary.spec.ts   # Tier 2: Boundary value analysis & collision tests
    │   ├── tier3-combination.spec.ts# Tier 3: Cross-feature interaction tests
    │   └── tier4-scenario.spec.ts   # Tier 4: Real-world user journey & 60 FPS soak tests
    ├── test-runner.js               # Standalone test runner
    └── playwright.config.ts         # Playwright E2E configuration
```
