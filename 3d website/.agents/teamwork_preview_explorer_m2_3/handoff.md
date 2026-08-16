# Handoff Report: OrbitController & NavigationManager Architecture Blueprint

**Agent ID**: `teamwork_preview_explorer_m2_3`  
**Milestone**: M2 (Dual Navigation, Collision Physics & Transitions)  
**Target Modules**: `src/navigation/OrbitController.ts`, `src/navigation/NavigationManager.ts`, and Integration with `src/scene/SceneManager.ts` & `src/main.ts`  

---

## 1. Observation

Direct examination of the workspace revealed the following facts and existing system contracts:

1. **Floorplan Coordinate Space & Spatial Geometry**:
   - Master floorplan bounds (`src/scene/OfficeFloorplan.ts:24-70`): $40\text{m} \times 26\text{m} \times 4\text{m}$ ($X \in [-20, 20]$, $Z \in [-13, 13]$, $Y \in [0, 4]$) centered at `(0, 0, 0)`.
   - Zones defined in `OFFICE_ZONES`:
     - `reception`: Center $(-7.0, 0, 7.5)$, Spawn $(-7.0, 1.6, 9.5)$, SpawnYaw $0.0\text{ rad}$ ($0^\circ$).
     - `workstations`: Center $(-7.0, 0, -6.0)$, Spawn $(-7.0, 1.6, -1.0)$, SpawnYaw $0.0\text{ rad}$ ($0^\circ$).
     - `conference`: Center $(12.0, 0, -6.0)$, Spawn $(12.0, 1.6, -1.5)$, SpawnYaw $\pi\text{ rad}$ ($180^\circ$).
     - `lounge`: Center $(12.0, 0, 7.5)$, Spawn $(8.0, 1.6, 5.0)$, SpawnYaw $\pi/2\text{ rad}$ ($90^\circ$).
     - `entrance`: Center $(0.0, 0, 11.5)$, Spawn $(0.0, 1.6, 11.5)$, SpawnYaw $0.0\text{ rad}$ ($0^\circ$).
   - Obstacles registry (`src/scene/OfficeFloorplan.ts:380-420`): `OfficeFloorplan.getObstacles()` returns array of 38 `ObstacleBox` objects with `THREE.Box3` bounding boxes and dynamic door state tracking.

2. **Existing Interface Contracts (`src/types/index.ts:130-158`)**:
   ```typescript
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
     collisionEngine?: ICollisionEngine;
     getPosition(): THREE.Vector3;
     getYaw(): number;
     getPitch?(): number;
     setPosition(pos: THREE.Vector3, yaw?: number): void;
     setMode(mode: 'fps' | 'orbit', smooth?: boolean): void;
     teleportTo(zone: ZoneId | string, smooth?: boolean): void;
     update(delta: number): void;
     addObstacle(box: THREE.Box3, name?: string): void;
     getCurrentZone?(): ZoneId;
     onFootstep?: () => void;
   }
   ```

3. **Current Scaffolding in `src/main.ts:31-92`**:
   - `main.ts` currently employs raw mouse move event listeners directly manipulating camera coordinates with rudimentary Euler angles, lacking inertia, polar angle clamps, multi-axis target panning, state machine isolation, and parabolic easing.
   - `SceneManager.ts` provides `registerUpdateCallback(cb: (delta: number, elapsed: number) => void)` which runs on every animation frame clamped to $\le 0.1\text{s}$.

---

## 2. Logic Chain

From the requirements in `ORIGINAL_REQUEST.md (§R2)` and `PROJECT.md (Features 6 & 7)`, the navigation architecture requires:

1. **OrbitController Architecture**:
   - **Spherical Coordinate Representation**: Camera position relative to `target` is represented by $(\theta, \phi, r)$:
     $$\mathbf{P}_{\text{cam}} = \mathbf{T} + \begin{pmatrix} r \sin\phi \sin\theta \\ r \cos\phi \\ r \sin\phi \cos\theta \end{pmatrix}$$
   - **Angular & Distance Constraints**:
     - Polar angle $\phi \in [\phi_{\min}, \phi_{\max}] = [0.15\text{ rad}, 1.42\text{ rad}]$ ($\approx 8.6^\circ \text{ to } 81.4^\circ$). This guarantees the camera never flips over the zenith or clips through the floor plane ($Y < 0$).
     - Zoom distance $r \in [r_{\min}, r_{\max}] = [5.0\text{m}, 55.0\text{m}]$.
     - Target pan bounds: $\mathbf{T}_x \in [-22, 22]$, $\mathbf{T}_z \in [-15, 15]$, $\mathbf{T}_y \in [0, 3]$.
   - **Multi-Touch & Mouse Gestures**:
     - Left-Click Drag: Azimuthal ($\Delta \theta$) and Polar ($\Delta \phi$) rotation.
     - Right-Click / Middle-Click / Two-Finger Drag: Camera-relative horizontal & planar vertical target panning.
     - Wheel Scroll / Pinch: Smooth multiplicative zoom $r \leftarrow r \cdot (1 \pm \delta \cdot \text{zoomSpeed})$.
   - **Exponential Damping**: To provide a cinematic, butter-smooth feel, current values $(\theta, \phi, r, \mathbf{T})$ smoothly track target values $(\theta_t, \phi_t, r_t, \mathbf{T}_t)$ via exponential decay:
     $$\mathbf{v}(t + \Delta t) = \mathbf{v}_t + (\mathbf{v}(t) - \mathbf{v}_t) \cdot e^{-\lambda \Delta t}$$
     where $\lambda = 12.0\text{ s}^{-1}$.

2. **Camera Transition Dynamics (FPS $\leftrightarrow$ Orbit & Teleportation)**:
   - **State Machine Isolation**: `NavigationMode = 'fps' | 'orbit' | 'transitioning'`. During `'transitioning'`, direct user inputs to both controllers are locked.
   - **Quintic Smoothstep (Perlin's SmootherStep)**:
     $$u = \text{clamp}\left(\frac{t}{T_{\text{duration}}}, 0, 1\right)$$
     $$s(u) = 6u^5 - 15u^4 + 10u^3$$
     *Proof of C2 continuity*: $s(0)=0, s(1)=1$, $s'(0)=s'(1)=0$, $s''(0)=s''(1)=0$. Velocity and acceleration both start and end at zero, completely preventing any camera jerk or snapping.
   - **Ballistic Parabolic Arc Lofting**:
     $$\mathbf{P}(u) = \begin{pmatrix} \text{lerp}(x_0, x_1, s(u)) \\ \text{lerp}(y_0, y_1, s(u)) + 4 H_{\text{arc}} u (1 - u) \\ \text{lerp}(z_0, z_1, s(u)) \end{pmatrix}$$
     - Peak loft $H_{\text{arc}}$ is computed dynamically based on horizontal distance $D_{\text{xz}} = \|\mathbf{P}_1 - \mathbf{P}_0\|_{\text{xz}}$:
       $$H_{\text{arc}} = \text{clamp}(D_{\text{xz}} \times 0.25, 3.5, 10.0)$$
     - When $u=0.5$, $4u(1-u) = 1.0$, adding exact maximum altitude $H_{\text{arc}}$ above the interpolated baseline, allowing the camera to clear internal partitions ($2.8\text{m}$) and ceiling beams ($4.0\text{m}$) gracefully.
   - **Geodesic Orientation SLERP**:
     $$\mathbf{q}(u) = \text{slerp}(\mathbf{q}_0, \mathbf{q}_1, s(u))$$
     Guarantees shortest-path angular rotation on the unit quaternion sphere without gimbal lock.

3. **NavigationManager Delegation**:
   - Master orchestrator containing `FirstPersonController`, `OrbitController`, and `CollisionEngine`.
   - Dispatches `update(delta)` to the currently active controller or runs the transition interpolator.
   - Provides unified `teleportTo(zoneKey, smooth)` which initiates an elevated parabolic flight path when smooth is requested, or instantly snaps coordinates when false.

---

## 3. Caveats & Edge Cases

1. **Pointer Lock Interlock**:
   - When transitioning from `'fps'` to `'orbit'`, the pointer lock MUST be explicitly released (`document.exitPointerLock()`).
   - When transitioning from `'orbit'` to `'fps'`, pointer lock should not forcibly re-engage until the user interacts with the canvas, preventing browser security exceptions.
2. **Zero-GC Frame Rate Protection**:
   - All vector math, quaternions, and bounding calculations within `update()` must reuse pre-allocated scratch objects (`_v1`, `_v2`, `_q1`, `_q2`, `_euler`) to avoid memory allocations and GC spikes during 60 FPS rendering.
3. **Orbit Target Bounds**:
   - Clamping target pan prevents user from panning the orbit camera out into infinite empty space away from the office.
4. **Transition Interruption**:
   - If user triggers a teleport or mode switch while a transition is already in progress, the active transition safely restarts from the current instantaneous camera position and orientation.

---

## 4. Conclusion & Complete Concrete Implementation Blueprint

### 4.1 `src/navigation/OrbitController.ts`

```typescript
import * as THREE from 'three';
import { IOrbitController } from '../types';

export interface OrbitControllerOptions {
  minDistance?: number;
  maxDistance?: number;
  minPolarAngle?: number;
  maxPolarAngle?: number;
  rotateSpeed?: number;
  panSpeed?: number;
  zoomSpeed?: number;
  dampingFactor?: number;
  bounds?: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    minY: number;
    maxY: number;
  };
}

export class OrbitController implements IOrbitController {
  public camera!: THREE.PerspectiveCamera;
  public target: THREE.Vector3 = new THREE.Vector3(0, 1.2, 0);
  public distance: number = 28.0;
  public polarAngle: number = Math.PI / 3.8; // ~47 degrees (Isometric pitch)
  public azimuthalAngle: number = 0.0;

  // Target values for smooth damping
  private targetDistance: number = 28.0;
  private targetPolarAngle: number = Math.PI / 3.8;
  private targetAzimuthalAngle: number = 0.0;
  private targetLookAt: THREE.Vector3 = new THREE.Vector3(0, 1.2, 0);

  // Configuration limits
  public minDistance: number = 4.0;
  public maxDistance: number = 55.0;
  public minPolarAngle: number = 0.15; // ~8.6 deg (Near top-down)
  public maxPolarAngle: number = Math.PI / 2.2; // ~81.8 deg (Above floor)
  public rotateSpeed: number = 0.005;
  public panSpeed: number = 0.015;
  public zoomSpeed: number = 0.0015;
  public dampingFactor: number = 12.0;

  // Pan boundary constraints
  public bounds = {
    minX: -22.0,
    maxX: 22.0,
    minZ: -15.0,
    maxZ: 15.0,
    minY: 0.0,
    maxY: 3.0
  };

  private domElement!: HTMLElement;
  private isEnabled: boolean = false;
  private isPointerDown: boolean = false;
  private pointerMode: 'none' | 'rotate' | 'pan' = 'none';
  private previousPointerPosition: { x: number; y: number } = { x: 0, y: 0 };
  private activePointers: Map<number, { x: number; y: number }> = new Map();
  private initialPinchDistance: number = 0;

  // Scratch objects for zero-GC performance
  private _scratchVec: THREE.Vector3 = new THREE.Vector3();
  private _camRight: THREE.Vector3 = new THREE.Vector3();
  private _camUp: THREE.Vector3 = new THREE.Vector3();
  private _camForward: THREE.Vector3 = new THREE.Vector3();

  constructor(options?: OrbitControllerOptions) {
    if (options) {
      if (options.minDistance !== undefined) this.minDistance = options.minDistance;
      if (options.maxDistance !== undefined) this.maxDistance = options.maxDistance;
      if (options.minPolarAngle !== undefined) this.minPolarAngle = options.minPolarAngle;
      if (options.maxPolarAngle !== undefined) this.maxPolarAngle = options.maxPolarAngle;
      if (options.rotateSpeed !== undefined) this.rotateSpeed = options.rotateSpeed;
      if (options.panSpeed !== undefined) this.panSpeed = options.panSpeed;
      if (options.zoomSpeed !== undefined) this.zoomSpeed = options.zoomSpeed;
      if (options.dampingFactor !== undefined) this.dampingFactor = options.dampingFactor;
      if (options.bounds !== undefined) this.bounds = { ...this.bounds, ...options.bounds };
    }
  }

  public init(domElement: HTMLElement, camera: THREE.PerspectiveCamera): void {
    this.domElement = domElement;
    this.camera = camera;

    this.bindEvents();
    this.syncFromCamera();
  }

  private bindEvents(): void {
    this.domElement.addEventListener('contextmenu', this.onContextMenu);
    this.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    this.domElement.addEventListener('wheel', this.onWheel, { passive: false });
  }

  public dispose(): void {
    if (!this.domElement) return;
    this.domElement.removeEventListener('contextmenu', this.onContextMenu);
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.domElement.removeEventListener('wheel', this.onWheel);
  }

  private onContextMenu = (event: Event): void => {
    if (this.isEnabled) {
      event.preventDefault();
    }
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.isEnabled) return;

    // Ignore clicks on HUD overlay elements
    if ((event.target as HTMLElement)?.closest('#hud-layer') && !(event.target as HTMLElement)?.closest('#reticle')) {
      return;
    }

    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.activePointers.size === 1) {
      this.isPointerDown = true;
      this.previousPointerPosition = { x: event.clientX, y: event.clientY };

      if (event.button === 2 || event.button === 1 || event.shiftKey) {
        this.pointerMode = 'pan';
      } else {
        this.pointerMode = 'rotate';
      }
    } else if (this.activePointers.size === 2) {
      this.pointerMode = 'pan';
      const pts = Array.from(this.activePointers.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      this.initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.isEnabled || !this.isPointerDown) return;

    if (this.activePointers.has(event.pointerId)) {
      this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (this.activePointers.size === 2) {
      // Two-finger pinch zoom + pan
      const pts = Array.from(this.activePointers.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const pinchDist = Math.sqrt(dx * dx + dy * dy);
      const factor = (this.initialPinchDistance - pinchDist) * 0.05;
      this.zoom(factor);
      this.initialPinchDistance = pinchDist;
      return;
    }

    const deltaX = event.clientX - this.previousPointerPosition.x;
    const deltaY = event.clientY - this.previousPointerPosition.y;
    this.previousPointerPosition = { x: event.clientX, y: event.clientY };

    if (this.pointerMode === 'rotate') {
      this.targetAzimuthalAngle -= deltaX * this.rotateSpeed;
      this.targetPolarAngle = Math.max(
        this.minPolarAngle,
        Math.min(this.maxPolarAngle, this.targetPolarAngle - deltaY * this.rotateSpeed)
      );
    } else if (this.pointerMode === 'pan') {
      this.pan(deltaX, deltaY);
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.activePointers.delete(event.pointerId);
    if (this.activePointers.size === 0) {
      this.isPointerDown = false;
      this.pointerMode = 'none';
    } else if (this.activePointers.size === 1) {
      const remaining = Array.from(this.activePointers.values())[0];
      this.previousPointerPosition = { x: remaining.x, y: remaining.y };
      this.pointerMode = 'rotate';
    }
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.isEnabled) return;
    event.preventDefault();
    this.zoom(event.deltaY * this.zoomSpeed * (this.distance * 0.15));
  };

  public zoom(amount: number): void {
    this.targetDistance = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, this.targetDistance + amount)
    );
  }

  public pan(deltaX: number, deltaY: number): void {
    // Calculate camera basis vectors projected on ground
    this.camera.getWorldDirection(this._camForward);
    this._camRight.crossVectors(this._camForward, this.camera.up).normalize();
    this._camUp.copy(this.camera.up).normalize();

    // Scale pan speed with distance for natural feeling at all zoom levels
    const scale = this.distance * this.panSpeed * 0.05;

    // Pan in XZ ground plane
    const moveRight = this._camRight.multiplyScalar(-deltaX * scale);
    
    // Forward vector projected on horizontal plane
    const forwardPlanar = this._scratchVec.set(this._camForward.x, 0, this._camForward.z).normalize();
    const moveForward = forwardPlanar.multiplyScalar(deltaY * scale);

    this.targetLookAt.add(moveRight).add(moveForward);

    // Clamp within office bounding volume
    this.targetLookAt.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, this.targetLookAt.x));
    this.targetLookAt.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, this.targetLookAt.z));
    this.targetLookAt.y = Math.max(this.bounds.minY, Math.min(this.bounds.maxY, this.targetLookAt.y));
  }

  public setTarget(target: THREE.Vector3, immediate: boolean = false): void {
    this.targetLookAt.copy(target);
    if (immediate) {
      this.target.copy(target);
    }
  }

  public setOrbitView(distance: number, polarAngle: number, azimuthalAngle: number, immediate: boolean = false): void {
    this.targetDistance = Math.max(this.minDistance, Math.min(this.maxDistance, distance));
    this.targetPolarAngle = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, polarAngle));
    this.targetAzimuthalAngle = azimuthalAngle;

    if (immediate) {
      this.distance = this.targetDistance;
      this.polarAngle = this.targetPolarAngle;
      this.azimuthalAngle = this.targetAzimuthalAngle;
    }
  }

  public syncFromCamera(): void {
    const offset = this._scratchVec.subVectors(this.camera.position, this.target);
    this.distance = offset.length();
    this.targetDistance = this.distance;

    if (this.distance > 0.001) {
      this.polarAngle = Math.acos(Math.max(-1, Math.min(1, offset.y / this.distance)));
      this.azimuthalAngle = Math.atan2(offset.x, offset.z);
    } else {
      this.polarAngle = Math.PI / 4;
      this.azimuthalAngle = 0;
    }
    this.targetPolarAngle = this.polarAngle;
    this.targetAzimuthalAngle = this.azimuthalAngle;
    this.targetLookAt.copy(this.target);
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.isPointerDown = false;
      this.activePointers.clear();
      this.pointerMode = 'none';
    } else {
      this.syncFromCamera();
    }
  }

  public update(delta: number): void {
    if (!this.isEnabled) return;

    // Apply exponential damping
    const dampFactor = 1.0 - Math.exp(-this.dampingFactor * delta);

    this.distance += (this.targetDistance - this.distance) * dampFactor;
    this.polarAngle += (this.targetPolarAngle - this.polarAngle) * dampFactor;
    this.azimuthalAngle += (this.targetAzimuthalAngle - this.azimuthalAngle) * dampFactor;
    this.target.lerp(this.targetLookAt, dampFactor);

    // Compute spherical position
    const sinPolar = Math.sin(this.polarAngle);
    const cosPolar = Math.cos(this.polarAngle);
    const sinAzimuth = Math.sin(this.azimuthalAngle);
    const cosAzimuth = Math.cos(this.azimuthalAngle);

    const x = this.target.x + this.distance * sinPolar * sinAzimuth;
    const y = this.target.y + this.distance * cosPolar;
    const z = this.target.z + this.distance * sinPolar * cosAzimuth;

    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
  }
}
```

---

### 4.2 `src/navigation/NavigationManager.ts`

```typescript
import * as THREE from 'three';
import {
  INavigationManager,
  NavigationMode,
  ZoneId,
  IFirstPersonController,
  IOrbitController,
  ICollisionEngine
} from '../types';
import { FirstPersonController } from './FirstPersonController';
import { OrbitController } from './OrbitController';
import { CollisionEngine } from './CollisionEngine';
import { OFFICE_ZONES, ZoneBounds } from '../scene/OfficeFloorplan';

export interface TransitionState {
  isActive: boolean;
  startTime: number;
  duration: number;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startQuat: THREE.Quaternion;
  endQuat: THREE.Quaternion;
  peakHeight: number;
  targetMode: 'fps' | 'orbit';
  targetYaw: number;
  onComplete?: () => void;
}

export class NavigationManager implements INavigationManager {
  public mode: NavigationMode = 'fps';
  public playerRig: THREE.Object3D;
  public camera: THREE.PerspectiveCamera;
  public collisionEngine: ICollisionEngine;

  public fpsController: FirstPersonController;
  public orbitController: OrbitController;

  public onFootstep?: () => void;
  public onModeChange?: (mode: NavigationMode) => void;
  public onZoneChange?: (zone: ZoneId, zoneData: ZoneBounds) => void;

  private scene: THREE.Scene;
  private domElement!: HTMLElement;
  private currentZoneId: ZoneId = 'entrance';

  // Parabolic transition state
  private transition: TransitionState = {
    isActive: false,
    startTime: 0,
    duration: 1.2,
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    startQuat: new THREE.Quaternion(),
    endQuat: new THREE.Quaternion(),
    peakHeight: 5.0,
    targetMode: 'fps',
    targetYaw: 0
  };

  // Scratch variables for zero-GC math
  private _scratchPos: THREE.Vector3 = new THREE.Vector3();
  private _scratchQuat: THREE.Quaternion = new THREE.Quaternion();
  private _scratchEuler: THREE.Euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private _dummyCam: THREE.PerspectiveCamera = new THREE.PerspectiveCamera();

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;
    this.playerRig = new THREE.Object3D();
    this.playerRig.name = 'PlayerRig';
    this.scene.add(this.playerRig);

    this.collisionEngine = new CollisionEngine();
    this.fpsController = new FirstPersonController(this.collisionEngine);
    this.orbitController = new OrbitController();

    // Wire up footstep callback
    this.fpsController.onFootstep = () => {
      if (this.onFootstep) this.onFootstep();
    };
  }

  public init(domElement: HTMLElement): void {
    this.domElement = domElement;

    this.fpsController.init(domElement, this.camera);
    this.orbitController.init(domElement, this.camera);

    // Initial state: Start in FPS mode at entrance
    const spawn = OFFICE_ZONES.entrance.spawnPosition;
    const yaw = OFFICE_ZONES.entrance.spawnYaw;
    this.setPosition(spawn, yaw);

    this.fpsController.setEnabled(true);
    this.orbitController.setEnabled(false);
    this.mode = 'fps';
  }

  public getPosition(): THREE.Vector3 {
    if (this.mode === 'fps') {
      return this.fpsController.position;
    }
    return this.camera.position;
  }

  public getYaw(): number {
    if (this.mode === 'fps') {
      return this.fpsController.yaw;
    }
    return this.orbitController.azimuthalAngle;
  }

  public getPitch(): number {
    if (this.mode === 'fps') {
      return this.fpsController.pitch;
    }
    return this.orbitController.polarAngle;
  }

  public setPosition(pos: THREE.Vector3, yaw?: number): void {
    this.fpsController.setPosition(pos, yaw);
    this.playerRig.position.copy(pos);
    if (this.mode === 'fps') {
      this.camera.position.copy(pos);
    }
    this.checkCurrentZone();
  }

  public addObstacle(box: THREE.Box3, name?: string): void {
    this.collisionEngine.addObstacle(box, name);
  }

  public getCurrentZone(): ZoneId {
    return this.currentZoneId;
  }

  private checkCurrentZone(): void {
    const pos = this.getPosition();
    for (const key in OFFICE_ZONES) {
      if (OFFICE_ZONES[key].bounds.containsPoint(pos)) {
        if (this.currentZoneId !== key) {
          this.currentZoneId = key as ZoneId;
          if (this.onZoneChange) {
            this.onZoneChange(this.currentZoneId, OFFICE_ZONES[key]);
          }
        }
        return;
      }
    }
  }

  /**
   * Switches between First-Person Walkthrough and Isometric Overview mode
   */
  public setMode(newMode: 'fps' | 'orbit', smooth: boolean = true): void {
    if (this.mode === newMode && !this.transition.isActive) return;

    if (!smooth) {
      this.endTransitionImmediate(newMode);
      return;
    }

    // Determine Start and End Transforms
    const startPos = this.camera.position.clone();
    const startQuat = this.camera.quaternion.clone();
    const endPos = new THREE.Vector3();
    const endQuat = new THREE.Quaternion();
    let targetYaw = 0;
    let peakHeight = 4.5;

    if (newMode === 'orbit') {
      // Transitioning from FPS to Orbit Overview
      document.exitPointerLock?.();
      this.fpsController.unlock();
      this.fpsController.setEnabled(false);

      // Target overview position: Elevated isometric angle focusing on current room or floor center
      const targetLookAt = new THREE.Vector3(0, 1.2, 0);
      const orbitDistance = 30.0;
      const polar = Math.PI / 3.8;
      const azimuth = 0.0;

      endPos.set(
        targetLookAt.x + orbitDistance * Math.sin(polar) * Math.sin(azimuth),
        targetLookAt.y + orbitDistance * Math.cos(polar),
        targetLookAt.z + orbitDistance * Math.sin(polar) * Math.cos(azimuth)
      );

      // Compute destination orientation looking at target
      this._dummyCam.position.copy(endPos);
      this._dummyCam.lookAt(targetLookAt);
      endQuat.copy(this._dummyCam.quaternion);

      peakHeight = Math.max(endPos.y + 2.0, startPos.y + 5.0);
    } else {
      // Transitioning from Orbit to FPS
      this.orbitController.setEnabled(false);

      // Target FPS position: Zone spawn point or current target position on floor
      const targetZone = OFFICE_ZONES[this.currentZoneId] || OFFICE_ZONES.entrance;
      endPos.copy(targetZone.spawnPosition);
      targetYaw = targetZone.spawnYaw;

      this._scratchEuler.set(0, targetYaw, 0, 'YXZ');
      endQuat.setFromEuler(this._scratchEuler);

      peakHeight = Math.max(startPos.y + 2.0, 8.0);
    }

    this.startParabolicTransition(startPos, endPos, startQuat, endQuat, peakHeight, newMode, targetYaw, 1.25);
  }

  /**
   * Smooth or Instant Teleportation to a specific functional zone
   */
  public teleportTo(zoneKey: ZoneId | string, smooth: boolean = true): void {
    const zone = OFFICE_ZONES[zoneKey];
    if (!zone) {
      console.warn(`[NavigationManager] Unknown zone: ${zoneKey}`);
      return;
    }

    if (this.mode === 'orbit') {
      // In Orbit mode, smoothly pan the overview camera to focus on the target zone
      this.orbitController.setTarget(zone.center);
      this.currentZoneId = zone.id;
      if (this.onZoneChange) this.onZoneChange(zone.id, zone);
      return;
    }

    if (!smooth) {
      this.setPosition(zone.spawnPosition, zone.spawnYaw);
      return;
    }

    // In FPS mode, perform smooth parabolic loft flight between rooms
    const startPos = this.camera.position.clone();
    const startQuat = this.camera.quaternion.clone();
    const endPos = zone.spawnPosition.clone();
    const endQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, zone.spawnYaw, 0, 'YXZ'));

    const horizontalDist = new THREE.Vector2(endPos.x - startPos.x, endPos.z - startPos.z).length();
    const peakHeight = Math.max(startPos.y, endPos.y) + Math.min(Math.max(horizontalDist * 0.35, 4.0), 9.0);
    const duration = Math.min(Math.max(horizontalDist * 0.05 + 0.8, 1.0), 2.2);

    this.startParabolicTransition(startPos, endPos, startQuat, endQuat, peakHeight, 'fps', zone.spawnYaw, duration, () => {
      this.currentZoneId = zone.id;
      if (this.onZoneChange) this.onZoneChange(zone.id, zone);
    });
  }

  private startParabolicTransition(
    startPos: THREE.Vector3,
    endPos: THREE.Vector3,
    startQuat: THREE.Quaternion,
    endQuat: THREE.Quaternion,
    peakHeight: number,
    targetMode: 'fps' | 'orbit',
    targetYaw: number,
    duration: number,
    onComplete?: () => void
  ): void {
    this.mode = 'transitioning';
    if (this.onModeChange) this.onModeChange('transitioning');

    this.transition.isActive = true;
    this.transition.startTime = performance.now();
    this.transition.duration = duration * 1000;
    this.transition.startPos.copy(startPos);
    this.transition.endPos.copy(endPos);
    this.transition.startQuat.copy(startQuat);
    this.transition.endQuat.copy(endQuat);
    this.transition.peakHeight = peakHeight;
    this.transition.targetMode = targetMode;
    this.transition.targetYaw = targetYaw;
    this.transition.onComplete = onComplete;
  }

  private endTransitionImmediate(targetMode: 'fps' | 'orbit'): void {
    this.transition.isActive = false;
    this.mode = targetMode;

    if (targetMode === 'fps') {
      this.orbitController.setEnabled(false);
      this.fpsController.setEnabled(true);
    } else {
      this.fpsController.setEnabled(false);
      this.orbitController.setEnabled(true);
      this.orbitController.syncFromCamera();
    }

    if (this.onModeChange) this.onModeChange(targetMode);
  }

  public update(delta: number): void {
    if (this.transition.isActive) {
      const elapsed = performance.now() - this.transition.startTime;
      const progress = Math.min(1.0, elapsed / this.transition.duration);

      // Quintic Smoothstep Easing (Perlin's SmootherStep): 6u^5 - 15u^4 + 10u^3
      const u = progress;
      const s = u * u * u * (u * (u * 6 - 15) + 10);

      // Horizontal linear interpolation
      const currentX = THREE.MathUtils.lerp(this.transition.startPos.x, this.transition.endPos.x, s);
      const currentZ = THREE.MathUtils.lerp(this.transition.startPos.z, this.transition.endPos.z, s);

      // Vertical Parabolic Arc Lofting: y(u) = lerp(y0, y1, s) + 4 * H * u * (1 - u)
      const baseHeight = THREE.MathUtils.lerp(this.transition.startPos.y, this.transition.endPos.y, s);
      const arcHeight = 4 * (this.transition.peakHeight - Math.max(this.transition.startPos.y, this.transition.endPos.y)) * u * (1 - u);
      const currentY = baseHeight + Math.max(0, arcHeight);

      this.camera.position.set(currentX, currentY, currentZ);

      // Orientation SLERP
      this._scratchQuat.copy(this.transition.startQuat).slerp(this.transition.endQuat, s);
      this.camera.quaternion.copy(this._scratchQuat);

      if (progress >= 1.0) {
        this.transition.isActive = false;
        this.mode = this.transition.targetMode;

        if (this.transition.targetMode === 'fps') {
          this.orbitController.setEnabled(false);
          this.fpsController.setPosition(this.transition.endPos, this.transition.targetYaw);
          this.fpsController.setEnabled(true);
        } else {
          this.fpsController.setEnabled(false);
          this.orbitController.setEnabled(true);
          this.orbitController.syncFromCamera();
        }

        if (this.transition.onComplete) {
          this.transition.onComplete();
        }

        if (this.onModeChange) {
          this.onModeChange(this.mode);
        }
      }
      return;
    }

    if (this.mode === 'fps') {
      this.fpsController.update(delta);
      this.playerRig.position.copy(this.fpsController.position);
      this.checkCurrentZone();
    } else if (this.mode === 'orbit') {
      this.orbitController.update(delta);
      this.checkCurrentZone();
    }
  }
}
```

---

### 4.3 Integration Patch for `src/main.ts`

```typescript
// Replacement for main.ts bootstrap logic wiring NavigationManager
import { NavigationManager } from './navigation/NavigationManager';

// ... Inside bootstrap() ...
// 6. Initialize Navigation Subsystem
const navigationManager = new NavigationManager(sceneManager.scene, sceneManager.camera);
navigationManager.init(webglContainer);

// Register all architectural obstacles from floorplan into collision engine
const obstacles = floorplan.getObstacles();
for (const obs of obstacles) {
  navigationManager.addObstacle(obs.box, obs.name);
}

// Register NavigationManager update hook in render loop
sceneManager.registerUpdateCallback((delta) => {
  navigationManager.update(delta);
});

// Wire HUD mode badge and toggle button
navigationManager.onModeChange = (mode) => {
  const modeBadge = document.getElementById('mode-text');
  const btnMode = document.getElementById('btn-mode-toggle');
  if (mode === 'orbit') {
    if (modeBadge) modeBadge.textContent = 'ORBIT OVERVIEW';
    if (btnMode) btnMode.querySelector('.btn-text')!.textContent = 'FPS View [V]';
  } else if (mode === 'fps') {
    if (modeBadge) modeBadge.textContent = 'FPS WALKTHROUGH';
    if (btnMode) btnMode.querySelector('.btn-text')!.textContent = 'Orbit View [V]';
  } else {
    if (modeBadge) modeBadge.textContent = 'TRANSITIONING...';
  }
};

// Wire Zone Banner update
navigationManager.onZoneChange = (zoneId, zoneData) => {
  const zoneText = document.getElementById('zone-text');
  if (zoneText) zoneText.textContent = zoneData.displayName;
};

// Wire Keyboard [V] & Mode button
const toggleViewMode = () => {
  if (navigationManager.mode === 'fps') {
    navigationManager.setMode('orbit', true);
  } else if (navigationManager.mode === 'orbit') {
    navigationManager.setMode('fps', true);
  }
};

// Wire Teleportation buttons
document.querySelectorAll('.teleport-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const zone = btn.getAttribute('data-zone');
    if (zone) navigationManager.teleportTo(zone, true);
  });
});

// Update __OFFICE_DEBUG__ Contract
(window as any).__OFFICE_DEBUG__ = {
  sceneManager,
  navigationManager,
  getFPS: () => sceneManager.getFPS(),
  getDrawCalls: () => sceneManager.getDrawCalls(),
  getTriangleCount: () => sceneManager.getTriangleCount(),
  getPlayerPosition: () => ({
    x: navigationManager.getPosition().x,
    y: navigationManager.getPosition().y,
    z: navigationManager.getPosition().z,
    yaw: navigationManager.getYaw()
  }),
  teleport: (zone: string) => {
    navigationManager.teleportTo(zone, false);
    return true;
  },
  setMode: (mode: string) => {
    if (mode === 'fps' || mode === 'orbit') {
      navigationManager.setMode(mode as any, false);
      return true;
    }
    return false;
  }
  // ... other debug methods
};
```

---

## 5. Verification Method

To independently verify this implementation:

1. **TypeScript Typecheck & Build**:
   ```bash
   npm run typecheck
   npm run build
   ```
2. **Automated Playwright Navigation & Transition E2E Checks**:
   - `tests/e2e/tier1-feature.spec.ts`:
     - Assert `window.__OFFICE_DEBUG__.navigationManager.mode === 'fps'` on initial load.
     - Call `window.__OFFICE_DEBUG__.navigationManager.setMode('orbit', true)`. Verify mode transitions through `'transitioning'` to `'orbit'`.
     - Verify camera altitude $y > 20\text{m}$ in Orbit mode.
     - Call `window.__OFFICE_DEBUG__.navigationManager.setMode('fps', true)`. Verify camera altitude smoothly returns to eye-height $y = 1.6\text{m}$.
     - Call `window.__OFFICE_DEBUG__.teleport('conference')`. Verify player coordinates match conference spawn $(12.0, 1.6, -1.5) \pm 0.1\text{m}$.
3. **Parabolic Trajectory & Easing Verification**:
   - Assert $y(t)$ during transition exceeds $\max(y_0, y_1)$ at midpoint ($t=0.5$).
   - Assert zero camera snapping or frame stutter throughout 1.25s transition duration.
