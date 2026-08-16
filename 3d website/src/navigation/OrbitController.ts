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
  public polarAngle: number = Math.PI / 3.8; // ~47 degrees (Isometric elevation)
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
  public maxPolarAngle: number = Math.PI / 2.2; // ~81.8 deg (Above floor plane)
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
  private previousPointerPosition = { x: 0, y: 0 };
  private activePointers: Map<number, { x: number; y: number }> = new Map();
  private initialPinchDistance: number = 0;

  // Scratch objects for zero-GC performance
  private _scratchVec: THREE.Vector3 = new THREE.Vector3();
  private _camRight: THREE.Vector3 = new THREE.Vector3();
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

    // Ignore clicks on HUD overlay elements (except canvas/viewport)
    const target = event.target as HTMLElement;
    if (target && target.closest('#hud-layer') && !target.closest('#reticle')) {
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
      this.initialPinchDistance = Math.hypot(dx, dy);
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
      const pinchDist = Math.hypot(dx, dy);
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
    if (!this.camera) return;

    // Calculate camera basis vectors projected on ground
    this.camera.getWorldDirection(this._camForward);
    this._camRight.crossVectors(this._camForward, this.camera.up).normalize();

    // Scale pan speed with distance for natural feeling at all zoom levels
    const scale = this.distance * this.panSpeed * 0.05;

    // Pan in XZ ground plane
    const moveRight = this._camRight.clone().multiplyScalar(-deltaX * scale);
    
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
    if (!this.camera) return;

    const offset = this._scratchVec.subVectors(this.camera.position, this.target);
    const rawDistance = offset.length();
    this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, rawDistance));
    this.targetDistance = this.distance;

    if (rawDistance > 0.001) {
      const calculatedPolar = Math.acos(Math.max(-1, Math.min(1, offset.y / rawDistance)));
      this.polarAngle = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, calculatedPolar));
      this.azimuthalAngle = Math.atan2(offset.x, offset.z);
    } else {
      this.polarAngle = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, Math.PI / 4));
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
    if (!this.isEnabled || !this.camera) return;

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
