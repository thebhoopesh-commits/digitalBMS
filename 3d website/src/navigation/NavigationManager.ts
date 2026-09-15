import * as THREE from 'three';
import {
  INavigationManager,
  NavigationMode,
  ZoneId,
  SurfaceType,
  ZoneBounds,
  WorldBounds
} from '../types';
import { FirstPersonController } from './FirstPersonController';
import { OrbitController } from './OrbitController';
import { CollisionEngine } from './CollisionEngine';

export interface TransitionState {
  isActive: boolean;
  startTime: number;
  duration: number;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startQuat: THREE.Quaternion;
  endQuat: THREE.Quaternion;
  peakHeight: number;
  targetMode: 'fps' | 'orbit' | 'focus';
  targetYaw: number;
  onComplete?: () => void;
}

export class NavigationManager implements INavigationManager {
  public mode: NavigationMode = 'fps';
  public playerRig: THREE.Object3D;
  public camera: THREE.PerspectiveCamera;
  public collisionEngine: CollisionEngine;

  public fpsController: FirstPersonController;
  public orbitController: OrbitController;

  public onFootstep?: (surface?: SurfaceType) => void;
  public onModeChange?: (mode: NavigationMode) => void;
  public onZoneChange?: (zone: ZoneId, zoneData: ZoneBounds) => void;

  private scene: THREE.Scene;
  private domElement!: HTMLElement;
  private currentZoneId: ZoneId = 'lobby';
  private zones: Record<string, ZoneBounds> = {};
  private defaultSpawnPosition: THREE.Vector3 = new THREE.Vector3(0.0, 1.6, 11.0);
  private defaultSpawnYaw: number = 0.0;

  // Parabolic transition state
  private transition: TransitionState = {
    isActive: false,
    startTime: 0,
    duration: 1000,
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    startQuat: new THREE.Quaternion(),
    endQuat: new THREE.Quaternion(),
    peakHeight: 5.0,
    targetMode: 'fps',
    targetYaw: 0
  };

  // Scratch variables for zero-GC math
  private _scratchQuat: THREE.Quaternion = new THREE.Quaternion();
  private _scratchEuler: THREE.Euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private _dummyCam: THREE.PerspectiveCamera = new THREE.PerspectiveCamera();

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;

    this.collisionEngine = new CollisionEngine();
    this.fpsController = new FirstPersonController(this.collisionEngine);
    this.orbitController = new OrbitController();

    this.playerRig = this.fpsController.playerRig;
    this.scene.add(this.playerRig);

    // Wire up footstep callback
    this.fpsController.onFootstep = (surface) => {
      if (this.onFootstep) this.onFootstep(surface);
    };
  }

  public init(domElement: HTMLElement): void {
    this.domElement = domElement;

    this.fpsController.init(domElement, this.camera);
    this.orbitController.init(domElement, this.camera);

    // Initial state: Start in FPS mode at lobby
    this.setPosition(this.defaultSpawnPosition, this.defaultSpawnYaw);

    this.fpsController.setEnabled(true);
    this.orbitController.setEnabled(false);
    this.mode = 'fps';
  }

  public setActiveZoneRegistry(zones: Record<string, ZoneBounds>): void {
    this.zones = { ...zones };
    this.checkCurrentZone();
  }

  public setEnvironment(
    zones: Record<string, ZoneBounds>,
    defaultSpawn?: { position: THREE.Vector3; yaw: number },
    worldBounds?: WorldBounds
  ): void {
    if (this.transition.isActive) {
      this.transition.isActive = false;
    }
    if (this.mode === 'focus') {
      this.exitFocusMode();
    }

    this.zones = { ...zones };
    if (defaultSpawn) {
      this.defaultSpawnPosition.copy(defaultSpawn.position);
      this.defaultSpawnYaw = defaultSpawn.yaw;
    } else {
      const firstZone = Object.values(this.zones)[0];
      if (firstZone) {
        this.defaultSpawnPosition.copy(firstZone.spawnPosition);
        this.defaultSpawnYaw = firstZone.spawnYaw;
      }
    }

    if (worldBounds) {
      this.collisionEngine.setBounds(worldBounds);
    }

    this.setPosition(this.defaultSpawnPosition, this.defaultSpawnYaw);

    if (this.mode === 'orbit') {
      const center = worldBounds
        ? new THREE.Vector3((worldBounds.minX + worldBounds.maxX) / 2, 1.2, (worldBounds.minZ + worldBounds.maxZ) / 2)
        : new THREE.Vector3(0, 1.2, 0);
      this.orbitController.setTarget(center, true);
    }

    this.checkCurrentZone();
  }

  public setObstacles(
    obstacles: Array<{ box: THREE.Box3; name?: string; id?: string; isDoor?: boolean }>,
    worldBounds?: WorldBounds
  ): void {
    this.collisionEngine.clearObstacles();
    if (worldBounds) {
      this.collisionEngine.setBounds(worldBounds);
    }
    for (const obs of obstacles) {
      this.collisionEngine.addObstacle(obs.box, obs.name, obs.id, obs.isDoor);
    }
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
    if (this.transition.isActive) {
      this.transition.isActive = false;
    }
    if (this.mode === 'transitioning' || this.mode === 'focus') {
      this.mode = 'fps';
      this.fpsController.pitchObject.add(this.camera);
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, 0, 0);
      this.fpsController.setEnabled(true);
      if (this.onModeChange) this.onModeChange('fps');
    }

    this.fpsController.setPosition(pos, yaw);
    this.playerRig.position.set(pos.x, 0, pos.z);

    if (this.mode === 'orbit') {
      this.orbitController.setTarget(new THREE.Vector3(pos.x, 1.2, pos.z), true);
    }
    this.checkCurrentZone();
  }

  public addObstacle(box: THREE.Box3, name?: string, id?: string, isDoor?: boolean): void {
    this.collisionEngine.addObstacle(box, name, id, isDoor);
  }

  public getCurrentZone(): ZoneId {
    return this.currentZoneId;
  }

  private checkCurrentZone(): void {
    const pos = this.getPosition();
    for (const key in this.zones) {
      if (this.zones[key].bounds.containsPoint(pos)) {
        if (this.currentZoneId !== key) {
          this.currentZoneId = key as ZoneId;
          if (this.onZoneChange) {
            this.onZoneChange(this.currentZoneId, this.zones[key]);
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

    // Get starting world transforms
    const startPos = new THREE.Vector3();
    const startQuat = new THREE.Quaternion();
    this.camera.getWorldPosition(startPos);
    this.camera.getWorldQuaternion(startQuat);

    // Unparent camera so world trajectory is directly controllable
    this.scene.add(this.camera);
    this.camera.position.copy(startPos);
    this.camera.quaternion.copy(startQuat);

    const endPos = new THREE.Vector3();
    const endQuat = new THREE.Quaternion();
    let targetYaw = 0;
    let peakHeight = 5.0;

    if (newMode === 'orbit') {
      // Transitioning from FPS to Orbit Overview
      this.fpsController.unlock();
      this.fpsController.setEnabled(false);

      // Target overview position: Elevated isometric angle focusing on current room or floor center
      const targetLookAt = new THREE.Vector3(0, 1.2, 0);
      const orbitDistance = 28.0;
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

      peakHeight = Math.max(endPos.y + 2.0, startPos.y + 3.0);
    } else {
      // Transitioning from Orbit to FPS
      this.orbitController.setEnabled(false);

      // Target FPS position: Zone spawn point
      const targetZone = this.zones[this.currentZoneId] || Object.values(this.zones)[0];
      if (targetZone) {
        endPos.copy(targetZone.spawnPosition);
        targetYaw = targetZone.spawnYaw;
      } else {
        endPos.copy(this.defaultSpawnPosition);
        targetYaw = this.defaultSpawnYaw;
      }

      this._scratchEuler.set(0, targetYaw, 0, 'YXZ');
      endQuat.setFromEuler(this._scratchEuler);

      peakHeight = Math.max(startPos.y + 1.0, 6.0);
    }

    const horizDist = Math.hypot(endPos.x - startPos.x, endPos.z - startPos.z);
    const duration = Math.min(Math.max(horizDist * 0.02 + 0.6, 0.8), 1.2);

    this.startParabolicTransition(startPos, endPos, startQuat, endQuat, peakHeight, newMode, targetYaw, duration);
  }

  /**
   * Focus Mode: Moves the camera directly in front of a target object (e.g. a Glass Board).
   */
  public focusOnObject(targetObject: THREE.Object3D, distance: number = 2.0, duration: number = 0.8): void {
    if (this.transition.isActive) {
      this.transition.isActive = false;
    }

    const startPos = new THREE.Vector3();
    const startQuat = new THREE.Quaternion();
    this.camera.getWorldPosition(startPos);
    this.camera.getWorldQuaternion(startQuat);

    // Unparent camera into scene for transition flight
    this.scene.add(this.camera);
    this.camera.position.copy(startPos);
    this.camera.quaternion.copy(startQuat);

    // Determine target focus position
    const endPos = new THREE.Vector3();
    targetObject.getWorldPosition(endPos);
    
    // Get the forward vector of the object to push the camera back
    const forward = new THREE.Vector3(0, 0, 1);
    forward.applyQuaternion(targetObject.quaternion).normalize();
    endPos.add(forward.multiplyScalar(distance));
    
    // Calculate target orientation to face the object perfectly
    const endQuat = new THREE.Quaternion();
    this._dummyCam.position.copy(endPos);
    this._dummyCam.lookAt(targetObject.getWorldPosition(new THREE.Vector3()));
    endQuat.copy(this._dummyCam.quaternion);

    // Disable standard controllers during focus
    this.fpsController.setEnabled(false);
    this.orbitController.setEnabled(false);
    
    // Instant transition
    this.camera.position.copy(endPos);
    this.camera.quaternion.copy(endQuat);
    this.mode = 'focus';
    if (this.onModeChange) this.onModeChange('focus');
  }

  public exitFocusMode(): void {
    if (this.mode !== 'focus') return;
    
    this.mode = 'fps';
    this.fpsController.pitchObject.add(this.camera);
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);
    this.fpsController.setEnabled(true);
    
    if (this.onModeChange) this.onModeChange('fps');
  }

  /**
   * Smooth or Instant Teleportation to a specific functional zone
   */
  public teleportTo(zoneKey: ZoneId | string, smooth: boolean = true): void {
    const zone = this.zones[zoneKey];
    if (!zone) {
      console.warn(`[NavigationManager] Unknown zone: ${zoneKey}`);
      return;
    }

    if (!smooth) {
      if (this.transition.isActive) {
        this.transition.isActive = false;
      }
      if (this.mode === 'orbit') {
        this.orbitController.setTarget(zone.center, true);
      } else {
        if (this.mode === 'transitioning') {
          this.endTransitionImmediate('fps');
        }
        this.setPosition(zone.spawnPosition, zone.spawnYaw);
      }
      this.currentZoneId = zone.id;
      if (this.onZoneChange) this.onZoneChange(zone.id, zone);
      return;
    }

    if (this.mode === 'orbit') {
      // In Orbit mode, smoothly pan the overview camera to focus on the target zone
      this.orbitController.setTarget(zone.center);
      this.currentZoneId = zone.id;
      if (this.onZoneChange) this.onZoneChange(zone.id, zone);
      return;
    }

    // In FPS mode, perform smooth parabolic loft flight between rooms
    const startPos = new THREE.Vector3();
    const startQuat = new THREE.Quaternion();
    this.camera.getWorldPosition(startPos);
    this.camera.getWorldQuaternion(startQuat);

    // Unparent camera into scene for transition flight
    this.scene.add(this.camera);
    this.camera.position.copy(startPos);
    this.camera.quaternion.copy(startQuat);

    const endPos = zone.spawnPosition.clone();
    const endQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, zone.spawnYaw, 0, 'YXZ'));

    const horizontalDist = Math.hypot(endPos.x - startPos.x, endPos.z - startPos.z);
    const peakHeight = Math.max(startPos.y, endPos.y) + Math.min(Math.max(horizontalDist * 0.25, 3.5), 7.0);
    const duration = Math.min(Math.max(horizontalDist * 0.02 + 0.6, 0.8), 1.3);

    this.fpsController.setEnabled(false);

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
    targetMode: 'fps' | 'orbit' | 'focus',
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
      this.fpsController.pitchObject.add(this.camera);
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, 0, 0);
      const zone = this.zones[this.currentZoneId] || Object.values(this.zones)[0];
      if (zone) {
        this.fpsController.setPosition(zone.spawnPosition, zone.spawnYaw);
      } else {
        this.fpsController.setPosition(this.defaultSpawnPosition, this.defaultSpawnYaw);
      }
      this.fpsController.setEnabled(true);
    } else {
      this.fpsController.setEnabled(false);
      this.scene.add(this.camera);
      this.orbitController.setEnabled(true);
      this.orbitController.setOrbitView(28.0, Math.PI / 3.8, 0.0, true);
      this.orbitController.update(0.016);
    }

    if (this.onModeChange) this.onModeChange(targetMode);
  }

  public update(delta: number): void {
    if (this.transition.isActive) {
      const elapsed = performance.now() - this.transition.startTime;
      const progress = Math.min(1.0, elapsed / this.transition.duration);

      // Quintic Smoothstep Easing (SmootherStep): 6u^5 - 15u^4 + 10u^3
      const u = progress;
      const s = u * u * u * (u * (u * 6 - 15) + 10);

      // Horizontal linear interpolation
      const currentX = THREE.MathUtils.lerp(this.transition.startPos.x, this.transition.endPos.x, s);
      const currentZ = THREE.MathUtils.lerp(this.transition.startPos.z, this.transition.endPos.z, s);

      // Vertical Parabolic Arc Lofting: y(u) = lerp(y0, y1, s) + 4 * H * u * (1 - u)
      const baseHeight = THREE.MathUtils.lerp(this.transition.startPos.y, this.transition.endPos.y, s);
      const arcMax = this.transition.peakHeight - Math.max(this.transition.startPos.y, this.transition.endPos.y);
      const arcHeight = 4 * Math.max(0, arcMax) * u * (1 - u);
      const currentY = baseHeight + arcHeight;

      this.camera.position.set(currentX, currentY, currentZ);

      // Orientation SLERP
      this._scratchQuat.copy(this.transition.startQuat).slerp(this.transition.endQuat, s);
      this.camera.quaternion.copy(this._scratchQuat);

      if (progress >= 1.0) {
        this.transition.isActive = false;
        this.mode = this.transition.targetMode;

        if (this.transition.targetMode === 'fps') {
          this.orbitController.setEnabled(false);
          this.fpsController.pitchObject.add(this.camera);
          this.camera.position.set(0, 0, 0);
          this.camera.rotation.set(0, 0, 0);
          this.fpsController.setPosition(this.transition.endPos, this.transition.targetYaw);
          this.fpsController.setEnabled(true);
        } else if (this.transition.targetMode === 'orbit') {
          this.fpsController.setEnabled(false);
          this.scene.add(this.camera);
          this.orbitController.setEnabled(true);
          this.orbitController.syncFromCamera();
        } else if (this.transition.targetMode === 'focus') {
          this.fpsController.setEnabled(false);
          this.orbitController.setEnabled(false);
          this.scene.add(this.camera);
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
      this.checkCurrentZone();
    } else if (this.mode === 'orbit') {
      this.orbitController.update(delta);
      this.checkCurrentZone();
    }
  }
}
