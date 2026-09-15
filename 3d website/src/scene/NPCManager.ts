import * as THREE from 'three';
import { HVACDataStore } from '../data/HVACDataStore';
import { OFFICE_ZONES, ZoneBounds } from './OfficeFloorplan';

interface NPC {
  mesh: THREE.Group;
  zoneId: string;
  targetPosition: THREE.Vector3;
  speed: number;
}

export class NPCManager {
  private scene: THREE.Scene;
  private hvacStore: HVACDataStore;
  private npcs: Map<string, NPC[]> = new Map();

  private bodyMat: THREE.MeshStandardMaterial;
  private headMat: THREE.MeshStandardMaterial;
  
  private capsuleGeom: THREE.CapsuleGeometry;
  private headGeom: THREE.SphereGeometry;
  private zones: Record<string, ZoneBounds> = { ...OFFICE_ZONES };

  constructor(scene: THREE.Scene, hvacStore: HVACDataStore) {
    this.scene = scene;
    this.hvacStore = hvacStore;

    // Materials
    this.bodyMat = new THREE.MeshStandardMaterial({ 
      color: 0x3b82f6, 
      roughness: 0.7, 
      metalness: 0.1 
    });
    this.headMat = new THREE.MeshStandardMaterial({ 
      color: 0xfde047, 
      roughness: 0.4, 
      metalness: 0.1 
    });

    this.capsuleGeom = new THREE.CapsuleGeometry(0.25, 0.9, 4, 8);
    this.headGeom = new THREE.SphereGeometry(0.22, 8, 8);

    // Init tracking arrays
    for (const zoneId of Object.keys(this.zones)) {
      this.npcs.set(zoneId, []);
    }
  }

  public setEnvironment(_envId: string, zones?: Record<string, any>): void {
    for (const [_, list] of this.npcs) {
      for (const npc of list) {
        this.scene.remove(npc.mesh);
      }
    }
    this.npcs.clear();

    this.zones = (zones as Record<string, ZoneBounds>) || { ...OFFICE_ZONES };
    for (const zoneId of Object.keys(this.zones)) {
      this.npcs.set(zoneId, []);
    }
  }

  private createNPCMesh(): THREE.Group {
    const group = new THREE.Group();

    // Body
    const body = new THREE.Mesh(this.capsuleGeom, this.bodyMat);
    body.position.y = 0.7; // Raise capsule half height
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Head
    const head = new THREE.Mesh(this.headGeom, this.headMat);
    head.position.y = 1.45;
    head.castShadow = true;
    group.add(head);

    return group;
  }

  private getRandomPositionInZone(bounds: THREE.Box3): THREE.Vector3 {
    // Add margin to prevent wall clipping
    const margin = 1.5;
    const x = THREE.MathUtils.randFloat(bounds.min.x + margin, bounds.max.x - margin);
    const z = THREE.MathUtils.randFloat(bounds.min.z + margin, bounds.max.z - margin);
    return new THREE.Vector3(x, 0, z);
  }

  public update(delta: number) {
    // 1. Reconcile Counts
    for (const [zoneId, zoneBounds] of Object.entries(this.zones)) {
      const uiData = this.hvacStore.getZoneData(zoneId);
      if (!uiData) continue;

      const targetCount = uiData.occupancy || 0;
      const currentList = this.npcs.get(zoneId);
      if (!currentList) continue;

      // Spawn if too few
      while (currentList.length < targetCount) {
        const mesh = this.createNPCMesh();
        const startPos = this.getRandomPositionInZone(zoneBounds.bounds);
        mesh.position.copy(startPos);
        this.scene.add(mesh);

        currentList.push({
          mesh,
          zoneId,
          targetPosition: this.getRandomPositionInZone(zoneBounds.bounds),
          speed: THREE.MathUtils.randFloat(0.4, 0.9) // Relaxed walking speed
        });
      }

      // Despawn if too many
      while (currentList.length > targetCount) {
        const npc = currentList.pop()!;
        this.scene.remove(npc.mesh);
      }
    }

    // 2. Wandering Behavior
    for (const [zoneId, zoneBounds] of Object.entries(this.zones)) {
      const currentList = this.npcs.get(zoneId);
      if (!currentList) continue;

      for (const npc of currentList) {
        const dist = npc.mesh.position.distanceTo(npc.targetPosition);

        // If arrived, pick a new target
        if (dist < 0.2) {
          npc.targetPosition = this.getRandomPositionInZone(zoneBounds.bounds);
        }

        // Move towards target
        const dir = new THREE.Vector3().subVectors(npc.targetPosition, npc.mesh.position);
        dir.y = 0; // Prevent floating/sinking
        dir.normalize();
        
        // Face the target
        const targetRotation = Math.atan2(dir.x, dir.z);
        
        // Simple lerp rotation
        let diff = targetRotation - npc.mesh.rotation.y;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        npc.mesh.rotation.y += diff * delta * 5.0;

        npc.mesh.position.add(dir.multiplyScalar(npc.speed * delta));
        
        // Subtle bobbing effect while walking
        npc.mesh.position.y = Math.sin(Date.now() * 0.005 * npc.speed) * 0.08;
      }
    }
  }
}
