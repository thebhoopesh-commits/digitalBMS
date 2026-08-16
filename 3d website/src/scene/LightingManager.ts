import * as THREE from 'three';
import { ILightingManager, LightingPresetName, ILightingPreset } from '../types';

export const LIGHTING_PRESETS: Record<LightingPresetName, ILightingPreset> = {
  day: {
    name: 'day',
    sunColor: 0xfff6e5,       // Warm bright morning sunlight
    sunIntensity: 1.8,
    sunPosition: [22.0, 28.0, 18.0],
    hemiSkyColor: 0xe2e8f0,   // Clear sky daylight fill
    hemiGroundColor: 0x94a3b8,
    hemiIntensity: 0.75,
    ambientColor: 0xffffff,
    ambientIntensity: 0.15,
    ceilingColor: 0xfff4e6,   // Soft warm interior downlights
    ceilingIntensity: 0.35,
    fogColor: 0xdbeafe,       // Soft sky blue horizon fog
    fogNear: 150.0,
    fogFar: 500.0,
    clearColor: 0xdbeafe,
    emissiveMultiplier: 0.8,
    skyTurbidity: 2,
    skyRayleigh: 0.5,
    skyMieCoef: 0.005
  },
  sunset: {
    name: 'sunset',
    sunColor: 0xff6a22,       // Deep dramatic golden hour sun
    sunIntensity: 2.4,
    sunPosition: [35.0, 3.0, 12.0], // Lowered sun for better sunset rays
    hemiSkyColor: 0x7c2d12,   // Amber/crimson dusk sky
    hemiGroundColor: 0x1e1b4b,
    hemiIntensity: 0.45,
    ambientColor: 0xffedd5,
    ambientIntensity: 0.12,
    ceilingColor: 0xffaa55,   // Warm tungsten ceiling lamps
    ceilingIntensity: 0.85,
    fogColor: 0x51202e,       // Dusk rose-purple horizon fog
    fogNear: 100.0,
    fogFar: 450.0,
    clearColor: 0x51202e,
    emissiveMultiplier: 1.2,
    skyTurbidity: 10,
    skyRayleigh: 2,
    skyMieCoef: 0.05
  },
  night: {
    name: 'night',
    sunColor: 0x3b82f6,       // Cool lunar blue moonlight
    sunIntensity: 0.35,
    sunPosition: [-20.0, 25.0, -15.0],
    hemiSkyColor: 0x0f172a,   // Midnight blue sky fill
    hemiGroundColor: 0x020617,
    hemiIntensity: 0.25,
    ambientColor: 0x1e293b,
    ambientIntensity: 0.08,
    ceilingColor: 0xffd8a8,   // Bright warm functional downlights
    ceilingIntensity: 1.4,
    fogColor: 0x05070c,       // Deep obsidian nocturnal fog
    fogNear: 80.0,
    fogFar: 350.0,
    clearColor: 0x05070c,
    emissiveMultiplier: 1.8,
    skyTurbidity: 20,
    skyRayleigh: 0.1,
    skyMieCoef: 0.001
  }
};

export class LightingManager implements ILightingManager {
  public currentPreset: LightingPresetName = 'day';
  public sunLight!: THREE.DirectionalLight;
  public hemiLight!: THREE.HemisphereLight;
  public ambientLight!: THREE.AmbientLight;
  public ceilingLights: THREE.PointLight[] = [];

  private scene: THREE.Scene;
  private renderer?: THREE.WebGLRenderer;
  private isTransitioning = false;
  private transitionTime = 0;
  private transitionDuration = 1.0;
  private startConfig!: ILightingPreset;
  private targetConfig!: ILightingPreset;

  constructor(scene: THREE.Scene, renderer?: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.initLights();
    this.setPreset('day', 0);
  }

  private initLights(): void {
    // 1. Primary Directional Sunlight with Shadow Map
    this.sunLight = new THREE.DirectionalLight(0xfff6e5, 1.8);
    this.sunLight.position.set(22.0, 28.0, 18.0);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 1.0;
    this.sunLight.shadow.camera.far = 75.0;
    this.sunLight.shadow.camera.left = -24;
    this.sunLight.shadow.camera.right = 24;
    this.sunLight.shadow.camera.top = 16;
    this.sunLight.shadow.camera.bottom = -16;
    this.sunLight.shadow.bias = -0.00015;
    this.sunLight.shadow.normalBias = 0.025;
    this.sunLight.shadow.radius = 2.0;
    this.scene.add(this.sunLight);

    // 2. Hemisphere Ambient Fill
    this.hemiLight = new THREE.HemisphereLight(0xe2e8f0, 0x94a3b8, 0.75);
    this.hemiLight.position.set(0, 20, 0);
    this.scene.add(this.hemiLight);

    // 3. Minimum Global Fill
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
    this.scene.add(this.ambientLight);

    // 4. Ceiling Point Lights Grid across all zones
    const downlightCoords: [number, number, number][] = [
      [-7.0, 3.6, 7.5],   // Reception
      [-8.5, 3.6, -8.5],  // Workstations North
      [-8.5, 3.6, -3.5],  // Workstations South
      [12.0, 3.6, -6.0],  // Conference
      [9.5, 3.6, 8.0],    // Lounge
      [15.5, 3.6, 6.5],   // Coffee Bar
      [-6.0, 3.6, 1.5],   // Corridor West
      [6.0, 3.6, 1.5]     // Corridor East
    ];

    downlightCoords.forEach(pos => {
      const pl = new THREE.PointLight(0xfff4e6, 0.35, 14.0, 2.0);
      pl.position.set(pos[0], pos[1], pos[2]);
      pl.castShadow = false; // Fast & optimized
      this.ceilingLights.push(pl);
      this.scene.add(pl);
    });

    // 5. Initial Atmospheric Fog
    this.scene.fog = new THREE.Fog(0xdbeafe, 25.0, 75.0);
    this.scene.background = new THREE.Color(0xdbeafe);
  }

  public setPreset(preset: LightingPresetName, duration = 1.0): void {
    if (!LIGHTING_PRESETS[preset]) return;

    if (duration <= 0) {
      this.applyConfig(LIGHTING_PRESETS[preset]);
      this.currentPreset = preset;
      this.isTransitioning = false;
      return;
    }

    this.startConfig = LIGHTING_PRESETS[this.currentPreset];
    this.targetConfig = LIGHTING_PRESETS[preset];
    this.currentPreset = preset;
    this.transitionDuration = duration;
    this.transitionTime = 0;
    this.isTransitioning = true;
  }

  private applyConfig(config: ILightingPreset): void {
    this.sunLight.color.setHex(config.sunColor);
    this.sunLight.intensity = config.sunIntensity;
    this.sunLight.position.set(config.sunPosition[0], config.sunPosition[1], config.sunPosition[2]);

    this.hemiLight.color.setHex(config.hemiSkyColor);
    this.hemiLight.groundColor.setHex(config.hemiGroundColor);
    this.hemiLight.intensity = config.hemiIntensity;

    this.ambientLight.color.setHex(config.ambientColor);
    this.ambientLight.intensity = config.ambientIntensity;

    this.ceilingLights.forEach(pl => {
      pl.color.setHex(config.ceilingColor);
      pl.intensity = config.ceilingIntensity;
    });

    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.setHex(config.fogColor);
      this.scene.fog.near = config.fogNear;
      this.scene.fog.far = config.fogFar;
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.setHex(config.clearColor);
    }

    const sky = this.scene.children.find(c => (c as any).material?.uniforms?.turbidity);
    if (sky) {
      const uniforms = (sky as any).material.uniforms;
      uniforms['turbidity'].value = config.skyTurbidity;
      uniforms['rayleigh'].value = config.skyRayleigh;
      uniforms['mieCoefficient'].value = config.skyMieCoef;
      uniforms['sunPosition'].value.copy(this.sunLight.position);
    }
  }

  public setShadowsEnabled(enabled: boolean): void {
    this.sunLight.castShadow = enabled;
    if (this.renderer) {
      this.renderer.shadowMap.enabled = enabled;
    }
  }

  public update(delta: number): void {
    if (!this.isTransitioning) return;

    this.transitionTime += delta;
    const progress = Math.min(1.0, this.transitionTime / this.transitionDuration);
    // Cosine ease in/out
    const t = 0.5 - 0.5 * Math.cos(progress * Math.PI);

    // Lerp Sun
    const startSunCol = new THREE.Color(this.startConfig.sunColor);
    const targetSunCol = new THREE.Color(this.targetConfig.sunColor);
    this.sunLight.color.copy(startSunCol.lerp(targetSunCol, t));
    this.sunLight.intensity = THREE.MathUtils.lerp(this.startConfig.sunIntensity, this.targetConfig.sunIntensity, t);
    this.sunLight.position.set(
      THREE.MathUtils.lerp(this.startConfig.sunPosition[0], this.targetConfig.sunPosition[0], t),
      THREE.MathUtils.lerp(this.startConfig.sunPosition[1], this.targetConfig.sunPosition[1], t),
      THREE.MathUtils.lerp(this.startConfig.sunPosition[2], this.targetConfig.sunPosition[2], t)
    );

    // Lerp Hemi
    const startHemiSky = new THREE.Color(this.startConfig.hemiSkyColor);
    const targetHemiSky = new THREE.Color(this.targetConfig.hemiSkyColor);
    this.hemiLight.color.copy(startHemiSky.lerp(targetHemiSky, t));

    const startHemiGround = new THREE.Color(this.startConfig.hemiGroundColor);
    const targetHemiGround = new THREE.Color(this.targetConfig.hemiGroundColor);
    this.hemiLight.groundColor.copy(startHemiGround.lerp(targetHemiGround, t));
    this.hemiLight.intensity = THREE.MathUtils.lerp(this.startConfig.hemiIntensity, this.targetConfig.hemiIntensity, t);

    // Lerp Ambient
    const startAmb = new THREE.Color(this.startConfig.ambientColor);
    const targetAmb = new THREE.Color(this.targetConfig.ambientColor);
    this.ambientLight.color.copy(startAmb.lerp(targetAmb, t));
    this.ambientLight.intensity = THREE.MathUtils.lerp(this.startConfig.ambientIntensity, this.targetConfig.ambientIntensity, t);

    // Lerp Ceiling Lights
    const startCeil = new THREE.Color(this.startConfig.ceilingColor);
    const targetCeil = new THREE.Color(this.targetConfig.ceilingColor);
    const ceilCol = startCeil.lerp(targetCeil, t);
    const ceilInt = THREE.MathUtils.lerp(this.startConfig.ceilingIntensity, this.targetConfig.ceilingIntensity, t);
    this.ceilingLights.forEach(pl => {
      pl.color.copy(ceilCol);
      pl.intensity = ceilInt;
    });

    // Lerp Fog & Background
    if (this.scene.fog instanceof THREE.Fog) {
      const startFog = new THREE.Color(this.startConfig.fogColor);
      const targetFog = new THREE.Color(this.targetConfig.fogColor);
      this.scene.fog.color.copy(startFog.lerp(targetFog, t));
      this.scene.fog.near = THREE.MathUtils.lerp(this.startConfig.fogNear, this.targetConfig.fogNear, t);
      this.scene.fog.far = THREE.MathUtils.lerp(this.startConfig.fogFar, this.targetConfig.fogFar, t);
    }
    if (this.scene.background instanceof THREE.Color) {
      const startBg = new THREE.Color(this.startConfig.clearColor);
      const targetBg = new THREE.Color(this.targetConfig.clearColor);
      this.scene.background.copy(startBg.lerp(targetBg, t));
    }

    // Lerp Sky
    const sky = this.scene.children.find(c => (c as any).material?.uniforms?.turbidity);
    if (sky) {
      const uniforms = (sky as any).material.uniforms;
      uniforms['turbidity'].value = THREE.MathUtils.lerp(this.startConfig.skyTurbidity, this.targetConfig.skyTurbidity, t);
      uniforms['rayleigh'].value = THREE.MathUtils.lerp(this.startConfig.skyRayleigh, this.targetConfig.skyRayleigh, t);
      uniforms['mieCoefficient'].value = THREE.MathUtils.lerp(this.startConfig.skyMieCoef, this.targetConfig.skyMieCoef, t);
      uniforms['sunPosition'].value.copy(this.sunLight.position);
    }

    if (progress >= 1.0) {
      this.isTransitioning = false;
    }
  }

  public dispose(): void {
    this.scene.remove(this.sunLight, this.hemiLight, this.ambientLight);
    this.ceilingLights.forEach(pl => this.scene.remove(pl));
    this.ceilingLights = [];
  }
}
