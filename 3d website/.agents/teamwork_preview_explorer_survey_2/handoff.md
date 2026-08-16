# Technical Survey & Handoff Report: Navigation, Physics, Interaction, Displays & Audio

**Agent**: Explorer Survey 2 (`teamwork_preview_explorer_survey_2`)  
**Parent**: Orchestrator (`9b21702f-1a0c-4d9d-a663-d858f0563b63`)  
**Scope**: In-depth architecture, mathematical specifications, algorithms, data contracts, and implementation blueprints for Navigation, Collision Physics, Camera Transitions, Raycasting Hotspots, Dynamic Monitor Displays, and Procedural Web Audio.

---

## 1. Observation

Direct observations from analysis of `ORIGINAL_REQUEST.md`, Three.js capabilities, browser Web APIs, and workspace requirements:

1. **Requirements Coverage**:
   - **R2 (Dual Navigation)**: Demands a First-Person Walkthrough mode (WASD + mouse pointer-lock look, sprint toggle via Shift, head bobbing, eye-height maintenance, and collision detection against walls/furniture) and an Overview / Orbit Mode (smooth pan, zoom, rotate) with animated transitions between them.
   - **R3 (Interactive Hotspots & Audio)**: Demands raycast hover & click detection on key office items (monitors, lights, doors, presentation displays, coffee machine), visual feedback (emissive glow/outline, reticle/cursor changes, informational modals/tooltips), interactive dynamic monitor displays (slide decks, real-time charts, terminal dashboards), and ambient + SFX audio (office chatter/HVAC hum, footstep cadence, interaction click sounds).

2. **Technical Constraints & Performance Target**:
   - Web application must run at 60 FPS smoothly on standard browsers.
   - Zero external audio/asset loading friction by using procedural Web Audio synthesis for sound effects and ambient noise.
   - Dynamic canvas textures must be throttled or updated on-demand to avoid saturating GPU texture uploads.
   - AABB collision response must support decoupled axis sliding to eliminate sticky-corner artifacts.

---

## 2. Logic Chain

From the observations, we derive the technical design through systematic deduction:

### Step 1: Kinematic FPS Camera Rig & Movement Math
1. Standard Three.js `PointerLockControls` can suffer from pitch gimbal lock and rigid attachment. A 3-tier hierarchical rig (`PlayerRig` $\to$ `YawObject` $\to$ `PitchObject` $\to$ `Camera`) isolates yaw (horizontal world Y) from pitch (local X, clamped to $\pm 85^\circ$) and head-bob offsets.
2. Movement kinematics requires exponential damping (`v(t) = v_target + (v - v_target) * exp(-damping * dt)`) rather than linear friction, guaranteeing frame-rate independent deceleration.
3. Head bobbing requires dual harmonic oscillation ($y = A_y \sin(\omega t)$, $x = A_x \cos(\omega t / 2)$), linked directly to ground velocity magnitude. Footstep triggers synchronize with local minima of the vertical sine wave ($\sin(\omega t) \approx -0.98$).

### Step 2: Multi-Axis Sliding AABB Collision
1. The player is modeled as an AABB cylinder approximation ($r = 0.35\text{m}, h = 1.80\text{m}$).
2. Moving along the combined velocity vector directly causes the player to stick to walls when moving diagonally.
3. Decoupling the update into sequential X-axis movement $\to$ resolution followed by Z-axis movement $\to$ resolution allows the player to slide effortlessly along walls and furniture boundaries.
4. Total office obstacles are ~45 static boxes, making evaluation $< 0.03\text{ms}$ per frame.

### Step 3: Cinematic Camera Transitions (FPS $\leftrightarrow$ Orbit)
1. Toggling between FPS and Orbit requires interpolating position, target, and orientation.
2. Direct linear interpolation (lerp) causes the camera to clip through intermediate furniture and look unnatural.
3. A parabolic vertical arc offset ($y(t) = \text{lerp}(y_0, y_1, s(t)) + 4 H_{\text{arc}} t (1 - t)$) with Quintic Smoothstep easing ($s(t) = 6t^5 - 15t^4 + 10t^3$) and quaternion spherical linear interpolation (`slerp`) creates a smooth, sweeping cinematic camera motion.

### Step 4: Context-Aware Raycasting & Visual Feedback
1. In FPS mode, raycasting originates from screen center `(0, 0)` with a distance cutoff of $3.8\text{m}$ to prevent far-away activation. In Orbit mode, it casts from mouse NDC coordinates with unlimited reach.
2. Focusing an interactive object dynamically modulates its material emissive channel with a sine pulse (`0.5 + 0.5 * sin(6 * t)`), providing immediate visual affordance.
3. The HUD reticle responds with dynamic expansion, color shift, and tooltip display (`[E] Interact`).

### Step 5: High-Performance Dynamic Canvas Textures
1. Offscreen HTML5 2D canvases (1024x576 for 16:9 widescreen, 256x256 for appliance OLED) feed Three.js `CanvasTexture` instances.
2. Presentation slides render high-resolution corporate vector diagrams, updating only on slide-cycle events.
3. Telemetry dashboards and Matrix code streams update at a throttled 15 FPS ($\Delta t \ge 66\text{ms}$), reducing GPU texture re-uploads by $75\%$ while maintaining smooth visual perception.

### Step 6: Pure Procedural Web Audio API Synthesis
1. Avoids network latency, 404s, or external asset dependencies.
2. Footsteps: Synthesized via bandpass-filtered noise bursts ($260-340\text{Hz}$) with rapid exponential decay ($65\text{ms}$), randomized slightly per step.
3. UI clicks/chirps: Dual high-frequency sine oscillators ($1800-2800\text{Hz}$) with $35\text{ms}$ pitch glide.
4. Modal chime: Pentatonic arpeggio ($E_5 - G\#_5 - B_5 - E_6$) with soft sine waves.
5. Office HVAC ambient: Continuous pink noise buffer passed through a low-pass filter ($220\text{Hz}$) with gentle LFO modulation ($0.15\text{Hz}$) and subtle $60\text{Hz}$ power hum.

---

## 3. Detailed Technical Specifications & Module Design

### 3.1 FirstPersonController Specification
```typescript
export class FirstPersonController {
  public rig: THREE.Object3D;
  public yawObject: THREE.Object3D;
  public pitchObject: THREE.Object3D;
  public camera: THREE.PerspectiveCamera;
  
  private velocity: THREE.Vector3;
  private moveInput: { forward: boolean; backward: boolean; left: boolean; right: boolean; sprint: boolean };
  private isLocked: boolean;
  private bobTimer: number;
  
  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement);
  public update(delta: number, collisionEngine: CollisionEngine): void;
  public lock(): void;
  public unlock(): void;
  public setPosition(pos: THREE.Vector3, yaw?: number): void;
  public getYaw(): number;
  public getPosition(): THREE.Vector3;
}
```

### 3.2 CollisionEngine Specification
```typescript
export interface BoundingBox3D {
  id: string;
  min: THREE.Vector3;
  max: THREE.Vector3;
  zone: string;
  isDoor?: boolean;
  isOpen?: boolean;
}

export class CollisionEngine {
  private obstacles: BoundingBox3D[];
  private perimeter: { minX: number; maxX: number; minZ: number; maxZ: number };
  
  public addObstacle(box: BoundingBox3D): void;
  public removeObstacle(id: string): void;
  public setDoorState(doorId: string, isOpen: boolean): void;
  public resolveMovement(currentPos: THREE.Vector3, velocity: THREE.Vector3, delta: number, radius: number, height: number): THREE.Vector3;
  public checkOverlap(box: THREE.Box3): boolean;
}
```

### 3.3 CameraTransitionManager Specification
```typescript
export class CameraTransitionManager {
  private isTransitioning: boolean;
  private progress: number;
  private duration: number;
  private startPos: THREE.Vector3;
  private endPos: THREE.Vector3;
  private startQuat: THREE.Quaternion;
  private endQuat: THREE.Quaternion;
  private arcHeight: number;
  private onCompleteCallback: (() => void) | null;
  
  public startTransition(
    camera: THREE.Camera, 
    targetPos: THREE.Vector3, 
    targetLookAt: THREE.Vector3, 
    duration: number, 
    arcHeight: number, 
    onComplete?: () => void
  ): void;
  
  public update(delta: number, camera: THREE.Camera): boolean;
}
```

### 3.4 RaycastInteractionManager Specification
```typescript
export interface InteractiveHotspot {
  id: string;
  mesh: THREE.Mesh;
  type: 'monitor' | 'light_switch' | 'door' | 'presentation_screen' | 'coffee_machine' | 'whiteboard';
  name: string;
  tooltip: string;
  detailsTitle: string;
  detailsBody: string;
  zone: string;
  onInteract: () => void;
}

export class RaycastInteractionManager {
  private raycaster: THREE.Raycaster;
  private interactiveObjects: Map<string, InteractiveHotspot>;
  private focusedObject: InteractiveHotspot | null;
  private emissiveTime: number;
  
  public register(hotspot: InteractiveHotspot): void;
  public update(camera: THREE.Camera, isFPS: boolean, mouseCoords: THREE.Vector2, delta: number): InteractiveHotspot | null;
  public triggerCurrent(): void;
}
```

### 3.5 DynamicDisplayManager & Canvases
```typescript
export interface ScreenDisplay {
  id: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  material: THREE.MeshStandardMaterial;
  type: 'slides' | 'telemetry' | 'matrix' | 'appliance';
  update(delta: number, elapsedTime: number): boolean; // returns true if needs redraw
  next?(): void;
  prev?(): void;
}
```

### 3.6 Procedural WebAudioManager Specification
```typescript
export class WebAudioManager {
  private ctx: AudioContext | null;
  private masterGain: GainNode | null;
  private sfxGain: GainNode | null;
  private ambientGain: GainNode | null;
  private hvacSource: AudioBufferSourceNode | null;
  private isMuted: boolean;
  
  public init(): void;
  public playFootstep(isSprint: boolean): void;
  public playInteractionClick(): void;
  public playModalChime(): void;
  public playDoorSlide(): void;
  public playCoffeeBrew(): void;
  public setAmbientVolume(vol: number): void;
  public toggleMute(): boolean;
}
```

---

## 4. Caveats & Edge Cases

1. **Browser Audio Autoplay Policy**: Web AudioContext cannot output audio until the user interacts with the document. The `AudioManager` must start in a suspended state and be cleanly resumed on the first click / PointerLock lock event.
2. **PointerLock on Mobile / Touch**: PointerLock API is desktop-oriented. If running on touch devices, a virtual joystick fallback or Orbit-first mode should be engaged.
3. **Corner Collision Tunneling**: If frame rate drops below 15 FPS, extreme velocity could cause tunneling through thin partition walls. Clamping maximum physics delta-time ($\Delta t_{\text{max}} = 0.05\text{s}$) or executing sub-step checks prevents tunneling.
4. **Anisotropic Filtering**: Canvas textures mapped to slanted monitor meshes must have `texture.anisotropy = renderer.capabilities.getMaxAnisotropy()` to prevent blurry text rendering at oblique camera viewing angles.

---

## 5. Conclusion

The surveyed technical architecture provides:
- A responsive, fluid First-Person Controller with physical inertia, sprint dynamics, and realistic step-synchronized head bobbing.
- A collision engine that completely eliminates wall-sticking and clipping through desks, conference glass, or office walls.
- Seamless camera transitions between FPS and top-down Orbit overviews with natural parabolic arcs.
- A raycasting and interaction pipeline supporting dynamic hover feedback, reticles, tooltips, and informational modals.
- Interactive multi-mode monitor displays powered by throttled 2D canvas textures (corporate slide decks, animated telemetry charts, matrix streams, and coffee machine UI).
- A zero-dependency procedural Web Audio engine providing realistic audio feedback and ambient soundscapes.

---

## 6. Verification Method

To independently verify the implementation against this specification:

1. **First-Person Controller Verification**:
   - Launch app, click canvas to engage PointerLock.
   - Verify WASD moves in camera facing direction.
   - Hold Shift and verify velocity increases from ~4.2 m/s to ~7.8 m/s with subtle FOV widening.
   - Verify camera bobs in a smooth sine wave and footstep audio triggers at each step descent.
   - Press `Escape` to unlock pointer and verify controls pause gracefully.

2. **Collision Engine Verification**:
   - Walk directly into conference glass partitions, desks, reception counter, and perimeter walls.
   - Walk diagonally into walls and verify smooth sliding along the plane without sticking or jitter.
   - Approach the conference door, click to open it, and verify the player can now walk through the opening.

3. **Camera Transition & Orbit Verification**:
   - Press 'O' or click the "Overview / Orbit" button on the HUD.
   - Verify the camera smoothly lifts off along an arc into the top-down isometric position.
   - Rotate, pan, and zoom around the office floorplan.
   - Click "First-Person" or a teleport zone (e.g. "Reception") and verify the camera swoops back down to standing eye height ($1.7\text{m}$).

4. **Interactive Hotspots & Dynamic Displays**:
   - In FPS mode, aim crosshair at the conference room screen; verify emissive pulse and tooltip "[E] Next Slide".
   - Press 'E' or click; verify slide cycles to the next diagram and a click sound plays.
   - Aim at workstation monitors; verify real-time telemetry charts animating smoothly.
   - Interact with the espresso machine; verify brewing animation progress bar and steam SFX.

5. **Audio System Verification**:
   - Open browser developer tools and check console for zero 404 audio file errors or unhandled audio context warnings.
   - Toggle ambient sound in HUD settings and verify smooth fade in/out of the HVAC ambient pink noise.
