# Technical Blueprint & Investigation Report: FirstPersonController

**Author**: Explorer 1 (Milestone 2: Dual Navigation, Collision Physics & Transitions)  
**Target Module**: `src/navigation/FirstPersonController.ts`  
**Working Directory**: `C:\Users\thebh\.gemini\antigravity\scratch\corporate_office_3d\.agents\teamwork_preview_explorer_m2_1`  
**Project Root**: `C:\Users\thebh\.gemini\antigravity\scratch\corporate_office_3d`  
**Timestamp**: 2026-08-15T09:12:00Z  

---

## 1. Observation

Direct observations from workspace analysis and codebase inspection:

1. **Floorplan Coordinate System & Zone Dimensions** (`src/scene/OfficeFloorplan.ts:24-70`):
   - Floorplan bounds: $40\text{m} \times 26\text{m} \times 4\text{m}$ ($X \in [-20, 20]$, $Z \in [-13, 13]$, $Y \in [0, 4]$) centered at $(0, 0, 0)$.
   - Entrance spawn point: $(0, 1.6, 11.5)$, spawn yaw: $0.0\text{ rad}$ (facing $-Z$ North).
   - Reception spawn: $(-7.0, 1.6, 9.5)$, yaw: $0.0\text{ rad}$.
   - Workstations spawn: $(-7.0, 1.6, -1.0)$, yaw: $0.0\text{ rad}$.
   - Conference spawn: $(12.0, 1.6, -1.5)$, yaw: $\pi\text{ rad}$ (facing $+Z$ South).
   - Lounge spawn: $(8.0, 1.6, 5.0)$, yaw: $\frac{\pi}{2}\text{ rad}$ (facing West/East).

2. **Existing Camera & Update Loop** (`src/scene/SceneManager.ts:25-28, 85-114`):
   - `SceneManager` instantiates a `THREE.PerspectiveCamera(65, aspect, 0.1, 150)`.
   - Update loop invokes registered callbacks `(delta: number, elapsed: number)` with `delta` clamped to $\min(\Delta t_{raw}, 0.1)\text{s}$ to prevent lag tunneling.
   - `SceneManager.render()` renders `this.renderer.render(this.scene, this.camera)`.

3. **Existing Interface Contracts** (`src/types/index.ts:114-128, 142-158`):
   - `IFirstPersonController` specifies properties:
     - `isLocked: boolean`, `isSprinting: boolean`, `velocity: THREE.Vector3`, `position: THREE.Vector3`, `yaw: number`, `pitch: number`
     - Methods: `init(domElement: HTMLElement, camera: THREE.PerspectiveCamera): void`, `update(delta: number): void`, `setPosition(pos: THREE.Vector3, yaw?: number): void`, `lock(): void`, `unlock(): void`, `setEnabled(enabled: boolean): void`, `onFootstep?: (surface?: SurfaceType) => void`.
   - `INavigationManager` specifies mode transitions between `'fps' | 'orbit' | 'transitioning'`, obstacle registration, and position queries.

4. **Automation Debug Contract** (`src/types/index.ts:277-299`, `src/main.ts:203-252`):
   - `window.__OFFICE_DEBUG__` exposes `getPlayerPosition(): { x, y, z, yaw }`, `teleport(zone)`, `setMode(mode)`, and performance telemetry.

---

## 2. Logic Chain

From the observed requirements and constraints, the mathematical and architectural logic is structured as follows:

```
[User Movement Input (WASD / Shift)] 
             │
             ▼
[Kinematic Velocity Calculation (4.2 m/s walk, 7.8 m/s sprint)] 
             │
             ▼
[Framerate-Independent Exponential Damping: v(t+Δt) = v(t) + (v_target - v(t))*(1 - e^(-λΔt))]
             │
             ▼
[Collision Resolution via CollisionEngine (AABB Sliding on X & Z)]
             │
             ▼
[PlayerRig Root Position Updated at Y = 0 (Floor Anchored)]
             │
             ▼
[Yaw Rotation Object (rotation.y = yaw, local pos (0, 1.6, 0))]
             │
             ▼
[Pitch Rotation Object (rotation.x = pitch, clamped ±85°)]
             │
             ▼
[Dual Harmonic Bobbing Offset: y = Ay*sin(ωt), x = Ax*cos(ωt/2)]
             │
             ▼
[Camera Local Position in Pitch Node: (x_bob, y_bob, 0)]
             │
             ▼
[Cadence Trough Detection -> onFootstep(surface) Event Dispatch]
```

### 2.1 3-Tier Camera Rig Hierarchy
- **Tier 0 (`PlayerRig` / `THREE.Group`)**:
  - The root object in the Three.js scene hierarchy.
  - Position: $(X, 0, Z)$ on the physical floor plane.
  - Interacts directly with `CollisionEngine` AABB tests. Its bounding capsule is centered on this coordinate.
- **Tier 1 (`YawObject` / `THREE.Group`)**:
  - Child of `PlayerRig`.
  - Position: fixed at $(0, 1.6, 0)$ representing eye-height above the floor.
  - Rotation: `rotation.y = yaw` with Euler order `'YXZ'`.
  - Decoupling yaw ensures horizontal forward/strafe motion vectors are strictly parallel to the floor plane without diving into the floor when looking down.
- **Tier 2 (`PitchObject` / `THREE.Group`)**:
  - Child of `YawObject`.
  - Position: $(0, 0, 0)$ relative to `YawObject`.
  - Rotation: `rotation.x = pitch` with Euler order `'YXZ'`.
  - Clamped to $[-\frac{85\pi}{180}, +\frac{85\pi}{180}] \approx [-1.48353, +1.48353]\text{ rad}$.
  - Prevents gimbal lock, camera flipping, and roll drift.
- **Tier 3 (`Camera` / `THREE.PerspectiveCamera`)**:
  - Child of `PitchObject`.
  - Local position: $(x_{bob}, y_{bob}, 0)$.
  - Receives high-frequency biomechanical head-bobbing displacement without polluting the root collision coordinates.

### 2.2 Pointer Lock & Mouse Look Kinematics
- Pointer Lock API (`domElement.requestPointerLock()`) binds pointer movement.
- When pointer lock is active:
  $$\Delta \text{yaw} = -\Delta x_{mouse} \cdot \alpha_{mouse}$$
  $$\Delta \text{pitch} = -\Delta y_{mouse} \cdot \alpha_{mouse}$$
  where $\alpha_{mouse} = 0.0022\text{ rad/px}$ (sensitivity).
- Pitch clamping:
  $$\text{pitch} = \text{clamp}\left(\text{pitch}, -\frac{85\pi}{180}, +\frac{85\pi}{180}\right)$$

### 2.3 WASD Kinematics & Exponential Damping
- Normalized local input vector $\vec{d}_{local} = (X_{input}, 0, -Z_{input})$ from W/A/S/D or Arrow keys.
- Target speed:
  $$S_{target} = \begin{cases} 7.8\text{ m/s} & \text{if sprinting (Shift held)} \\ 4.2\text{ m/s} & \text{if walking} \\ 0\text{ m/s} & \text{if no input} \end{cases}$$
- World-space target velocity:
  $$\vec{v}_{target} = \text{rotateY}(\vec{d}_{local\_norm}, \text{yaw}) \cdot S_{target}$$
  $$v_{target, x} = (\cos(\text{yaw}) \cdot X_{input} - \sin(\text{yaw}) \cdot Z_{input}) \cdot S_{target}$$
  $$v_{target, z} = (-\sin(\text{yaw}) \cdot X_{input} - \cos(\text{yaw}) \cdot Z_{input}) \cdot S_{target}$$
- Continuous Exponential Velocity Damping:
  $$\vec{v}(t + \Delta t) = \vec{v}(t) + (\vec{v}_{target} - \vec{v}(t)) \cdot \left(1 - e^{-\lambda \Delta t}\right)$$
  where $\lambda = \begin{cases} 14.0\text{ s}^{-1} & \text{if } \|\vec{v}_{target}\| > 0 \text{ (acceleration)} \\ 10.0\text{ s}^{-1} & \text{if } \|\vec{v}_{target}\| = 0 \text{ (friction damping)} \end{cases}$
- If speed $\|\vec{v}\| < 0.005\text{ m/s}$, velocity snaps to zero to prevent floating-point drift.

### 2.4 Dual Harmonic Head-Bobbing Oscillation
- Human gait has a vertical oscillation frequency of 2 steps per full stride cycle ($\sin(\omega t)$) and a lateral sway frequency of 1 oscillation per full stride ($\cos(\omega t / 2)$).
- Base stride frequency $\omega_0 = 9.5\text{ rad/s}$ ($\approx 1.51\text{ Hz}$).
- Speed-dependent stride frequency:
  $$\omega = \omega_0 \cdot \left(0.8 + 0.7 \cdot \frac{\|\vec{v}_{xz}\|}{4.2}\right)$$
- Amplitudes:
  $$A_y = \text{lerp}(0.035\text{m}, 0.055\text{m}, \text{sprintFactor})$$
  $$A_x = \text{lerp}(0.020, 0.035\text{m}, \text{sprintFactor})$$
  where $\text{sprintFactor} = \text{clamp}\left(\frac{\|\vec{v}_{xz}\| - 4.2}{7.8 - 4.2}, 0, 1\right)$.
- Phase accumulation over interval $[0, 4\pi)$:
  $$\phi \leftarrow (\phi + \omega \cdot \Delta t) \pmod{4\pi}$$
- Displacements:
  $$y_{bob} = A_y \cdot \sin(\phi)$$
  $$x_{bob} = A_x \cdot \cos\left(\frac{\phi}{2}\right)$$
- When stopped ($\|\vec{v}\| \le 0.1\text{ m/s}$), offsets decay exponentially to 0:
  $$x_{bob} \leftarrow x_{bob} \cdot e^{-12 \Delta t}, \quad y_{bob} \leftarrow y_{bob} \cdot e^{-12 \Delta t}$$

### 2.5 Footstep Cadence Trigger Notification
- Foot impact occurs at vertical troughs ($y_{bob} \approx -A_y$), which corresponds to $\sin(\phi) = -1 \implies \phi \in \{\frac{3\pi}{2}, \frac{7\pi}{2}\}$.
- Detection mechanism:
  - Track $\phi_{prev}$ and $\phi_{curr}$.
  - If $(\phi_{prev} < \frac{3\pi}{2} \le \phi_{curr})$ OR $(\phi_{prev} < \frac{7\pi}{2} \le \phi_{curr})$, a footstep is triggered.
  - Debounce timer: $\Delta t_{step} \ge 0.22\text{s}$.
  - Invoke `this.onFootstep?.(surface)` passing active floor surface:
    - Reception $\to$ `'wood'` / `'tile'`
    - Workstations $\to$ `'carpet'`
    - Conference $\to$ `'wood'`
    - Lounge $\to$ `'tile'`

### 2.6 Dynamic FOV Kick
- Smoothly interpolate camera FOV:
  $$\text{targetFOV} = \text{isSprinting} ? 72^\circ : 65^\circ$$
  $$\text{FOV}(t + \Delta t) = \text{FOV}(t) + (\text{targetFOV} - \text{FOV}(t)) \cdot \left(1 - e^{-8 \Delta t}\right)$$

---

## 3. Caveats

1. **Browser Pointer Lock Policy**: Browsers enforce that `requestPointerLock()` must be initiated by a direct user gesture (e.g. `click` or `pointerdown`). In automated headless environments (like Playwright), tests should either simulate mouse clicks on `#webgl-container` or access position/yaw setters via `window.__OFFICE_DEBUG__`.
2. **Camera Handoff & Parenting**: When switching from FPS mode to Orbit mode, the `camera` instance must be unparented from `pitchObject` and reparented back to the `scene` (or its world matrix preserved with `camera.matrixWorld.decompose()`). When switching back to FPS, the camera must be reattached to `pitchObject` with local position $(0, 0, 0)$.
3. **Sliding Collision Clipping**: When the player collides with a wall, velocity along the collision normal must be zeroed out in `FirstPersonController.velocity`, otherwise sliding velocity could build up artificial kinetic energy against corners.

---

## 4. Conclusion & Concrete Implementation Blueprint

### 4.1 Class Architecture & Type Specification

Below is the complete, drop-in implementation blueprint for `src/navigation/FirstPersonController.ts`:

```typescript
import * as THREE from 'three';
import { IFirstPersonController, ICollisionEngine, SurfaceType } from '../types';

export interface FirstPersonControllerOptions {
  walkSpeed?: number;      // Default: 4.2 m/s
  sprintSpeed?: number;    // Default: 7.8 m/s
  sensitivity?: number;    // Default: 0.0022 rad/pixel
  eyeHeight?: number;      // Default: 1.60 m
  playerRadius?: number;   // Default: 0.35 m
  playerHeight?: number;   // Default: 1.80 m
  baseFov?: number;        // Default: 65 deg
  sprintFov?: number;      // Default: 72 deg
}

export class FirstPersonController implements IFirstPersonController {
  // 1. Hierarchy Nodes
  public playerRig: THREE.Group;    // Tier 0: Root world position (X, 0, Z)
  public yawObject: THREE.Group;    // Tier 1: Eye-height & Azimuth (0, 1.6, 0)
  public pitchObject: THREE.Group;  // Tier 2: Elevation (-85° to +85°)
  public camera!: THREE.PerspectiveCamera; // Tier 3: Local bobbing offsets

  // 2. Kinematic State
  public isLocked: boolean = false;
  public isSprinting: boolean = false;
  public isEnabled: boolean = false;
  public velocity: THREE.Vector3 = new THREE.Vector3();
  public position: THREE.Vector3 = new THREE.Vector3(); // Synced with playerRig.position
  public yaw: number = 0;
  public pitch: number = 0;

  // 3. Configuration & Constants
  private walkSpeed: number;
  private sprintSpeed: number;
  private sensitivity: number;
  private eyeHeight: number;
  private playerRadius: number;
  private playerHeight: number;
  private baseFov: number;
  private sprintFov: number;
  private maxPitch: number = (85 * Math.PI) / 180; // 85 deg in radians (~1.4835 rad)

  // 4. Input State Tracking
  private keys: {
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    sprint: boolean;
  } = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false
  };

  // 5. Head-Bobbing & Cadence Tracking
  private bobPhase: number = 0;
  private lastFootstepTime: number = 0;
  private currentBobOffset: THREE.Vector3 = new THREE.Vector3();
  public onFootstep?: (surface?: SurfaceType) => void;
  public getSurfaceAtPosition?: (pos: THREE.Vector3) => SurfaceType;

  // 6. External Collision Engine Coupling
  public collisionEngine?: ICollisionEngine;
  private domElement!: HTMLElement;

  constructor(options: FirstPersonControllerOptions = {}) {
    this.walkSpeed = options.walkSpeed ?? 4.2;
    this.sprintSpeed = options.sprintSpeed ?? 7.8;
    this.sensitivity = options.sensitivity ?? 0.0022;
    this.eyeHeight = options.eyeHeight ?? 1.60;
    this.playerRadius = options.playerRadius ?? 0.35;
    this.playerHeight = options.playerHeight ?? 1.80;
    this.baseFov = options.baseFov ?? 65;
    this.sprintFov = options.sprintFov ?? 72;

    // Build 3-Tier Camera Rig Hierarchy
    this.playerRig = new THREE.Group();
    this.playerRig.name = 'PlayerRig_Root';

    this.yawObject = new THREE.Group();
    this.yawObject.name = 'PlayerRig_YawNode';
    this.yawObject.position.set(0, this.eyeHeight, 0);

    this.pitchObject = new THREE.Group();
    this.pitchObject.name = 'PlayerRig_PitchNode';

    this.yawObject.add(this.pitchObject);
    this.playerRig.add(this.yawObject);
  }

  public init(domElement: HTMLElement, camera: THREE.PerspectiveCamera): void {
    this.domElement = domElement;
    this.camera = camera;

    // Attach Camera into Pitch Node
    this.pitchObject.add(this.camera);
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);

    this.bindEvents();
  }

  private bindEvents(): void {
    this.domElement.addEventListener('click', this.onDomClick);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    document.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  public dispose(): void {
    this.domElement.removeEventListener('click', this.onDomClick);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    document.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.unlock();
  }

  private onDomClick = (): void => {
    if (!this.isEnabled) return;
    this.lock();
  };

  public lock(): void {
    if (document.pointerLockElement !== this.domElement) {
      this.domElement.requestPointerLock();
    }
  }

  public unlock(): void {
    if (document.pointerLockElement === this.domElement) {
      document.exitPointerLock();
    }
  }

  private onPointerLockChange = (): void => {
    this.isLocked = document.pointerLockElement === this.domElement;
  };

  private onPointerLockError = (e: Event): void => {
    console.warn('[FirstPersonController] PointerLock error:', e);
    this.isLocked = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.isLocked || !this.isEnabled) return;

    const movementX = e.movementX || (e as any).mozMovementX || (e as any).webkitMovementX || 0;
    const movementY = e.movementY || (e as any).mozMovementY || (e as any).webkitMovementY || 0;

    // Integrate mouse deltas
    this.yaw -= movementX * this.sensitivity;
    this.pitch -= movementY * this.sensitivity;

    // Strict pitch clamping to +/- 85 degrees
    this.pitch = Math.max(-this.maxPitch, Math.min(this.maxPitch, this.pitch));

    this.yawObject.rotation.y = this.yaw;
    this.pitchObject.rotation.x = this.pitch;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.isEnabled) return;

    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.forward = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.keys.backward = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.keys.left = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.keys.right = true;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keys.sprint = true;
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.forward = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.keys.backward = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.keys.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.keys.right = false;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keys.sprint = false;
        break;
    }
  };

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.keys.forward = false;
      this.keys.backward = false;
      this.keys.left = false;
      this.keys.right = false;
      this.keys.sprint = false;
      this.velocity.set(0, 0, 0);
      this.unlock();
    }
  }

  public setPosition(pos: THREE.Vector3, yaw?: number): void {
    // Anchor physical rig at Y=0, while keeping eye height at 1.6m
    this.playerRig.position.set(pos.x, 0, pos.z);
    this.position.copy(this.playerRig.position);

    if (yaw !== undefined) {
      this.yaw = yaw;
      this.yawObject.rotation.y = this.yaw;
    }
  }

  public update(delta: number): void {
    if (!this.isEnabled) return;
    const clampedDelta = Math.min(delta, 0.1);

    // 1. Determine Movement Direction Vector in local space
    const zDir = (this.keys.forward ? 1 : 0) - (this.keys.backward ? 1 : 0);
    const xDir = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    const isMoving = zDir !== 0 || xDir !== 0;
    this.isSprinting = this.keys.sprint && isMoving;

    const targetSpeed = isMoving ? (this.isSprinting ? this.sprintSpeed : this.walkSpeed) : 0;

    // 2. Compute Desired World Velocity
    const targetVel = new THREE.Vector3();
    if (isMoving) {
      const len = Math.hypot(xDir, zDir);
      const nx = xDir / len;
      const nz = zDir / len;

      // Rotate local input vector into world space based on yaw
      const sinY = Math.sin(this.yaw);
      const cosY = Math.cos(this.yaw);

      // In Three.js: -Z is forward, +X is right
      targetVel.x = (cosY * nx - sinY * nz) * targetSpeed;
      targetVel.z = (-sinY * nx - cosY * nz) * targetSpeed;
    }

    // 3. Framerate-Independent Exponential Velocity Damping
    const dampingFactor = isMoving ? 14.0 : 10.0;
    const blend = 1.0 - Math.exp(-dampingFactor * clampedDelta);
    this.velocity.lerp(targetVel, blend);

    if (this.velocity.lengthSq() < 0.0001 && !isMoving) {
      this.velocity.set(0, 0, 0);
    }

    // 4. Calculate Desired Displacement
    const desiredDisplacement = this.velocity.clone().multiplyScalar(clampedDelta);
    const currentSpeed = this.velocity.length();

    // 5. Sliding Collision Resolution
    if (this.collisionEngine && desiredDisplacement.lengthSq() > 0) {
      const resolvedPos = this.collisionEngine.resolveMovement(
        this.playerRig.position,
        desiredDisplacement,
        this.playerRadius,
        this.playerHeight
      );

      const actualMovement = resolvedPos.clone().sub(this.playerRig.position);
      this.playerRig.position.copy(resolvedPos);

      // Damp velocity component if stopped by obstacle normal
      if (desiredDisplacement.x !== 0 && Math.abs(actualMovement.x) < 1e-5) {
        this.velocity.x = 0;
      }
      if (desiredDisplacement.z !== 0 && Math.abs(actualMovement.z) < 1e-5) {
        this.velocity.z = 0;
      }
    } else {
      this.playerRig.position.add(desiredDisplacement);
    }

    // Strictly enforce eye-height anchor
    this.playerRig.position.y = 0;
    this.position.copy(this.playerRig.position);

    // 6. Dual-Harmonic Head-Bobbing & Audio Cadence
    this.updateHeadBob(clampedDelta, currentSpeed);

    // 7. Dynamic FOV Kick during Sprint
    const targetFov = this.isSprinting ? this.sprintFov : this.baseFov;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * (1.0 - Math.exp(-8.0 * clampedDelta));
      this.camera.updateProjectionMatrix();
    }
  }

  private updateHeadBob(delta: number, speed: number): void {
    if (speed > 0.1) {
      // Speed-dependent cadence angular frequency
      const cadenceFreq = 9.5 * (0.8 + 0.7 * (speed / this.walkSpeed));
      const prevPhase = this.bobPhase;
      this.bobPhase = (this.bobPhase + cadenceFreq * delta) % (Math.PI * 4);

      // Sprint amplitude interpolation
      const sprintFactor = THREE.MathUtils.clamp((speed - this.walkSpeed) / (this.sprintSpeed - this.walkSpeed), 0, 1);
      const ampY = THREE.MathUtils.lerp(0.035, 0.055, sprintFactor);
      const ampX = THREE.MathUtils.lerp(0.020, 0.035, sprintFactor);

      // Dual harmonic formulas:
      // Vertical: y = Ay * sin(ωt) [2 beats per stride]
      // Lateral:  x = Ax * cos(ωt / 2) [1 sway per stride]
      const targetBobY = ampY * Math.sin(this.bobPhase);
      const targetBobX = ampX * Math.cos(this.bobPhase * 0.5);

      this.currentBobOffset.x += (targetBobX - this.currentBobOffset.x) * (1.0 - Math.exp(-15.0 * delta));
      this.currentBobOffset.y += (targetBobY - this.currentBobOffset.y) * (1.0 - Math.exp(-15.0 * delta));

      // Footstep cadence notification at vertical troughs (phi = 3pi/2 and 7pi/2)
      const trough1 = (3 * Math.PI) / 2;
      const trough2 = (7 * Math.PI) / 2;
      const crossedTrough = 
        (prevPhase < trough1 && this.bobPhase >= trough1) ||
        (prevPhase < trough2 && this.bobPhase >= trough2);

      const now = performance.now();
      if (crossedTrough && now - this.lastFootstepTime > 220) {
        this.lastFootstepTime = now;
        const surface = this.getSurfaceAtPosition ? this.getSurfaceAtPosition(this.playerRig.position) : 'carpet';
        this.onFootstep?.(surface);
      }
    } else {
      // Smooth decay to rest when stationary
      const blend = 1.0 - Math.exp(-12.0 * delta);
      this.currentBobOffset.x += (0 - this.currentBobOffset.x) * blend;
      this.currentBobOffset.y += (0 - this.currentBobOffset.y) * blend;
      this.bobPhase = 0;
    }

    // Apply offset directly to camera inside pitchObject
    this.camera.position.set(this.currentBobOffset.x, this.currentBobOffset.y, 0);
  }
}
```

---

## 5. Verification Method

To verify the implementation independently:

1. **TypeScript Static Analysis & Typecheck**:
   ```bash
   npm run typecheck
   ```
   *Expected Result*: Zero type errors across all exports and imports.

2. **Unit / Kinematic Mathematical Verification**:
   - Verify pitch limits: invoke mouse look with large $Y$ deltas ($\pm 2000\text{px}$) and assert pitch remains strictly within $[-1.48353, +1.48353]\text{ rad}$.
   - Verify movement speeds: measure displacement over $1.0\text{s}$ under constant W key ($\Delta z \approx 4.2\text{m}$) and Shift+W key ($\Delta z \approx 7.8\text{m}$).
   - Verify head-bobbing: inspect `camera.position.y` during walking and verify peak-to-peak amplitude is $\approx 0.07\text{m}$ ($[-0.035, +0.035]\text{m}$).
   - Verify eye-height lock: inspect `playerRig.position.y` and `yawObject.position.y` across all WASD directions and verify root remains $Y=0$ and yaw base remains $Y=1.6\text{m}$.

3. **E2E Playwright Automation Verification**:
   ```bash
   node tests/playwright_m1_verify.cjs
   ```
   *Expected Result*: 100% passes with canvas mounted, debug contract responsive, and zero console errors.

4. **Invalidation Conditions**:
   - Any camera roll drift or tilt when yawing.
   - Any player penetration through obstacle bounding boxes.
   - Any footstep event spamming exceeding $5\text{ events/sec}$.
