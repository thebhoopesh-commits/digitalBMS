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
  // 1. Hierarchy Nodes (3-Tier Camera Rig)
  public playerRig: THREE.Group;    // Tier 0: Root world position (X, 0, Z)
  public yawObject: THREE.Group;    // Tier 1: Eye-height & Azimuth (0, 1.6, 0)
  public pitchObject: THREE.Group;  // Tier 2: Elevation (-85° to +85°)
  public camera!: THREE.PerspectiveCamera; // Tier 3: Local bobbing offsets

  // 2. Kinematic State
  public isLocked: boolean = false;
  public isSprinting: boolean = false;
  public isEnabled: boolean = false;
  public velocity: THREE.Vector3 = new THREE.Vector3();
  public position: THREE.Vector3 = new THREE.Vector3(0, 1.6, 11.5);
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
  private maxPitch: number = (85 * Math.PI) / 180; // ~1.4835 rad

  // 4. Input State Tracking
  private keys = {
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

  constructor(collisionEngine?: ICollisionEngine, options: FirstPersonControllerOptions = {}) {
    this.collisionEngine = collisionEngine;
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
    if (this.domElement) {
      this.domElement.removeEventListener('click', this.onDomClick);
    }
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    document.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.unlock();
  }

  private onDomClick = (event: MouseEvent): void => {
    if (!this.isEnabled) return;
    // Don't capture pointer lock if clicking on interactive HUD elements outside viewport
    const target = event.target as HTMLElement;
    if (target && target.closest('#hud-layer') && !target.closest('#reticle')) {
      return;
    }
    this.lock();
  };

  public lock(): void {
    if (this.domElement && document.pointerLockElement !== this.domElement) {
      try {
        const promise = this.domElement.requestPointerLock() as any;
        if (promise && promise.catch) {
          promise.catch(() => {});
        }
      } catch (_) {}
    }
  }

  public unlock(): void {
    if (document.pointerLockElement === this.domElement) {
      try {
        document.exitPointerLock();
      } catch (_) {}
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
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

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
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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
    // Anchor physical rig root at Y=0, while keeping eye height at 1.6m
    this.playerRig.position.set(pos.x, 0, pos.z);
    this.position.set(pos.x, this.eyeHeight, pos.z);

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
    this.position.set(this.playerRig.position.x, this.eyeHeight, this.playerRig.position.z);

    // 6. Dual-Harmonic Head-Bobbing & Audio Cadence
    this.updateHeadBob(clampedDelta, currentSpeed);

    // 7. Dynamic FOV Kick during Sprint
    if (this.camera) {
      const targetFov = this.isSprinting ? this.sprintFov : this.baseFov;
      if (Math.abs(this.camera.fov - targetFov) > 0.01) {
        this.camera.fov += (targetFov - this.camera.fov) * (1.0 - Math.exp(-8.0 * clampedDelta));
        this.camera.updateProjectionMatrix();
      }
    }
  }

  private updateHeadBob(delta: number, speed: number): void {
    if (!this.camera) return;

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
        const surface = this.detectSurfaceAtPosition(this.playerRig.position);
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

  private detectSurfaceAtPosition(pos: THREE.Vector3): SurfaceType {
    if (this.getSurfaceAtPosition) {
      return this.getSurfaceAtPosition(pos);
    }
    // Default surface mapping by coordinate zones
    if (pos.z < 0 && pos.x < 4) return 'carpet';      // Workstations
    if (pos.z < 0 && pos.x >= 4) return 'wood';       // Conference
    if (pos.z >= 0 && pos.x >= 4) return 'tile';      // Lounge
    if (pos.z >= 0 && pos.x < 0) return 'wood';       // Reception
    return 'tile';                                    // Circulation / Entrance
  }
}
