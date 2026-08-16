import * as THREE from 'three';
import { HVACCanvas, ZoneHVACData } from './HVACCanvas';

export class GlassBoard {
  public group: THREE.Group;
  public glassMesh: THREE.Mesh;
  public hvacCanvas: HVACCanvas;
  private uiMesh: THREE.Mesh;

  constructor(width = 2.4, height = 1.35, isCommandGlass = false) {
    this.group = new THREE.Group();
    this.hvacCanvas = new HVACCanvas(isCommandGlass ? 1280 : 1024, isCommandGlass ? 720 : 576);

    // 1. Physical Glass Panel
    const glassGeometry = new THREE.BoxGeometry(width, height, 0.05);
    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.95,
      opacity: 1.0,
      transparent: true,
      roughness: 0.15,
      metalness: 0.1,
      ior: 1.5,
      thickness: 0.5,
      attenuationColor: new THREE.Color(0x00f0ff),
      attenuationDistance: 2.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
      side: THREE.DoubleSide,
    });
    this.glassMesh = new THREE.Mesh(glassGeometry, glassMaterial);
    this.glassMesh.userData.disablePulse = true;
    this.glassMesh.castShadow = true;
    this.glassMesh.receiveShadow = true;
    this.group.add(this.glassMesh);

    // 2. UI Plane (floating slightly in front to avoid Z-fighting)
    const uiGeometry = new THREE.PlaneGeometry(width * 0.95, height * 0.95);
    const uiMaterial = new THREE.MeshStandardMaterial({
      map: this.hvacCanvas.texture,
      emissiveMap: this.hvacCanvas.texture,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 1.8, // Reduced to prevent blinding bloom
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false, // helps with transparency sorting over glass
    });
    this.uiMesh = new THREE.Mesh(uiGeometry, uiMaterial);
    this.uiMesh.position.z = 0.03; // Just in front of the glass
    
    // Assign to layer 1 for selective bloom (Phase 3)
    this.uiMesh.layers.enable(1);
    this.group.add(this.uiMesh);

    // 3. Chrome Standoffs
    const standoffGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.08, 16);
    standoffGeometry.rotateX(Math.PI / 2);
    const standoffMaterial = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      metalness: 1.0,
      roughness: 0.2
    });

    const insetX = width / 2 - 0.1;
    const insetY = height / 2 - 0.1;

    const positions = [
      [-insetX, insetY],
      [insetX, insetY],
      [-insetX, -insetY],
      [insetX, -insetY]
    ];

    positions.forEach(([x, y]) => {
      const standoff = new THREE.Mesh(standoffGeometry, standoffMaterial);
      standoff.position.set(x, y, -0.02); // sticking into the wall
      this.group.add(standoff);
    });
  }

  public updateData(data: ZoneHVACData) {
    this.hvacCanvas.drawZoneData(data);
  }
}
