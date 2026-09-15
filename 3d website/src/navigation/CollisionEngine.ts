import * as THREE from 'three';
import { AABBObstacle, ICollisionEngine } from '../types';

export class CollisionEngine implements ICollisionEngine {
  public static instances: Set<CollisionEngine> = new Set();
  public obstacles: AABBObstacle[] = [];

  // Boundary wall constraints of the active floorplan
  public BOUNDS = {
    minX: -19.5,
    maxX: 19.5,
    minZ: -12.5,
    maxZ: 12.5,
    minY: 0.0,
    maxY: 4.0
  };

  public setBounds(bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY?: number; maxY?: number }): void {
    this.BOUNDS.minX = bounds.minX;
    this.BOUNDS.maxX = bounds.maxX;
    this.BOUNDS.minZ = bounds.minZ;
    this.BOUNDS.maxZ = bounds.maxZ;
    if (bounds.minY !== undefined) this.BOUNDS.minY = bounds.minY;
    if (bounds.maxY !== undefined) this.BOUNDS.maxY = bounds.maxY;
  }

  // Numerical tolerances
  private readonly EPSILON = 0.001; // 1mm skin buffer
  private readonly ALLOW_EPSILON = 0.05; // 50mm approach tolerance

  // Pre-allocated scratch objects for zero GC pressure during 60 FPS update
  private _resolvedPos = new THREE.Vector3();
  private _stepMovement = new THREE.Vector3();
  private _tempPos = new THREE.Vector3();

  constructor(initialObstacles?: AABBObstacle[]) {
    CollisionEngine.instances.add(this);
    if (initialObstacles) {
      this.obstacles = [...initialObstacles];
    }
  }

  public static notifyDoorState(doorId: string, isOpen: boolean): void {
    CollisionEngine.instances.forEach(instance => instance.setDoorOpen(doorId, isOpen));
  }

  public addObstacle(box: THREE.Box3, name = 'obstacle', id?: string, isDoor = false): void {
    this.obstacles.push({
      id: id || `obstacle_${this.obstacles.length + 1}`,
      name,
      min: box.min.clone(),
      max: box.max.clone(),
      isDoor,
      isOpen: false
    });
  }

  public setObstacles(obstacles: AABBObstacle[]): void {
    this.obstacles = [...obstacles];
  }

  public clearObstacles(): void {
    this.obstacles = [];
  }

  public setDoorOpen(doorId: string, isOpen: boolean): void {
    const door = this.obstacles.find(o => o.id === doorId);
    if (door) {
      door.isOpen = isOpen;
    }
  }

  /**
   * Decoupled Multi-Axis Sliding AABB Collision Resolver
   * Resolves player movement independently along the X and Z axes to allow smooth
   * wall-sliding physics without friction lock or sticky corners.
   */
  public resolveMovement(
    currentPos: THREE.Vector3,
    desiredMovement: THREE.Vector3,
    playerRadius = 0.35,
    playerHeight = 1.80
  ): THREE.Vector3 {
    const moveLength = Math.hypot(desiredMovement.x, desiredMovement.z);
    if (moveLength < 1e-6) {
      this._resolvedPos.copy(currentPos);
      return this._resolvedPos;
    }

    // Adaptive CCD Sub-stepping to prevent tunneling at high velocities or frame drops
    const maxSubStep = playerRadius * 0.5; // 0.175m max displacement per sub-step
    const subSteps = Math.max(1, Math.ceil(moveLength / maxSubStep));
    const invSteps = 1.0 / subSteps;

    this._stepMovement.set(
      desiredMovement.x * invSteps,
      desiredMovement.y * invSteps,
      desiredMovement.z * invSteps
    );

    this._tempPos.copy(currentPos);

    for (let step = 0; step < subSteps; step++) {
      this._resolveSingleStep(this._tempPos, this._stepMovement, playerRadius, playerHeight);
    }

    this._resolvedPos.copy(this._tempPos);
    return this._resolvedPos;
  }

  private _resolveSingleStep(
    pos: THREE.Vector3,
    movement: THREE.Vector3,
    radius: number,
    height: number
  ): void {
    const playerBaseY = pos.y - 1.60; // Camera eye-height offset
    const playerTopY = playerBaseY + height;

    let xCandidate = pos.x + movement.x;

    // -------------------------------------------------------------
    // AXIS 1: Resolve X Movement against active obstacles
    // -------------------------------------------------------------
    for (let i = 0; i < this.obstacles.length; i++) {
      const obs = this.obstacles[i];
      if (obs.isOpen) continue; // Open doors allow traversal

      // Vertical overlap check
      if (playerBaseY >= obs.max.y || playerTopY <= obs.min.y) continue;

      // Check if current Z is within expanded obstacle Z-span
      if (pos.z > obs.min.z - radius && pos.z < obs.max.z + radius) {
        if (movement.x > 0) {
          // Moving East (+X) -> player left of obstacle
          if (pos.x + radius <= obs.min.x + this.ALLOW_EPSILON) {
            if (xCandidate + radius > obs.min.x) {
              xCandidate = Math.min(xCandidate, obs.min.x - radius - this.EPSILON);
            }
          }
        } else if (movement.x < 0) {
          // Moving West (-X) -> player right of obstacle
          if (pos.x - radius >= obs.max.x - this.ALLOW_EPSILON) {
            if (xCandidate - radius < obs.max.x) {
              xCandidate = Math.max(xCandidate, obs.max.x + radius + this.EPSILON);
            }
          }
        }
      }
    }

    // Clamp X to office outer boundary walls
    xCandidate = Math.max(this.BOUNDS.minX, Math.min(this.BOUNDS.maxX, xCandidate));
    pos.x = xCandidate;

    // -------------------------------------------------------------
    // AXIS 2: Resolve Z Movement against active obstacles
    // -------------------------------------------------------------
    let zCandidateResolved = pos.z + movement.z;

    for (let i = 0; i < this.obstacles.length; i++) {
      const obs = this.obstacles[i];
      if (obs.isOpen) continue;

      // Vertical overlap check
      if (playerBaseY >= obs.max.y || playerTopY <= obs.min.y) continue;

      // Check if resolved X is within expanded obstacle X-span
      if (pos.x > obs.min.x - radius && pos.x < obs.max.x + radius) {
        if (movement.z > 0) {
          // Moving South (+Z) -> player north of obstacle
          if (pos.z + radius <= obs.min.z + this.ALLOW_EPSILON) {
            if (zCandidateResolved + radius > obs.min.z) {
              zCandidateResolved = Math.min(zCandidateResolved, obs.min.z - radius - this.EPSILON);
            }
          }
        } else if (movement.z < 0) {
          // Moving North (-Z) -> player south of obstacle
          if (pos.z - radius >= obs.max.z - this.ALLOW_EPSILON) {
            if (zCandidateResolved - radius < obs.max.z) {
              zCandidateResolved = Math.max(zCandidateResolved, obs.max.z + radius + this.EPSILON);
            }
          }
        }
      }
    }

    // Clamp Z to office outer boundary walls
    zCandidateResolved = Math.max(this.BOUNDS.minZ, Math.min(this.BOUNDS.maxZ, zCandidateResolved));
    pos.z = zCandidateResolved;

    // -------------------------------------------------------------
    // AXIS 3: Fine Corner Depenetration Post-Pass
    // -------------------------------------------------------------
    for (let i = 0; i < this.obstacles.length; i++) {
      const obs = this.obstacles[i];
      if (obs.isOpen) continue;
      if (playerBaseY >= obs.max.y || playerTopY <= obs.min.y) continue;

      const closestX = Math.max(obs.min.x, Math.min(obs.max.x, pos.x));
      const closestZ = Math.max(obs.min.z, Math.min(obs.max.z, pos.z));

      const dx = pos.x - closestX;
      const dz = pos.z - closestZ;
      const distSq = dx * dx + dz * dz;

      if (distSq < radius * radius && distSq > 1e-8) {
        const dist = Math.sqrt(distSq);
        const overlap = radius - dist + this.EPSILON;
        pos.x += (dx / dist) * overlap;
        pos.z += (dz / dist) * overlap;
      }
    }

    // Re-apply boundary clamp after corner depenetration
    pos.x = Math.max(this.BOUNDS.minX, Math.min(this.BOUNDS.maxX, pos.x));
    pos.z = Math.max(this.BOUNDS.minZ, Math.min(this.BOUNDS.maxZ, pos.z));
  }

  /**
   * Fast Boolean Validity Check (e.g. for teleport validation)
   */
  public isPositionValid(position: THREE.Vector3, playerRadius = 0.35, playerHeight = 1.80): boolean {
    if (
      position.x < this.BOUNDS.minX ||
      position.x > this.BOUNDS.maxX ||
      position.z < this.BOUNDS.minZ ||
      position.z > this.BOUNDS.maxZ
    ) {
      return false;
    }

    const playerBaseY = position.y - 1.60;
    const playerTopY = playerBaseY + playerHeight;

    for (let i = 0; i < this.obstacles.length; i++) {
      const obs = this.obstacles[i];
      if (obs.isOpen) continue;
      if (playerBaseY >= obs.max.y || playerTopY <= obs.min.y) continue;

      const closestX = Math.max(obs.min.x, Math.min(obs.max.x, position.x));
      const closestZ = Math.max(obs.min.z, Math.min(obs.max.z, position.z));

      const dx = position.x - closestX;
      const dz = position.z - closestZ;
      if (dx * dx + dz * dz < playerRadius * playerRadius) {
        return false;
      }
    }

    return true;
  }
}
