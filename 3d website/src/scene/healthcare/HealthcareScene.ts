import * as THREE from 'three';
import {
  EnvironmentId,
  IEnvironmentScene,
  IEnvironmentBounds,
  IMinimapRoom,
  ZoneBounds,
  ObstacleBox,
  TeleportBinding,
  IInteractable
} from '../../types';
import { Materials } from '../Materials';
import { GlassBoard } from '../../hud/GlassBoard';
import { disposeHierarchy } from '../common/DisposalUtils';

export const HEALTHCARE_ZONES: Record<string, ZoneBounds> = {
  hospital_lobby: {
    id: 'hospital_lobby',
    name: 'hospital_lobby',
    displayName: 'Hospital Admitting & Triage',
    center: new THREE.Vector3(-11.0, 0.0, 8.0),
    spawnPosition: new THREE.Vector3(0.0, 1.6, 12.0),
    spawnYaw: 0.0,
    bounds: new THREE.Box3(new THREE.Vector3(-22.0, 0, 0.0), new THREE.Vector3(0.0, 4.2, 16.0))
  },
  clinical_areas: {
    id: 'clinical_areas',
    name: 'clinical_areas',
    displayName: 'Clinical & Acute Care Wing',
    center: new THREE.Vector3(-11.0, 0.0, -8.0),
    spawnPosition: new THREE.Vector3(-11.0, 1.6, -8.0),
    spawnYaw: 0.0,
    bounds: new THREE.Box3(new THREE.Vector3(-22.0, 0, -16.0), new THREE.Vector3(0.0, 4.2, 0.0))
  },
  staff_areas: {
    id: 'staff_areas',
    name: 'staff_areas',
    displayName: 'Nursing Station & Staff Wing',
    center: new THREE.Vector3(11.0, 0.0, 8.0),
    spawnPosition: new THREE.Vector3(11.0, 1.6, 8.0),
    spawnYaw: 0.0,
    bounds: new THREE.Box3(new THREE.Vector3(0.0, 0, 0.0), new THREE.Vector3(22.0, 4.2, 16.0))
  },
  support_hvac: {
    id: 'support_hvac',
    name: 'support_hvac',
    displayName: 'AHU Plant & Clean Utility',
    center: new THREE.Vector3(11.0, 0.0, -8.0),
    spawnPosition: new THREE.Vector3(11.0, 1.6, -8.0),
    spawnYaw: 0.0,
    bounds: new THREE.Box3(new THREE.Vector3(0.0, 0, -16.0), new THREE.Vector3(22.0, 4.2, 0.0))
  }
};

export const HEALTHCARE_ZONE_METAS = {
  hospital_lobby: {
    id: 'hospital_lobby',
    code: 'Z-01',
    name: 'Hospital Admitting & Triage',
    wing: 'South-west wing',
    areaM2: 352,
    targetTemp: 21.0,
    measuredTemp: 21.2,
    diff: '+0.2°C',
    humidity: 45.0,
    occupancy: 6,
    powerKW: 2.80,
    statusText: 'Normal · Operating within ASHRAE 170',
    shortStatus: 'Normal / Live',
    statusType: 'normal',
    requiresAttention: false
  },
  clinical_areas: {
    id: 'clinical_areas',
    code: 'Z-02',
    name: 'Clinical & Acute Care Wing',
    wing: 'North-west wing',
    areaM2: 352,
    targetTemp: 21.0,
    measuredTemp: 22.8,
    diff: '+1.8°C',
    humidity: 48.2,
    occupancy: 12,
    powerKW: 4.50,
    statusText: 'Cooling · Attention required',
    shortStatus: 'Cooling / Attention',
    statusType: 'warning',
    requiresAttention: true
  },
  staff_areas: {
    id: 'staff_areas',
    code: 'Z-03',
    name: 'Nursing Station & Staff Wing',
    wing: 'South-east wing',
    areaM2: 352,
    targetTemp: 22.0,
    measuredTemp: 22.1,
    diff: '+0.1°C',
    humidity: 43.5,
    occupancy: 8,
    powerKW: 2.40,
    statusText: 'Normal · Operating within ASHRAE 170',
    shortStatus: 'Normal / Live',
    statusType: 'normal',
    requiresAttention: false
  },
  support_hvac: {
    id: 'support_hvac',
    code: 'Z-04',
    name: 'AHU Plant & Clean Utility',
    wing: 'North-east wing',
    areaM2: 352,
    targetTemp: 19.5,
    measuredTemp: 19.4,
    diff: '-0.1°C',
    humidity: 38.0,
    occupancy: 2,
    powerKW: 6.20,
    statusText: 'Normal · HEPA filtration active',
    shortStatus: 'Normal / Live',
    statusType: 'normal',
    requiresAttention: false
  }
};

export class HealthcareScene implements IEnvironmentScene {
  public readonly id: EnvironmentId = 'healthcare';
  public readonly name: string = 'Healthcare Facility';
  public readonly defaultSpawnPosition: THREE.Vector3 = new THREE.Vector3(0.0, 1.6, 12.0);
  public readonly defaultSpawnYaw: number = 0.0;

  public readonly worldBounds: IEnvironmentBounds = {
    minX: -21.5,
    maxX: 21.5,
    minZ: -15.5,
    maxZ: 15.5,
    minY: 0.0,
    maxY: 4.2
  };

  public readonly group: THREE.Group = new THREE.Group();

  public readonly minimapRooms: IMinimapRoom[] = [
    { label: 'Triage / Lobby', bounds: [-22.0, 0.0, 0.0, 16.0] },
    { label: 'Clinical ICU', bounds: [-22.0, -16.0, 0.0, 0.0] },
    { label: 'Nurse Station', bounds: [0.0, 0.0, 22.0, 16.0] },
    { label: 'AHU Plant', bounds: [0.0, -16.0, 22.0, 0.0] }
  ];

  public glassBoards: Record<string, GlassBoard> = {};
  private obstacles: ObstacleBox[] = [];
  private interactables: IInteractable[] = [];
  private materials: Materials;

  
  // --- MILESTONE 2: HEALTHCARE 3D ASSET GENERATORS ---

  private addObstacle(mesh: THREE.Object3D, name: string) {
    const box = new THREE.Box3().setFromObject(mesh);
    this.obstacles.push({ box, name, id: 'hc_obs_' + Math.random().toString(36).substr(2, 9) });
  }

  private createPatientBed(x: number, z: number, rotation: number) {
    const bedGroup = new THREE.Group();
    bedGroup.position.set(x, 0, z);
    bedGroup.rotation.y = rotation;

    // Bed frame
    const frameGeo = new THREE.BoxGeometry(2.2, 0.5, 1.0);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.6, roughness: 0.3 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.y = 0.5;
    bedGroup.add(frame);

    // Mattress
    const matGeo = new THREE.BoxGeometry(2.0, 0.2, 0.9);
    const matMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const mattress = new THREE.Mesh(matGeo, matMat);
    mattress.position.set(0, 0.85, 0);
    bedGroup.add(mattress);

    // Monitor / IV Pole
    const poleGeo = new THREE.CylinderGeometry(0.02, 0.02, 2.0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.8 });
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(-0.9, 1.0, 0.4);
    bedGroup.add(pole);

    const screenGeo = new THREE.BoxGeometry(0.1, 0.3, 0.4);
    const screenMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x0284c7, emissiveIntensity: 0.5 });
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.set(-0.8, 1.5, 0.4);
    bedGroup.add(screen);

    this.group.add(bedGroup);
    this.addObstacle(bedGroup, 'Patient Bed');
  }

  private createNurseStation(x: number, z: number) {
    const stationGroup = new THREE.Group();
    stationGroup.position.set(x, 0, z);

    // Curved/L-shaped desk
    const deskGeo = new THREE.BoxGeometry(4.0, 1.1, 1.0);
    const deskMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 });
    const desk = new THREE.Mesh(deskGeo, deskMat);
    desk.position.set(0, 0.55, 0);
    stationGroup.add(desk);

    const deskSideGeo = new THREE.BoxGeometry(1.0, 1.1, 3.0);
    const deskSide = new THREE.Mesh(deskSideGeo, deskMat);
    deskSide.position.set(-1.5, 0.55, -2.0);
    stationGroup.add(deskSide);

    // Computers
    const compGeo = new THREE.BoxGeometry(0.1, 0.4, 0.6);
    const compMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, emissive: 0x38bdf8, emissiveIntensity: 0.2 });
    
    const comp1 = new THREE.Mesh(compGeo, compMat);
    comp1.position.set(-0.2, 1.3, 0);
    comp1.rotation.y = 0.2;
    stationGroup.add(comp1);

    const comp2 = new THREE.Mesh(compGeo, compMat);
    comp2.position.set(1.2, 1.3, 0);
    comp2.rotation.y = -0.2;
    stationGroup.add(comp2);

    this.group.add(stationGroup);
    this.addObstacle(stationGroup, 'Nurse Station');
  }

  private createHVACPlant(x: number, z: number) {
    const plantGroup = new THREE.Group();
    plantGroup.position.set(x, 0, z);

    // Main AHU body
    const ahuGeo = new THREE.BoxGeometry(3.0, 2.5, 1.5);
    const ahuMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.5, roughness: 0.6 });
    const ahu = new THREE.Mesh(ahuGeo, ahuMat);
    ahu.position.y = 1.25;
    plantGroup.add(ahu);

    // Ducts
    const ductGeo = new THREE.BoxGeometry(1.0, 0.8, 3.0);
    const ductMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.7, roughness: 0.4 });
    const duct = new THREE.Mesh(ductGeo, ductMat);
    duct.position.set(0, 2.1, -2.0);
    plantGroup.add(duct);

    const duct2 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 4.0), ductMat);
    duct2.position.set(-2.0, 2.1, 0);
    plantGroup.add(duct2);

    // Control panel
    const panelGeo = new THREE.BoxGeometry(0.1, 0.6, 0.8);
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x10b981, emissiveIntensity: 0.4 });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.set(-1.55, 1.4, 0);
    plantGroup.add(panel);

    this.group.add(plantGroup);
    this.addObstacle(plantGroup, 'HVAC AHU');
  }

  private createLobbyReception(x: number, z: number) {
    const recGroup = new THREE.Group();
    recGroup.position.set(x, 0, z);

    const deskGeo = new THREE.BoxGeometry(5.0, 1.0, 1.5);
    const deskMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1 }); // Glossy white
    const desk = new THREE.Mesh(deskGeo, deskMat);
    desk.position.set(0, 0.5, 0);
    recGroup.add(desk);

    // Wood accent
    const woodGeo = new THREE.BoxGeometry(4.8, 0.8, 1.6);
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.7 }); 
    const wood = new THREE.Mesh(woodGeo, woodMat);
    wood.position.set(0, 0.4, 0.05);
    recGroup.add(wood);
    
    // Plant
    const potGeo = new THREE.CylinderGeometry(0.3, 0.2, 0.6);
    const potMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const pot = new THREE.Mesh(potGeo, potMat);
    pot.position.set(-3.0, 0.3, 0);
    recGroup.add(pot);

    const plantGeo = new THREE.SphereGeometry(0.5);
    const plantMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.9 });
    const plant = new THREE.Mesh(plantGeo, plantMat);
    plant.position.set(-3.0, 0.9, 0);
    recGroup.add(plant);

    this.group.add(recGroup);
    this.addObstacle(recGroup, 'Lobby Reception');
  }

  private addHVACDiffusers() {
    const diffuserGeo = new THREE.PlaneGeometry(0.6, 0.6);
    diffuserGeo.rotateX(-Math.PI / 2);
    
    // Distribute diffusers across the ceiling grid
    const diffuserMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    for(let x=-18; x<=18; x+=6) {
      for(let z=-12; z<=12; z+=6) {
        // Skip walls
        if (Math.abs(x) < 2 || Math.abs(z) < 2) continue;
        const diff = new THREE.Mesh(diffuserGeo, diffuserMat);
        diff.position.set(x, 4.19, z);
        this.group.add(diff);
      }
    }
  }

  // --- END MILESTONE 2 GENERATORS ---

  constructor(materials?: Materials) {
    this.materials = materials || Materials.getInstance();
    this.group.name = 'HealthcareSceneGroup';
  }

  public build(): void {
    if (this.group.children.length > 0) return;

    // Architectural Floor Slab (44m x 32m)
    const floorGeo = new THREE.PlaneGeometry(44, 32);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.3,
      metalness: 0.1
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.receiveShadow = true;
    this.group.add(floorMesh);

    // Ceiling Slab (44m x 32m at Y=4.2)
    const ceilingGeo = new THREE.PlaneGeometry(44, 32);
    ceilingGeo.rotateX(Math.PI / 2);
    const ceilingMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.8,
      metalness: 0.05
    });
    const ceilingMesh = new THREE.Mesh(ceilingGeo, ceilingMat);
    ceilingMesh.position.y = 4.2;
    this.group.add(ceilingMesh);

    // Perimeter Walls
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.7,
      metalness: 0.05
    });

    const createWall = (w: number, h: number, d: number, x: number, y: number, z: number, name: string) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);

      const box = new THREE.Box3();
      box.setFromObject(mesh);
      this.obstacles.push({
        box,
        name,
        id: `hc_wall_${this.obstacles.length + 1}`
      });
    };

    // North & South Perimeter Walls (X: 44m, Z: 0.4m)
    createWall(44, 4.2, 0.4, 0, 2.1, -16, 'North Perimeter Wall');
    createWall(44, 4.2, 0.4, 0, 2.1, 16, 'South Perimeter Wall');

    // East & West Perimeter Walls (X: 0.4m, Z: 32m)
    createWall(0.4, 4.2, 32, -22, 2.1, 0, 'West Perimeter Wall');
    createWall(0.4, 4.2, 32, 22, 2.1, 0, 'East Perimeter Wall');

    // Central Corridor Partitions (leaving doorways)
    createWall(18, 4.2, 0.3, -11, 2.1, 0, 'West Dividing Wall');
    createWall(18, 4.2, 0.3, 11, 2.1, 0, 'East Dividing Wall');
    createWall(0.3, 4.2, 12, 0, 2.1, -10, 'North Dividing Wall');
    createWall(0.3, 4.2, 12, 0, 2.1, 10, 'South Dividing Wall');

    
    // --- MILESTONE 2: ASSET INSTANTIATION ---
    // 1. Clinical Areas (ICU/Ward)
    this.createPatientBed(-18, -12, 0);
    this.createPatientBed(-14, -12, 0);
    this.createPatientBed(-18, -4, 0);
    this.createPatientBed(-14, -4, 0);

    // 2. Staff Areas (Nurse Station)
    this.createNurseStation(10, 10);

    // 3. Support HVAC (AHU Plant)
    this.createHVACPlant(12, -8);
    this.createHVACPlant(18, -8);
    this.createHVACPlant(15, -13);

    // 4. Lobby
    this.createLobbyReception(-12, 8);

    // 5. HVAC Ceiling Grilles
    this.addHVACDiffusers();
    // --- END MILESTONE 2 ASSETS ---

    // Create GlassBoards for the 4 zones
    const zoneKeys = Object.keys(HEALTHCARE_ZONES);
    const gbOffsets: Record<string, [number, number, number, number]> = {
      hospital_lobby: [-1.0, 2.0, 15.7, Math.PI],
      clinical_areas: [-1.0, 2.0, -15.7, 0],
      staff_areas: [1.0, 2.0, 15.7, Math.PI],
      support_hvac: [1.0, 2.0, -15.7, 0]
    };

    zoneKeys.forEach(key => {
      const offset = gbOffsets[key] || [0, 2.0, 0, 0];
      const gb = new GlassBoard(2.4, 1.35, false);
      gb.group.position.set(offset[0], offset[1], offset[2]);
      gb.group.rotation.y = offset[3];
      this.group.add(gb.group);
      this.glassBoards[key] = gb;
    });
  }

  public mount(parentScene: THREE.Scene): void {
    if (this.group.children.length === 0) {
      this.build();
    }
    parentScene.add(this.group);
  }

  public unmount(parentScene: THREE.Scene): void {
    parentScene.remove(this.group);
  }

  public dispose(): void {
    Object.values(this.glassBoards).forEach(gb => gb.dispose?.());
    this.glassBoards = {};
    disposeHierarchy(this.group, { disposeSharedMaterials: false });
    this.obstacles = [];
    this.interactables = [];
  }

  public update(_delta: number, _time: number): void {
    // Updaters for healthcare scene
  }

  public getObstacles(): ObstacleBox[] {
    return this.obstacles;
  }

  public getInteractables(): IInteractable[] {
    return this.interactables;
  }

  public getZones(): Record<string, ZoneBounds> {
    return HEALTHCARE_ZONES;
  }

  public getZoneMetas(): Record<string, any> {
    return HEALTHCARE_ZONE_METAS;
  }

  public getGlassBoards(): Record<string, GlassBoard> {
    return this.glassBoards;
  }

  public getMinimapRooms(): IMinimapRoom[] {
    return this.minimapRooms;
  }

  public getMascotPosition(): THREE.Vector3 {
    return new THREE.Vector3(0, 1.0, 8.0);
  }

  public getMascotSpawnPosition(): THREE.Vector3 {
    return new THREE.Vector3(0, 1.0, 8.0);
  }

  public getTeleportBindings(): TeleportBinding[] {
    return [
      { key: '1', zoneId: 'hospital_lobby', label: 'Lobby' },
      { key: '2', zoneId: 'clinical_areas', label: 'Clinical' },
      { key: '3', zoneId: 'staff_areas', label: 'Staff' },
      { key: '4', zoneId: 'support_hvac', label: 'HVAC' }
    ];
  }
}
