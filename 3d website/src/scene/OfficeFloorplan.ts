import * as THREE from 'three';
import { Materials } from './Materials';
import { AABBObstacle, ZoneId } from '../types';
import { CollisionEngine } from '../navigation/CollisionEngine';
import { GlassBoard } from '../hud/GlassBoard';

export interface ObstacleBox extends AABBObstacle {
  id: string;
  name: string;
  zone: string;
  box: THREE.Box3;
  isDoor?: boolean;
  isOpen?: boolean;
}

export interface ZoneBounds {
  id: ZoneId;
  name: string;
  displayName: string;
  center: THREE.Vector3;
  spawnPosition: THREE.Vector3;
  spawnYaw: number;
  bounds: THREE.Box3;
}

export const OFFICE_ZONES: Record<string, ZoneBounds> = {
  lobby: {
    id: 'lobby',
    name: 'lobby',
    displayName: 'Main Entrance & Lobby',
    center: new THREE.Vector3(0.0, 0.0, 6.5),
    spawnPosition: new THREE.Vector3(0.0, 1.6, 11.0),
    spawnYaw: 0.0,
    bounds: new THREE.Box3(new THREE.Vector3(-20.0, 0, 0.0), new THREE.Vector3(20.0, 4.0, 13.0))
  },
  open_office: {
    id: 'open_office',
    name: 'open_office',
    displayName: 'Open Plan Office Space',
    center: new THREE.Vector3(-7.0, 0.0, -6.5),
    spawnPosition: new THREE.Vector3(-7.0, 1.6, -1.0),
    spawnYaw: 0.0,
    bounds: new THREE.Box3(new THREE.Vector3(-20.0, 0, -13.0), new THREE.Vector3(5.0, 4.0, 0.0))
  },
  conference_room: {
    id: 'conference_room',
    name: 'conference_room',
    displayName: 'Executive Conference Room',
    center: new THREE.Vector3(12.0, 0.0, -6.5),
    spawnPosition: new THREE.Vector3(12.0, 1.6, -1.5),
    spawnYaw: Math.PI,
    bounds: new THREE.Box3(new THREE.Vector3(5.0, 0, -13.0), new THREE.Vector3(20.0, 4.0, 0.0))
  }
};

/**
 * Procedural Geometry Helpers for Instanced Furniture
 */
function createChairGeometry(): THREE.BufferGeometry {
  const group = new THREE.Group();

  // Base 5-star casters
  const baseCenter = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 8));
  baseCenter.position.set(0, 0.08, 0);
  group.add(baseCenter);

  for (let i = 0; i < 5; i++) {
    const angle = (i * Math.PI * 2) / 5;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.03));
    leg.position.set(Math.cos(angle) * 0.15, 0.06, Math.sin(angle) * 0.15);
    leg.rotation.y = -angle;
    group.add(leg);

    const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6));
    wheel.position.set(Math.cos(angle) * 0.28, 0.03, Math.sin(angle) * 0.28);
    group.add(wheel);
  }

  // Piston cylinder
  const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8));
  piston.position.set(0, 0.26, 0);
  group.add(piston);

  // Seat cushion
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.5));
  seat.position.set(0, 0.46, 0);
  group.add(seat);

  // Curved backrest
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.55, 0.05));
  back.position.set(0, 0.74, -0.23);
  back.rotation.x = 0.08;
  group.add(back);

  // Armrests
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.26));
  armL.position.set(-0.25, 0.6, 0);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.26));
  armR.position.set(0.25, 0.6, 0);
  group.add(armL, armR);

  // Merge geometries into single buffer geometry
  const geometries: THREE.BufferGeometry[] = [];
  group.traverse(child => {
    if (child instanceof THREE.Mesh) {
      child.updateMatrix();
      const clonedGeo = child.geometry.clone();
      clonedGeo.applyMatrix4(child.matrix);
      geometries.push(clonedGeo);
    }
  });

  // Manual fallback merge
  const merged = mergeBufferGeometries(geometries);
  return merged;
}

function createMonitorStandGeometry(): THREE.BufferGeometry {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.015, 12));
  base.position.set(0, 0.008, 0);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.35, 8));
  pole.position.set(0, 0.18, -0.02);
  const vesa = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02));
  vesa.position.set(0, 0.28, 0.01);
  group.add(base, pole, vesa);

  const geos: THREE.BufferGeometry[] = [];
  group.traverse(child => {
    if (child instanceof THREE.Mesh) {
      child.updateMatrix();
      const g = child.geometry.clone();
      g.applyMatrix4(child.matrix);
      geos.push(g);
    }
  });
  return mergeBufferGeometries(geos);
}

function createDeskLampGeometry(): THREE.BufferGeometry {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.015, 10));
  base.position.set(0, 0.008, 0);
  const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.25, 6));
  arm1.position.set(0, 0.13, 0);
  arm1.rotation.z = 0.2;
  const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.25, 6));
  arm2.position.set(0.05, 0.32, 0);
  arm2.rotation.z = -0.4;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 10));
  head.position.set(0.12, 0.4, 0);
  head.rotation.z = 2.2;
  group.add(base, arm1, arm2, head);

  const geos: THREE.BufferGeometry[] = [];
  group.traverse(child => {
    if (child instanceof THREE.Mesh) {
      child.updateMatrix();
      const g = child.geometry.clone();
      g.applyMatrix4(child.matrix);
      geos.push(g);
    }
  });
  return mergeBufferGeometries(geos);
}

function createDownlightGeometry(): THREE.BufferGeometry {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.02, 16));
  group.add(ring);
  const geos: THREE.BufferGeometry[] = [];
  group.traverse(child => {
    if (child instanceof THREE.Mesh) {
      child.updateMatrix();
      const g = child.geometry.clone();
      g.applyMatrix4(child.matrix);
      geos.push(g);
    }
  });
  return mergeBufferGeometries(geos);
}

function createBarStoolGeometry(): THREE.BufferGeometry {
  const group = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16));
  seat.position.set(0, 0.72, 0);
  group.add(seat);

  // 4 steel legs
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI * 2) / 4 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.72, 6));
    leg.position.set(Math.cos(angle) * 0.16, 0.36, Math.sin(angle) * 0.16);
    leg.rotation.z = Math.cos(angle) * 0.08;
    leg.rotation.x = Math.sin(angle) * 0.08;
    group.add(leg);
  }

  // Ring footrest
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.012, 6, 16));
  ring.position.set(0, 0.25, 0);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const geos: THREE.BufferGeometry[] = [];
  group.traverse(child => {
    if (child instanceof THREE.Mesh) {
      child.updateMatrix();
      const g = child.geometry.clone();
      g.applyMatrix4(child.matrix);
      geos.push(g);
    }
  });
  return mergeBufferGeometries(geos);
}

/**
 * Lightweight helper to combine buffer geometries with position and normal attributes
 */
function mergeBufferGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry();
  
  // Convert all geometries to non-indexed first so we don't have to merge index arrays
  const nonIndexedGeometries = geometries.map(g => g.index ? g.toNonIndexed() : g);

  let totalPositions = 0;
  let totalNormals = 0;
  let totalUVs = 0;

  for (const g of nonIndexedGeometries) {
    const pos = g.getAttribute('position');
    if (pos) totalPositions += pos.array.length;
    const norm = g.getAttribute('normal');
    if (norm) totalNormals += norm.array.length;
    const uv = g.getAttribute('uv');
    if (uv) totalUVs += uv.array.length;
  }

  const positions = new Float32Array(totalPositions);
  const normals = new Float32Array(totalNormals);
  const uvs = new Float32Array(totalUVs);
  
  let posOffset = 0;
  let normOffset = 0;
  let uvOffset = 0;

  for (const g of nonIndexedGeometries) {
    const pos = g.getAttribute('position');
    if (pos) {
      positions.set(pos.array, posOffset);
      posOffset += pos.array.length;
    }
    const norm = g.getAttribute('normal');
    if (norm) {
      normals.set(norm.array, normOffset);
      normOffset += norm.array.length;
    }
    const uv = g.getAttribute('uv');
    if (uv) {
      uvs.set(uv.array, uvOffset);
      uvOffset += uv.array.length;
    }
  }

  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (totalNormals > 0) {
    merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  } else {
    merged.computeVertexNormals();
  }
  if (totalUVs > 0) {
    merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }

  return merged;
}

/**
 * Instanced Furniture Registry for 60 FPS Performance
 */
export class InstancedAssetRegistry {
  public chairMesh!: THREE.InstancedMesh;
  public monitorBezelMesh!: THREE.InstancedMesh;
  public monitorStandMesh!: THREE.InstancedMesh;
  public lampMesh!: THREE.InstancedMesh;
  public downlightMesh!: THREE.InstancedMesh;
  public barStoolMesh!: THREE.InstancedMesh;

  public init(materials: Materials, group: THREE.Group): void {
    // 1. Task & Conference Chairs (32 max)
    const chairGeo = createChairGeometry();
    this.chairMesh = new THREE.InstancedMesh(chairGeo, materials.leatherBlack, 32);
    this.chairMesh.castShadow = true;
    this.chairMesh.receiveShadow = true;

    // 2. Monitors (34 max)
    const bezelGeo = new THREE.BoxGeometry(0.58, 0.34, 0.02);
    this.monitorBezelMesh = new THREE.InstancedMesh(bezelGeo, materials.screenEmissive, 34);
    this.monitorBezelMesh.castShadow = true;

    const standGeo = createMonitorStandGeometry();
    this.monitorStandMesh = new THREE.InstancedMesh(standGeo, materials.metalBlackMatte, 34);
    this.monitorStandMesh.castShadow = true;

    // 3. Desk Lamps (16 max)
    const lampGeo = createDeskLampGeometry();
    this.lampMesh = new THREE.InstancedMesh(lampGeo, materials.metalBlackMatte, 16);
    this.lampMesh.castShadow = true;

    // 4. Ceiling Downlights (36 max)
    const downlightGeo = createDownlightGeometry();
    this.downlightMesh = new THREE.InstancedMesh(downlightGeo, materials.ledGlowWarm, 36);

    // 5. Bar Stools (4 max)
    const stoolGeo = createBarStoolGeometry();
    this.barStoolMesh = new THREE.InstancedMesh(stoolGeo, materials.woodOak, 4);
    this.barStoolMesh.castShadow = true;

    group.add(
      this.chairMesh,
      this.monitorBezelMesh,
      this.monitorStandMesh,
      this.lampMesh,
      this.downlightMesh,
      this.barStoolMesh
    );
  }

  public setInstanceTransform(
    mesh: THREE.InstancedMesh,
    index: number,
    pos: THREE.Vector3,
    rot: THREE.Euler,
    scale = new THREE.Vector3(1, 1, 1)
  ): void {
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion().setFromEuler(rot);
    matrix.compose(pos, quat, scale);
    mesh.setMatrixAt(index, matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * 3D Multi-Zone Office Floorplan Builder
 */
export class OfficeFloorplan {
  public group: THREE.Group;
  private materials: Materials;
  private obstacles: ObstacleBox[] = [];
  public instancedAssets: InstancedAssetRegistry;

  // Interactive Meshes and Nodes References
  public recDeskGroup?: THREE.Group;
  public recDeskScreen?: THREE.Mesh;
  public kioskGroup?: THREE.Group;
  public kioskScreenMesh?: THREE.Mesh;
  public confScreenMesh?: THREE.Mesh;
  public confDoorMesh?: THREE.Mesh;
  public confPuckGroup?: THREE.Group;
  public confPuckLED?: THREE.Mesh;
  public espressoMachineGroup?: THREE.Group;
  public espressoLED?: THREE.Mesh;
  public loungeTVMesh?: THREE.Mesh;
  public onDoorStateChange?: (doorId: string, isOpen: boolean) => void;

  public glassBoards: { [zoneId: string]: GlassBoard } = {};
  public commandGlass?: GlassBoard;

  constructor(materials: Materials) {
    this.group = new THREE.Group();
    this.group.name = 'OfficeFloorplan';
    this.materials = materials;
    this.instancedAssets = new InstancedAssetRegistry();
  }

  public build(): void {
    this.instancedAssets.init(this.materials, this.group);

    this.buildArchitecturalShell();
    this.buildZone1Reception();
    this.buildZone2Workstations();
    this.buildZone3Conference();
    this.buildZone4Lounge();
    this.buildZone5Corridor();
    this.buildGlassBoards();

    // Recalculate instanced bounding volumes
    this.instancedAssets.chairMesh.computeBoundingSphere();
    this.instancedAssets.monitorBezelMesh.computeBoundingSphere();
    this.instancedAssets.monitorStandMesh.computeBoundingSphere();
    this.instancedAssets.lampMesh.computeBoundingSphere();
    this.instancedAssets.downlightMesh.computeBoundingSphere();
    this.instancedAssets.barStoolMesh.computeBoundingSphere();
  }

  public getObstacles(): ObstacleBox[] {
    return this.obstacles;
  }

  public getObstacleBoxes(): THREE.Box3[] {
    return this.obstacles.filter(o => !o.isOpen).map(o => o.box);
  }

  public getZoneAtPosition(pos: THREE.Vector3): ZoneBounds {
    for (const key in OFFICE_ZONES) {
      if (OFFICE_ZONES[key].bounds.containsPoint(pos)) {
        return OFFICE_ZONES[key];
      }
    }
    return OFFICE_ZONES.entrance;
  }

  public registerObstacle(
    id: string,
    name: string,
    zone: string,
    min: THREE.Vector3,
    max: THREE.Vector3,
    isDoor = false
  ): void {
    this.obstacles.push({
      id,
      name,
      zone,
      min,
      max,
      box: new THREE.Box3(min, max),
      isDoor,
      isOpen: false
    });
  }

  public setDoorState(doorId: string, isOpen: boolean): void {
    const obstacle = this.obstacles.find(o => o.id === doorId);
    if (obstacle) {
      obstacle.isOpen = isOpen;
    }
    CollisionEngine.notifyDoorState(doorId, isOpen);
    if (this.onDoorStateChange) {
      this.onDoorStateChange(doorId, isOpen);
    }
  }

  // ==========================================
  // 1. ARCHITECTURAL SHELL & PERIMETER
  // ==========================================
  private buildArchitecturalShell(): void {
    // 1.1 Main Floor Slab (40x26m)
    const floorGeo = new THREE.PlaneGeometry(40, 26);
    const floorMesh = new THREE.Mesh(floorGeo, this.materials.floorParquet);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, 0, 0);
    floorMesh.receiveShadow = true;
    this.group.add(floorMesh);

    // 1.2 Workstation Carpet Area Slab
    const carpetGeo = new THREE.PlaneGeometry(22, 12);
    const carpetMesh = new THREE.Mesh(carpetGeo, this.materials.floorCarpet);
    carpetMesh.rotation.x = -Math.PI / 2;
    carpetMesh.position.set(-7.5, 0.002, -6.0);
    carpetMesh.receiveShadow = true;
    this.group.add(carpetMesh);

    // 1.3 Kitchenette Dark Tile Slab
    const tileGeo = new THREE.PlaneGeometry(5.5, 7.5);
    const tileMesh = new THREE.Mesh(tileGeo, this.materials.floorTile);
    tileMesh.rotation.x = -Math.PI / 2;
    tileMesh.position.set(15.75, 0.002, 7.25);
    tileMesh.receiveShadow = true;
    this.group.add(tileMesh);

    // 1.4 Ceiling Slab (40x26m at Y=4.0m)
    const ceilingGeo = new THREE.BoxGeometry(40, 0.2, 26);
    const ceilingMesh = new THREE.Mesh(ceilingGeo, this.materials.ceilingAcoustic);
    ceilingMesh.position.set(0, 4.1, 0);
    this.group.add(ceilingMesh);

    // 1.5 Perimeter Walls
    // North Curtain Window Wall (Z = -13m)
    const northSill = new THREE.Mesh(new THREE.BoxGeometry(40, 0.5, 0.3), this.materials.wallDrywall);
    northSill.position.set(0, 0.25, -13.0);
    northSill.castShadow = true;
    northSill.receiveShadow = true;
    this.group.add(northSill);

    const northHeader = new THREE.Mesh(new THREE.BoxGeometry(40, 0.4, 0.3), this.materials.wallDrywall);
    northHeader.position.set(0, 3.8, -13.0);
    this.group.add(northHeader);

    const northGlass = new THREE.Mesh(new THREE.BoxGeometry(40, 3.1, 0.04), this.materials.glassClear);
    northGlass.position.set(0, 2.05, -13.0);
    this.group.add(northGlass);

    // Vertical window mullions
    for (let x = -17.5; x <= 17.5; x += 2.5) {
      const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.1, 0.12), this.materials.metalBlackMatte);
      mullion.position.set(x, 2.05, -13.0);
      mullion.castShadow = true;
      this.group.add(mullion);
    }
    this.registerObstacle('wall_north', 'North Window Wall', 'perimeter', new THREE.Vector3(-20.0, 0, -13.2), new THREE.Vector3(20.0, 4.0, -12.8));

    // South Wall & Entrance (Z = +13m)
    const southWallL = new THREE.Mesh(new THREE.BoxGeometry(17, 4.0, 0.4), this.materials.wallDrywall);
    southWallL.position.set(-11.5, 2.0, 13.0);
    southWallL.castShadow = true;
    southWallL.receiveShadow = true;
    this.group.add(southWallL);
    this.registerObstacle('wall_south_left', 'South Wall Left', 'perimeter', new THREE.Vector3(-20.0, 0, 12.8), new THREE.Vector3(-3.0, 4.0, 13.2));

    const southWallR = new THREE.Mesh(new THREE.BoxGeometry(17, 4.0, 0.4), this.materials.wallDrywall);
    southWallR.position.set(11.5, 2.0, 13.0);
    southWallR.castShadow = true;
    southWallR.receiveShadow = true;
    this.group.add(southWallR);
    this.registerObstacle('wall_south_right', 'South Wall Right', 'perimeter', new THREE.Vector3(3.0, 0, 12.8), new THREE.Vector3(20.0, 4.0, 13.2));

    // South Entrance Glass Doorway (X in [-3, 3])
    const entranceGlass = new THREE.Mesh(new THREE.BoxGeometry(6, 4.0, 0.05), this.materials.glassClear);
    entranceGlass.position.set(0, 2.0, 13.0);
    this.group.add(entranceGlass);

    // West Solid Accent Wall (X = -20m)
    const westWall = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.0, 26), this.materials.wallAccentWood);
    westWall.position.set(-20.0, 2.0, 0);
    westWall.castShadow = true;
    westWall.receiveShadow = true;
    this.group.add(westWall);
    this.registerObstacle('wall_west', 'West Wall', 'perimeter', new THREE.Vector3(-20.2, 0, -13.0), new THREE.Vector3(-19.8, 4.0, 13.0));

    // East Curtain Window Wall (X = +20m)
    const eastGlass = new THREE.Mesh(new THREE.BoxGeometry(0.04, 3.1, 26), this.materials.glassClear);
    eastGlass.position.set(20.0, 2.05, 0);
    this.group.add(eastGlass);

    const eastSill = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 26), this.materials.wallDrywall);
    eastSill.position.set(20.0, 0.25, 0);
    this.group.add(eastSill);

    const eastHeader = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 26), this.materials.wallDrywall);
    eastHeader.position.set(20.0, 3.8, 0);
    this.group.add(eastHeader);

    for (let z = -11.0; z <= 11.0; z += 2.5) {
      const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.1, 0.08), this.materials.metalBlackMatte);
      mullion.position.set(20.0, 2.05, z);
      mullion.receiveShadow = true;
      this.group.add(mullion);
    }
    this.registerObstacle('wall_east', 'East Window Wall', 'perimeter', new THREE.Vector3(19.8, 0, -13.0), new THREE.Vector3(20.2, 4.0, 13.0));
    // 1.6 6 Structural Architectural Columns
    const columnPositions: [number, number, string][] = [
      [-6.0, 1.5, 'col_1'],
      [6.0, 1.5, 'col_2'],
      [-6.0, -11.5, 'col_3'],
      [6.0, -11.5, 'col_4'],
      [-6.0, 11.5, 'col_5'],
      [6.0, 11.5, 'col_6']
    ];

    columnPositions.forEach(([cx, cz, id]) => {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4.0, 0.6), this.materials.woodOak);
      col.position.set(cx, 2.0, cz);
      col.castShadow = true;
      col.receiveShadow = true;
      this.group.add(col);

      // Base trim
      const baseTrim = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.15, 0.68), this.materials.metalBlackMatte);
      baseTrim.position.set(cx, 0.075, cz);
      this.group.add(baseTrim);

      this.registerObstacle(id, `Structural Column ${id}`, 'corridor', new THREE.Vector3(cx - 0.35, 0, cz - 0.35), new THREE.Vector3(cx + 0.35, 4.0, cz + 0.35));
    });
    
    this.buildCityscape();
  }

  private buildCityscape(): void {
    // 1. Vast City Ground Plane
    const groundGeo = new THREE.PlaneGeometry(1000, 1000);
    const groundMesh = new THREE.Mesh(groundGeo, this.materials.cityGround);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.set(0, -0.1, 0);
    groundMesh.receiveShadow = true;
    this.group.add(groundMesh);

    // 2. Structured City Blocks
    // We'll generate buildings in a grid pattern to simulate streets
    const blockSize = 30;
    const streetWidth = 15;
    const gridSize = blockSize + streetWidth;
    
    // Grid spans from -150 to +150
    for (let x = -150; x <= 150; x += gridSize) {
      for (let z = -150; z <= 150; z += gridSize) {
        
        // Skip the block where the player's office is located (X: -20 to 20, Z: -15 to 15)
        if (Math.abs(x) < 40 && Math.abs(z) < 40) continue;
        
        // Skip behind the solid west wall
        if (x < -30 && Math.abs(z) < 40) continue;

        // Generate 1 to 4 buildings per block
        const numBuildings = 1 + Math.floor(Math.random() * 3);
        
        for (let b = 0; b < numBuildings; b++) {
          const offsetX = (Math.random() - 0.5) * (blockSize - 10);
          const offsetZ = (Math.random() - 0.5) * (blockSize - 10);
          
          const width = 8 + Math.random() * 12;
          const depth = 8 + Math.random() * 12;
          
          // Taller buildings further away, mixed heights
          const dist = Math.hypot(x, z);
          const baseHeight = 20 + dist * 0.4;
          const height = baseHeight + Math.random() * 80;

          const geo = new THREE.BoxGeometry(width, height, depth);
          
          // We need to adjust UVs so the window texture maps nicely regardless of building scale
          const uvs = geo.attributes.uv;
          for (let i = 0; i < uvs.count; i++) {
            // Very simple UV scaling approximation based on height
            if (i % 4 === 0 || i % 4 === 1) {
              uvs.setY(i, uvs.getY(i) * (height / 10));
            }
            if (i % 4 === 2 || i % 4 === 3) {
              uvs.setX(i, uvs.getX(i) * (width / 10));
            }
          }

          const bldg = new THREE.Mesh(geo, this.materials.cityBuilding);
          
          bldg.position.set(x + offsetX, height / 2, z + offsetZ);
          bldg.castShadow = true;
          bldg.receiveShadow = true;
          
          this.group.add(bldg);
        }
      }
    }
  }

  // ==========================================
  // 2. ZONE 1: RECEPTION & EXECUTIVE LOBBY
  // ==========================================
  private buildZone1Reception(): void {
    // 2.1 Reception Desk
    const deskGroup = new THREE.Group();
    deskGroup.position.set(-7.0, 0, 6.0);

    const counterMarble = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.15, 1.4), this.materials.marbleCalacatta);
    counterMarble.position.set(0, 0.575, 0);
    counterMarble.castShadow = true;
    counterMarble.receiveShadow = true;
    deskGroup.add(counterMarble);

    const topOak = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.06, 1.45), this.materials.woodOak);
    topOak.position.set(0, 1.18, 0);
    topOak.castShadow = true;
    deskGroup.add(topOak);

    // Warm LED ribbon at base
    const ledRibbon = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.04, 1.35), this.materials.ledGlowWarm);
    ledRibbon.position.set(0, 0.02, 0);
    deskGroup.add(ledRibbon);

    // Inner receptionist terminal screen & keyboard
    const recScreen = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.03), this.materials.screenEmissive);
    recScreen.position.set(0, 1.35, 0.2);
    recScreen.rotation.y = Math.PI;
    deskGroup.add(recScreen);

    const recKeyboard = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.015, 0.14), this.materials.keyboardRGB);
    recKeyboard.position.set(0, 1.22, 0.45);
    deskGroup.add(recKeyboard);

    this.group.add(deskGroup);
    this.recDeskGroup = deskGroup;
    this.recDeskScreen = recScreen;
    this.registerObstacle('reception_counter', 'Reception Desk Counter', 'reception', new THREE.Vector3(-9.2, 0, 5.2), new THREE.Vector3(-4.8, 1.2, 6.8));

    // 2.2 Fluted Walnut Logo Feature Wall
    const logoWall = new THREE.Mesh(new THREE.BoxGeometry(6.0, 3.6, 0.2), this.materials.wallAccentWood);
    logoWall.position.set(-7.0, 2.0, 4.0);
    logoWall.castShadow = true;
    logoWall.receiveShadow = true;
    this.group.add(logoWall);

    // 3D Company Logo Plaque
    const logoPlaque = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 0.04), this.materials.logoNexus);
    logoPlaque.position.set(-7.0, 2.4, 4.12);
    this.group.add(logoPlaque);
    this.registerObstacle('reception_logowall', 'Logo Feature Wall', 'reception', new THREE.Vector3(-10.0, 0, 3.9), new THREE.Vector3(-4.0, 4.0, 4.15));

    // 2.3 Visitor Waiting Lounge (Sofa, Armchairs, Coffee Table, Rug, Lamp)
    // Area Rug
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.2), this.materials.floorCarpet);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-13.5, 0.005, 9.5);
    this.group.add(rug);

    // 3-Seater Cognac Leather Sofa
    const sofa = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.85, 0.9), this.materials.leatherCognac);
    sofa.position.set(-13.5, 0.425, 8.5);
    sofa.castShadow = true;
    sofa.receiveShadow = true;
    this.group.add(sofa);
    this.registerObstacle('reception_sofa', 'Cognac Visitor Sofa', 'reception', new THREE.Vector3(-14.7, 0, 8.05), new THREE.Vector3(-12.3, 0.85, 8.95));

    // 2 Armchairs
    const chair1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.85), this.materials.leatherCognac);
    chair1.position.set(-11.2, 0.4, 10.0);
    chair1.rotation.y = -0.6;
    chair1.castShadow = true;
    this.group.add(chair1);

    const chair2 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.85), this.materials.leatherCognac);
    chair2.position.set(-15.8, 0.4, 10.0);
    chair2.rotation.y = 0.6;
    chair2.castShadow = true;
    this.group.add(chair2);

    // Glass Coffee Table
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.45, 0.6), this.materials.glassClear);
    table.position.set(-13.5, 0.225, 9.8);
    table.castShadow = true;
    this.group.add(table);
    this.registerObstacle('reception_table', 'Visitor Coffee Table', 'reception', new THREE.Vector3(-14.1, 0, 9.5), new THREE.Vector3(-12.9, 0.45, 10.1));

    // Arched Brass Floor Lamp
    const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.2, 8), this.materials.metalBrass);
    lampPost.position.set(-15.5, 1.1, 8.2);
    lampPost.castShadow = true;
    const lampDome = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.materials.metalBrass);
    lampDome.position.set(-15.5, 2.2, 8.5);
    lampDome.rotation.x = Math.PI;
    this.group.add(lampPost, lampDome);

    // 2.4 Interactive Welcome Kiosk
    const kiosk = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.5, 0.4), this.materials.metalBlackMatte);
    kiosk.position.set(-1.5, 0.75, 9.0);
    kiosk.castShadow = true;
    const kioskScreen = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.35, 0.02), this.materials.screenEmissive);
    kioskScreen.position.set(-1.5, 1.1, 8.8);
    kioskScreen.rotation.x = -0.3;
    this.group.add(kiosk, kioskScreen);
    this.kioskScreenMesh = kioskScreen;
    this.registerObstacle('reception_kiosk', 'Welcome Kiosk', 'reception', new THREE.Vector3(-1.8, 0, 8.8), new THREE.Vector3(-1.2, 1.5, 9.2));

    // 2.5 Living Green Wall
    const greenWall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.6, 5.0), this.materials.foliageGreen);
    greenWall.position.set(-19.85, 2.0, 7.5);
    greenWall.castShadow = true;
    this.group.add(greenWall);
    this.registerObstacle('reception_greenwall', 'Living Botanical Green Wall', 'reception', new THREE.Vector3(-20.0, 0, 5.0), new THREE.Vector3(-19.7, 4.0, 10.0));
  }

  // ==========================================
  // 3. ZONE 2: OPEN WORKSTATIONS & PODS
  // ==========================================
  private buildZone2Workstations(): void {
    const podCenters: [number, number, string][] = [
      [-12.5, -8.5, 'workstation_pod_1'],
      [-4.0, -8.5, 'workstation_pod_2'],
      [-12.5, -3.5, 'workstation_pod_3'],
      [-4.0, -3.5, 'workstation_pod_4']
    ];

    let chairInstanceIndex = 0;
    let monitorInstanceIndex = 0;
    let lampInstanceIndex = 0;

    podCenters.forEach(([px, pz, podId]) => {
      const podGroup = new THREE.Group();
      podGroup.position.set(px, 0, pz);

      // 4 Desks per Pod
      const deskOffsets: [number, number, number][] = [
        [-0.85, -0.45, 0], // Desk 1 NW (facing N)
        [0.85, -0.45, 0],  // Desk 2 NE (facing N)
        [-0.85, 0.45, Math.PI], // Desk 3 SW (facing S)
        [0.85, 0.45, Math.PI]   // Desk 4 SE (facing S)
      ];

      deskOffsets.forEach(([dx, dz, rotY]) => {
        // Desktop
        const deskTop = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 0.8), this.materials.laminateWhite);
        deskTop.position.set(dx, 0.72, dz);
        deskTop.castShadow = true;
        deskTop.receiveShadow = true;
        podGroup.add(deskTop);

        // Desk Legs (4)
        for (let lx of [-0.75, 0.75]) {
          for (let lz of [-0.35, 0.35]) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 8), this.materials.metalBlackMatte);
            leg.position.set(dx + lx, 0.35, dz + lz);
            leg.castShadow = true;
            podGroup.add(leg);
          }
        }

        // RGB Keyboard & Mouse
        const kbd = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.015, 0.14), this.materials.keyboardRGB);
        kbd.position.set(dx, 0.75, dz + (rotY === 0 ? 0.2 : -0.2));
        kbd.rotation.y = rotY;
        podGroup.add(kbd);

        const mouse = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.1), this.materials.metalBlackMatte);
        mouse.position.set(dx + 0.28, 0.75, dz + (rotY === 0 ? 0.2 : -0.2));
        podGroup.add(mouse);

        // Instanced Dual Monitors
        for (let mOffset of [-0.32, 0.32]) {
          const mAngle = rotY + (mOffset < 0 ? 0.12 : -0.12);
          const worldPos = new THREE.Vector3(px + dx + mOffset, 0.95, pz + dz + (rotY === 0 ? -0.18 : 0.18));
          const worldRot = new THREE.Euler(0, mAngle, 0);

          if (monitorInstanceIndex < 34) {
            this.instancedAssets.setInstanceTransform(this.instancedAssets.monitorBezelMesh, monitorInstanceIndex, worldPos, worldRot);
            this.instancedAssets.setInstanceTransform(this.instancedAssets.monitorStandMesh, monitorInstanceIndex, new THREE.Vector3(worldPos.x, 0.74, worldPos.z), worldRot);
            monitorInstanceIndex++;
          }
        }

        // Instanced Task Chair
        if (chairInstanceIndex < 32) {
          const chairPos = new THREE.Vector3(px + dx, 0, pz + dz + (rotY === 0 ? 0.65 : -0.65));
          const chairRot = new THREE.Euler(0, rotY, 0);
          this.instancedAssets.setInstanceTransform(this.instancedAssets.chairMesh, chairInstanceIndex, chairPos, chairRot);
          chairInstanceIndex++;
        }

        // Instanced Desk Lamp
        if (lampInstanceIndex < 16) {
          const lampPos = new THREE.Vector3(px + dx - 0.6, 0.74, pz + dz);
          const lampRot = new THREE.Euler(0, rotY + 0.5, 0);
          this.instancedAssets.setInstanceTransform(this.instancedAssets.lampMesh, lampInstanceIndex, lampPos, lampRot);
          lampInstanceIndex++;
        }
      });

      // Central Acoustic Privacy Divider
      const divider = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.45, 0.04), this.materials.fabricFeltGrey);
      divider.position.set(0, 0.95, 0);
      divider.castShadow = true;
      podGroup.add(divider);

      this.group.add(podGroup);
      this.registerObstacle(podId, `Workstation Quad Pod`, 'workstations', new THREE.Vector3(px - 1.7, 0, pz - 0.9), new THREE.Vector3(px + 1.7, 1.2, pz + 0.9));
    });

    // 3.2 Peripheral Storage Lockers
    const lockers = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 3.0), this.materials.metalBlackMatte);
    lockers.position.set(-18.5, 0.6, -11.0);
    lockers.castShadow = true;
    lockers.receiveShadow = true;
    this.group.add(lockers);
    this.registerObstacle('workstation_lockers', 'Storage Lockers Credenza', 'workstations', new THREE.Vector3(-18.8, 0, -12.5), new THREE.Vector3(-18.2, 1.2, -9.5));

    // 3.3 Mobile Whiteboard
    const wb = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.9, 1.6), this.materials.whiteboard);
    wb.position.set(-18.0, 0.95, -6.0);
    wb.castShadow = true;
    this.group.add(wb);
    this.registerObstacle('workstation_board', 'Mobile Whiteboard', 'workstations', new THREE.Vector3(-18.1, 0, -6.8), new THREE.Vector3(-17.9, 1.9, -5.2));
  }

  // ==========================================
  // 4. ZONE 3: GLASS-WALLED CONFERENCE ROOM
  // ==========================================
  private buildZone3Conference(): void {
    // 4.1 Glass Enclosure
    // West Glass Wall Segments & Sliding Door Opening
    const glassWest1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 4.0, 9.0), this.materials.glassClear);
    glassWest1.position.set(5.8, 2.0, -8.0);
    this.group.add(glassWest1);
    this.registerObstacle('conf_glass_west_1', 'Conference West Glass North', 'conference', new THREE.Vector3(5.7, 0, -12.5), new THREE.Vector3(5.9, 4.0, -3.5));

    // Sliding Door (Interactive Hotspot)
    const glassDoor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3.0, 1.5), this.materials.glassClear);
    glassDoor.position.set(5.8, 1.5, -2.75);
    this.group.add(glassDoor);
    this.confDoorMesh = glassDoor;
    this.registerObstacle('conf_door_sliding', 'Conference Glass Sliding Door', 'conference', new THREE.Vector3(5.7, 0, -3.5), new THREE.Vector3(5.9, 3.0, -2.0), true);

    const glassWest2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 4.0, 1.5), this.materials.glassClear);
    glassWest2.position.set(5.8, 2.0, -1.25);
    this.group.add(glassWest2);
    this.registerObstacle('conf_glass_west_2', 'Conference West Glass South', 'conference', new THREE.Vector3(5.7, 0, -2.0), new THREE.Vector3(5.9, 4.0, -0.5));

    // South Glass Wall with Frosted Manifestation Band
    const glassSouth = new THREE.Mesh(new THREE.BoxGeometry(12.8, 4.0, 0.08), this.materials.glassClear);
    glassSouth.position.set(12.1, 2.0, -0.5);
    this.group.add(glassSouth);

    const frostBand = new THREE.Mesh(new THREE.BoxGeometry(12.8, 0.6, 0.09), this.materials.glassFrosted);
    frostBand.position.set(12.1, 1.4, -0.5);
    this.group.add(frostBand);
    this.registerObstacle('conf_glass_south', 'Conference South Glass Wall', 'conference', new THREE.Vector3(5.7, 0, -0.6), new THREE.Vector3(18.5, 4.0, -0.4));

    // 4.2 Executive Racetrack Walnut Conference Table
    const tableGroup = new THREE.Group();
    tableGroup.position.set(12.0, 0, -6.0);

    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.08, 2.0), this.materials.woodWalnut);
    tableTop.position.set(0, 0.74, 0);
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    tableGroup.add(tableTop);

    // Dual Pedestals
    const pedL = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.7, 16), this.materials.metalBlackMatte);
    pedL.position.set(-2.2, 0.35, 0);
    pedL.castShadow = true;
    const pedR = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.7, 16), this.materials.metalBlackMatte);
    pedR.position.set(2.2, 0.35, 0);
    pedR.castShadow = true;
    tableGroup.add(pedL, pedR);

    // Center speakerphone conference puck with glowing ring in isolated group
    const puckGroup = new THREE.Group();
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.04, 16), this.materials.metalBlackMatte);
    puck.position.set(0, 0.8, 0);
    const puckLED = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.15, 16), this.materials.ledGlowGreen);
    puckLED.rotation.x = -Math.PI / 2;
    puckLED.position.set(0, 0.825, 0);
    puckGroup.add(puck, puckLED);
    tableGroup.add(puckGroup);

    this.group.add(tableGroup);
    this.confPuckGroup = puckGroup;
    this.confPuckLED = puckLED;
    this.registerObstacle('conf_table', 'Executive Walnut Conference Table', 'conference', new THREE.Vector3(8.4, 0, -7.0), new THREE.Vector3(15.6, 0.75, -5.0));

    // 4.3 12 Executive Leather Conference Chairs (Instanced)
    const chairX = [8.8, 10.4, 12.0, 13.6, 15.2];
    let confChairIdx = 16; // Continue from workstation chairs

    // 5 North side (facing South)
    chairX.forEach(cx => {
      if (confChairIdx < 32) {
        this.instancedAssets.setInstanceTransform(
          this.instancedAssets.chairMesh,
          confChairIdx,
          new THREE.Vector3(cx, 0, -4.8),
          new THREE.Euler(0, 0, 0)
        );
        confChairIdx++;
      }
    });

    // 5 South side (facing North)
    chairX.forEach(cx => {
      if (confChairIdx < 32) {
        this.instancedAssets.setInstanceTransform(
          this.instancedAssets.chairMesh,
          confChairIdx,
          new THREE.Vector3(cx, 0, -7.2),
          new THREE.Euler(0, Math.PI, 0)
        );
        confChairIdx++;
      }
    });

    // 2 Captain chairs at table heads
    if (confChairIdx < 32) {
      this.instancedAssets.setInstanceTransform(this.instancedAssets.chairMesh, confChairIdx, new THREE.Vector3(8.0, 0, -6.0), new THREE.Euler(0, Math.PI / 2, 0));
      confChairIdx++;
    }
    if (confChairIdx < 32) {
      this.instancedAssets.setInstanceTransform(this.instancedAssets.chairMesh, confChairIdx, new THREE.Vector3(16.0, 0, -6.0), new THREE.Euler(0, -Math.PI / 2, 0));
      confChairIdx++;
    }

    // 4.4 85" Smart Presentation Display (Interactive Screen)
    const tvBezel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 0.08), this.materials.metalBlackMatte);
    tvBezel.position.set(12.0, 2.2, -12.75);
    tvBezel.castShadow = true;
    const tvScreen = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.25, 0.02), this.materials.screenEmissive);
    tvScreen.position.set(12.0, 2.2, -12.7);
    this.group.add(tvBezel, tvScreen);
    this.confScreenMesh = tvScreen;
    this.registerObstacle('conf_screen', '85" Smart Presentation Display', 'conference', new THREE.Vector3(10.8, 1.5, -12.9), new THREE.Vector3(13.2, 2.9, -12.6));

    // 4.5 Suspended Acoustic Ceiling Cloud
    const cloud = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.12, 2.4), this.materials.fabricFeltGrey);
    cloud.position.set(12.0, 3.6, -6.0);
    this.group.add(cloud);

    // Mobile Glass Whiteboard
    const confWb = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.9, 1.6), this.materials.whiteboard);
    confWb.position.set(7.2, 0.95, -10.0);
    this.group.add(confWb);
  }

  // ==========================================
  // 5. ZONE 4: EXECUTIVE LOUNGE, BREAKROOM & CAFÉ
  // ==========================================
  private buildZone4Lounge(): void {
    // 5.1 Kitchenette & Coffee Bar Counter
    // East Run Counter
    const barEast = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.95, 5.3), this.materials.marbleCalacatta);
    barEast.position.set(17.5, 0.475, 7.05);
    barEast.castShadow = true;
    barEast.receiveShadow = true;
    this.group.add(barEast);
    this.registerObstacle('lounge_bar_east', 'Kitchenette Counter East Run', 'lounge', new THREE.Vector3(16.9, 0, 4.4), new THREE.Vector3(18.1, 0.95, 9.7));

    // Island Return Counter
    const barIsland = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.95, 1.0), this.materials.marbleCalacatta);
    barIsland.position.set(15.0, 0.475, 4.5);
    barIsland.castShadow = true;
    barIsland.receiveShadow = true;
    this.group.add(barIsland);
    this.registerObstacle('lounge_bar_island', 'Coffee Bar Island Counter', 'lounge', new THREE.Vector3(13.1, 0, 4.0), new THREE.Vector3(16.9, 0.95, 5.0));

    // 4 Bar Stools along Island (Instanced)
    const stoolX = [13.6, 14.5, 15.4, 16.3];
    stoolX.forEach((sx, idx) => {
      this.instancedAssets.setInstanceTransform(
        this.instancedAssets.barStoolMesh,
        idx,
        new THREE.Vector3(sx, 0, 3.6),
        new THREE.Euler(0, 0, 0)
      );
    });

    // Commercial Espresso Machine (Interactive Appliance)
    const espressoMachine = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.5, 0.5), this.materials.metalBrushed);
    espressoMachine.position.set(17.4, 1.2, 6.5);
    espressoMachine.castShadow = true;
    const espressoLED = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), this.materials.ledGlowGreen);
    espressoLED.position.set(17.1, 1.35, 6.5);
    this.group.add(espressoMachine, espressoLED);
    this.espressoLED = espressoLED;

    // Double Stainless Refrigerator
    const fridge = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.0, 1.0), this.materials.metalBrushed);
    fridge.position.set(17.5, 1.0, 10.2);
    fridge.castShadow = true;
    this.group.add(fridge);
    this.registerObstacle('lounge_fridge', 'Double Door Refrigerator', 'lounge', new THREE.Vector3(16.9, 0, 9.7), new THREE.Vector3(18.1, 2.0, 10.7));

    // 5.2 L-Sectional Velvet Sofa
    const sofaMain = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.85, 1.0), this.materials.fabricVelvetBlue);
    sofaMain.position.set(9.5, 0.425, 8.5);
    sofaMain.castShadow = true;
    sofaMain.receiveShadow = true;
    this.group.add(sofaMain);
    this.registerObstacle('lounge_sofa_main', 'Lounge Velvet Sectional Sofa', 'lounge', new THREE.Vector3(7.8, 0, 8.0), new THREE.Vector3(11.2, 0.85, 9.0));

    const sofaChaise = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.85, 1.6), this.materials.fabricVelvetBlue);
    sofaChaise.position.set(8.3, 0.425, 7.2);
    sofaChaise.castShadow = true;
    this.group.add(sofaChaise);
    this.registerObstacle('lounge_sofa_chaise', 'Lounge Velvet Chaise Return', 'lounge', new THREE.Vector3(7.8, 0, 6.4), new THREE.Vector3(8.8, 0.85, 8.0));

    // 2 Mustard Velvet Armchairs
    const arm1 = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.8, 0.85), this.materials.fabricMustard);
    arm1.position.set(7.2, 0.4, 8.5);
    arm1.rotation.y = 0.8;
    arm1.castShadow = true;
    this.group.add(arm1);

    const arm2 = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.8, 0.85), this.materials.fabricMustard);
    arm2.position.set(11.5, 0.4, 6.8);
    arm2.rotation.y = -2.2;
    arm2.castShadow = true;
    this.group.add(arm2);

    // Nesting Round Marble Coffee Tables
    const cTable1 = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.44, 16), this.materials.marbleCalacatta);
    cTable1.position.set(9.5, 0.22, 7.0);
    cTable1.castShadow = true;
    const cTable2 = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.36, 16), this.materials.marbleCalacatta);
    cTable2.position.set(8.7, 0.18, 6.8);
    cTable2.castShadow = true;
    this.group.add(cTable1, cTable2);

    // Wall TV Display
    const loungeTV = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 0.05), this.materials.screenEmissive);
    loungeTV.position.set(9.5, 2.2, 12.75);
    this.group.add(loungeTV);
    this.loungeTVMesh = loungeTV;

    // Architectural Bookshelf Divider
    const bookshelf = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.6, 3.8), this.materials.metalBlackMatte);
    bookshelf.position.set(5.8, 1.8, 7.5);
    bookshelf.castShadow = true;
    this.group.add(bookshelf);
    this.registerObstacle('lounge_bookshelf', 'Architectural Bookshelf', 'lounge', new THREE.Vector3(5.6, 0, 5.6), new THREE.Vector3(6.0, 3.6, 9.4));

    // Indoor Potted Plants
    const plant1 = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.6, 12), this.materials.laminateWhite);
    plant1.position.set(6.6, 0.3, 3.6);
    const plantLeaves1 = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), this.materials.foliageGreen);
    plantLeaves1.position.set(6.6, 0.9, 3.6);
    this.group.add(plant1, plantLeaves1);

    const plant2 = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.25, 0.7, 12), this.materials.laminateWhite);
    plant2.position.set(17.2, 0.35, 11.5);
    const plantLeaves2 = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), this.materials.foliageGreen);
    plantLeaves2.position.set(17.2, 1.0, 11.5);
    this.group.add(plant2, plantLeaves2);
  }

  // ==========================================
  // 6. ZONE 5: CIRCULATION SPUR & WAYFINDING
  // ==========================================
  private buildZone5Corridor(): void {
    // 6.1 Central Wayfinding Directory Totem
    const totem = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.4, 0.4), this.materials.metalBlackMatte);
    totem.position.set(0, 1.2, 4.0);
    totem.castShadow = true;
    totem.receiveShadow = true;
    this.group.add(totem);

    const totemScreen = new THREE.Mesh(new THREE.BoxGeometry(0.52, 1.2, 0.02), this.materials.screenEmissive);
    totemScreen.position.set(0, 1.4, 4.21);
    this.group.add(totemScreen);
    this.registerObstacle('totem_wayfinding', 'Wayfinding Totem Kiosk', 'corridor', new THREE.Vector3(-0.3, 0, 3.8), new THREE.Vector3(0.3, 2.4, 4.2));

    // 6.2 Ceiling Recessed Downlights Grid (36 instances)
    let dlIdx = 0;
    for (let x = -15; x <= 15; x += 6) {
      for (let z = -10; z <= 10; z += 4) {
        if (dlIdx < 36) {
          this.instancedAssets.setInstanceTransform(
            this.instancedAssets.downlightMesh,
            dlIdx,
            new THREE.Vector3(x, 3.98, z),
            new THREE.Euler(0, 0, 0)
          );
          dlIdx++;
        }
      }
    }
  }

  // ==========================================
  // 6. HUD PANELS (GLASS BOARDS)
  // ==========================================
  private buildGlassBoards(): void {
    // 1. Lobby Zone Glass (Tier 1)
    const recGlass = new GlassBoard(2.4, 1.35);
    recGlass.group.position.set(-2.0, 1.6, 2.6); // North wall of reception area
    recGlass.group.rotation.y = 0; // Facing south
    this.group.add(recGlass.group);
    this.glassBoards['lobby'] = recGlass;

    // 2. Command Glass (Tier 2, Hero Display in Reception Lobby)
    const cmdGlass = new GlassBoard(3.2, 1.8, true);
    cmdGlass.group.position.set(8.0, 1.8, 12.9); // South wall right side
    cmdGlass.group.rotation.y = Math.PI; // Facing north
    this.group.add(cmdGlass.group);
    this.commandGlass = cmdGlass;

    // 3. Conference Room Glass (Tier 1)
    const confGlass = new GlassBoard(2.4, 1.35);
    confGlass.group.position.set(18.9, 1.6, -6.0); // East wall of conference
    confGlass.group.rotation.y = -Math.PI / 2; // Facing west
    this.group.add(confGlass.group);
    this.glassBoards['conference_room'] = confGlass;

    // 4. Open Office Zone Glass (Tier 1)
    const workGlass = new GlassBoard(2.4, 1.35);
    workGlass.group.position.set(-18.9, 1.6, -2.0); // West wall of workstations
    workGlass.group.rotation.y = Math.PI / 2; // Facing east
    this.group.add(workGlass.group);
    this.glassBoards['open_office'] = workGlass;
  }
}
