import * as THREE from 'three';

// ==========================================
// 1. Scene & Lighting Subsystem
// ==========================================

export type LightingPresetName = 'day' | 'sunset' | 'night';

export interface ILightingPreset {
  name: LightingPresetName;
  sunColor: number;
  sunIntensity: number;
  sunPosition: [number, number, number];
  hemiSkyColor: number;
  hemiGroundColor: number;
  hemiIntensity: number;
  ambientColor: number;
  ambientIntensity: number;
  ceilingColor: number;
  ceilingIntensity: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  clearColor: number;
  emissiveMultiplier: number;
  skyTurbidity: number;
  skyRayleigh: number;
  skyMieCoef: number;
}

export interface ILightingManager {
  currentPreset: LightingPresetName;
  sunLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  ambientLight: THREE.AmbientLight;
  ceilingLights: THREE.PointLight[];
  setPreset(preset: LightingPresetName, duration?: number): void;
  setShadowsEnabled(enabled: boolean): void;
  update(delta: number): void;
  dispose?(): void;
  updateRealtimeSun(simHour: number, lat: number, lon: number): void;
  isRealtimeSunEnabled: boolean;
}

export interface IPerformanceMetrics {
  fps: number;
  drawCalls: number;
  triangles: number;
  geometries?: number;
  textures?: number;
}

export interface ISceneManager {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  lightingManager: ILightingManager;
  init(container: HTMLElement): void;
  render(): void;
  onResize(width: number, height: number): void;
  setLightingPreset(preset: LightingPresetName): void;
  setShadowsEnabled(enabled: boolean): void;
  setQuality(dprScale: number): void;
  getPerformanceMetrics(): IPerformanceMetrics;
  getFPS(): number;
  getDrawCalls(): number;
  getTriangleCount(): number;
}

// ==========================================
// 2. Navigation & Physics Subsystem
// ==========================================

export type NavigationMode = 'fps' | 'orbit' | 'transitioning' | 'focus';

export type EnvironmentId = 'corporate' | 'healthcare';
export type CorporateZoneId = 'lobby' | 'open_office' | 'conference_room';
export type HealthcareZoneId = 'hospital_lobby' | 'clinical_areas' | 'staff_areas' | 'support_hvac';
export type EnvironmentZoneId = CorporateZoneId | HealthcareZoneId;
export type ZoneId = CorporateZoneId | HealthcareZoneId | string;

export interface IEnvironmentBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY?: number;
  maxY?: number;
}

export interface IMinimapRoom {
  label: string;
  bounds: [number, number, number, number]; // [minX, minZ, maxX, maxZ] in world meters
  color?: string;
}

export interface ZoneBounds {
  id: string;
  name: string;
  displayName: string;
  center: THREE.Vector3;
  spawnPosition: THREE.Vector3;
  spawnYaw: number;
  bounds: THREE.Box3;
}

export interface ObstacleBox {
  box: THREE.Box3;
  name: string;
  id: string;
  isDoor?: boolean;
}

export interface TeleportBinding {
  key: string;
  zoneId: string;
  label: string;
}

export interface IEnvironmentScene {
  readonly id: EnvironmentId;
  readonly name: string;
  readonly defaultSpawnPosition: THREE.Vector3;
  readonly defaultSpawnYaw: number;
  readonly worldBounds: IEnvironmentBounds;
  readonly group: THREE.Group;
  readonly minimapRooms: IMinimapRoom[];
  readonly commandGlass?: any;

  build(): Promise<void> | void;
  mount(parentScene: THREE.Scene): void;
  unmount(parentScene: THREE.Scene): void;
  dispose(): void;
  update(delta: number, time: number): void;

  getObstacles(): ObstacleBox[];
  getInteractables(): IInteractable[];
  getZones(): Record<string, ZoneBounds>;
  getZoneMetas(): Record<string, any>;
  getGlassBoards(): Record<string, any>;
  getMinimapRooms?(): IMinimapRoom[];
  getMascotPosition?(): THREE.Vector3;
  getMascotSpawnPosition?(): THREE.Vector3;
  getBuildingMeta?(): any;
  getTeleportBindings?(): TeleportBinding[];
}

export interface IZoneDefinition {
  id: ZoneId;
  name: string;
  displayName: string;
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  spawnPoint: {
    x: number;
    y: number;
    z: number;
    yaw: number;
  };
  description?: string;
}

export interface AABBObstacle {
  id?: string;
  name?: string;
  zone?: string;
  min: THREE.Vector3;
  max: THREE.Vector3;
  isDoor?: boolean;
  isOpen?: boolean;
}

export interface ICollisionEngine {
  obstacles: AABBObstacle[];
  addObstacle(box: THREE.Box3, name?: string): void;
  clearObstacles(): void;
  resolveMovement(
    currentPos: THREE.Vector3,
    desiredMovement: THREE.Vector3,
    playerRadius: number,
    playerHeight: number
  ): THREE.Vector3;
  isPositionValid(position: THREE.Vector3, playerRadius: number): boolean;
}

export interface IFirstPersonController {
  isLocked: boolean;
  isSprinting: boolean;
  velocity: THREE.Vector3;
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
  init(domElement: HTMLElement, camera: THREE.PerspectiveCamera): void;
  update(delta: number): void;
  setPosition(pos: THREE.Vector3, yaw?: number): void;
  lock(): void;
  unlock(): void;
  setEnabled(enabled: boolean): void;
  onFootstep?: (surface?: SurfaceType) => void;
}

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

// ==========================================
// 3. Interaction & Dynamic Screens Subsystem
// ==========================================

export type InteractableCategory = 'screen' | 'light' | 'door' | 'appliance' | 'board' | 'seating';

export interface InteractableDetails {
  title: string;
  category: string;
  description: string;
  actions?: string[];
  metadata?: Record<string, string | number>;
}

export interface IInteractable {
  id: string;
  name: string;
  category: InteractableCategory;
  mesh: THREE.Object3D;
  prompt: string;
  distanceCutoff?: number;
  onHover?: (isHovered: boolean) => void;
  onInteract?: () => void;
  getDetails?: () => InteractableDetails;
}

export type ScreenDisplayType = 'slides' | 'telemetry' | 'matrix' | 'terminal' | 'whiteboard';

export interface IDynamicScreen {
  id: string;
  type: ScreenDisplayType;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  mesh: THREE.Mesh;
  update(delta: number): void;
  nextSlide?(): void;
  prevSlide?(): void;
  toggleTheme?(): void;
  dispose?(): void;
}

export interface IInteractionManager {
  register(interactable: IInteractable): void;
  unregister(id: string): void;
  update(camera: THREE.Camera, mode: NavigationMode, mouseNDC?: THREE.Vector2): void;
  triggerPrimaryAction(): void;
  getActiveInteractable(): IInteractable | null;
  getInteractables(): IInteractable[] | string[];
  getInteractableIds?(): string[];
  triggerAction?(id: string): boolean;
}

// ==========================================
// 4. Audio Subsystem
// ==========================================

export type SurfaceType = 'carpet' | 'tile' | 'wood' | 'metal';

export interface IAudioManager {
  isMuted: boolean;
  masterVolume: number;
  isAmbientPlaying?: boolean;
  init(): Promise<void>;
  playFootstep(surface?: SurfaceType): void;
  playClick(): void;
  playChime(): void;
  playCoffeeBrew(): void;
  playDoorSound?(open?: boolean): void;
  playLightSwitch?(on?: boolean): void;
  setAmbientEnabled(enabled: boolean): void;
  setMasterVolume(volume: number): void;
  toggleMute(): boolean;
}

// ==========================================
// 5. HUD, Minimap & Settings UI Subsystem
// ==========================================

export type ReticleState = 'idle' | 'hover' | 'interact' | 'hidden';
export type GraphicsQuality = 'performance' | 'standard' | 'high' | 'ultra';

export interface IMinimap {
  init(container: HTMLElement): void;
  update(playerPos: THREE.Vector3, playerYaw: number): void;
  setVisible?(visible: boolean): void;
  onZoneClick?: (zoneName: string) => void;
}

export interface IHUDManager {
  init(container: HTMLElement): void;
  setModeBadge(mode: 'fps' | 'orbit'): void;
  setZoneBanner(zoneName: string): void;
  setReticleState?(state: ReticleState): void;
  showInteractionPrompt?(text: string | null, keyHint?: string): void;
  hideInteractionPrompt?(): void;
  showModal?(title: string, content: HTMLElement | string, actions?: string[]): void;
  hideModal?(): void;
  showHelpModal?(): void;
  hideHelpModal?(): void;
  updatePerformanceStats?(metrics: IPerformanceMetrics): void;
}

export interface ISettingsDrawer {
  isOpen: boolean;
  init(container: HTMLElement): void;
  open(): void;
  close(): void;
  toggle(): void;
  onLightingChange?: (preset: LightingPresetName) => void;
  onShadowsChange?: (enabled: boolean) => void;
  onQualityChange?: (quality: GraphicsQuality) => void;
  onVolumeChange?: (volume: number) => void;
}

// ==========================================
// 6. Automation Debug Contract (Playwright Harness)
// ==========================================

export interface IOfficeDebug {
  sceneManager: ISceneManager;
  navigationManager?: INavigationManager;
  interactionManager?: IInteractionManager;
  audioManager?: IAudioManager;
  hudManager?: IHUDManager;
  minimap?: IMinimap;
  getFPS(): number;
  getDrawCalls(): number;
  getTriangleCount(): number;
  getPlayerPosition(): { x: number; y: number; z: number; yaw: number };
  getInteractables(): string[];
  triggerInteract(id: string): boolean;
  teleport(zone: string): boolean;
  setLighting(preset: string): boolean;
  setMode?(mode: string): boolean;
  testMascotState?(state: string): boolean;
  switchView?(view: 'operations' | '3d'): boolean;
  switchEnvironment?(env: EnvironmentId | string): Promise<boolean>;
  getActiveEnvironment?(): EnvironmentId | string;
  getAvailableEnvironments?(): (EnvironmentId | string)[];
  isTransitioning?(): boolean;
}

export type OfficeDebugAPI = IOfficeDebug;

declare global {
  interface Window {
    __OFFICE_DEBUG__?: IOfficeDebug;
  }
}
