import * as THREE from 'three';
import { ISceneManager, ILightingManager, LightingPresetName, IPerformanceMetrics } from '../types';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export class SceneManager implements ISceneManager {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public lightingManager!: ILightingManager;
  public container!: HTMLElement;
  public composer!: EffectComposer;
  public sky!: Sky;

  private clock: THREE.Clock;
  private isRunning: boolean = false;
  private animationFrameId: number | null = null;
  private updateCallbacks: Array<(delta: number, elapsed: number) => void> = [];

  // Performance telemetry
  private fps: number = 60;
  private frameCount: number = 0;
  private lastFpsTime: number = 0;

  constructor() {
    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock();

    // Perspective Camera setup (65 deg FOV, eye height 1.6m at entrance)
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 150);
    this.camera.position.set(0, 1.6, 11.5);

    // WebGL Renderer setup with high performance & PBR settings
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      depth: true
    });

    this.configureRenderer();
    this.setupResizeListener();
  }

  private configureRenderer(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Color management & ACES Filmic Tone Mapping
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    // Soft Shadow Map Configuration
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  public init(container: HTMLElement): void {
    this.container = container;
    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.onResize(width, height);

    // Setup Atmospheric Sky
    this.sky = new Sky();
    this.sky.scale.setScalar(10000);
    this.scene.add(this.sky);

    // Set default sky uniforms (will be overridden by LightingManager)
    const uniforms = this.sky.material.uniforms;
    uniforms['turbidity'].value = 10;
    uniforms['rayleigh'].value = 2;
    uniforms['mieCoefficient'].value = 0.005;
    uniforms['mieDirectionalG'].value = 0.8;

    // Generate procedural environment map for glass material reflections
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    
    // Create a dummy scene with some contrast for reflections
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x1a1a2e);
    
    // Add some bright "windows" or "lights" to the environment
    const box1 = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    box1.position.set(0, 5, -10);
    envScene.add(box1);
    
    const box2 = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 1), new THREE.MeshBasicMaterial({ color: 0x00f0ff }));
    box2.position.set(-15, 5, 0);
    box2.rotation.y = Math.PI / 2;
    envScene.add(box2);

    const rt = pmremGenerator.fromScene(envScene);
    this.scene.environment = rt.texture;
    
    rt.dispose();
    pmremGenerator.dispose();

    // Setup Post-processing Pipeline
    this.composer = new EffectComposer(this.renderer);
    
    // 1. Base Render Pass
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // 2. High-Threshold Bloom Pass (Only catches emissive intensity > 1.0)
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.2,  // strength (reduced from 0.8)
      0.15,  // radius (tighter glow)
      1.2   // threshold (reduced to catch >1.2 brightness)
    );
    this.composer.addPass(bloomPass);

    // 3. Output Pass (Tone Mapping is automatically handled here in latest Three.js versions)
    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  public registerUpdateCallback(cb: (delta: number, elapsed: number) => void): void {
    this.updateCallbacks.push(cb);
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.clock.start();
    this.lastFpsTime = performance.now();
    this.loop();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private loop = (): void => {
    if (!this.isRunning) return;
    this.animationFrameId = requestAnimationFrame(this.loop);

    const rawDelta = this.clock.getDelta();
    const delta = Math.min(rawDelta, 0.1); // Clamp to avoid background lag spikes
    const elapsed = this.clock.getElapsedTime();

    // Update FPS moving average
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime));
      this.frameCount = 0;
      this.lastFpsTime = now;
    }

    // Update Lighting transitions
    if (this.lightingManager) {
      this.lightingManager.update(delta);
    }

    // Execute registered subsystem update callbacks
    for (let i = 0; i < this.updateCallbacks.length; i++) {
      this.updateCallbacks[i](delta, elapsed);
    }

    this.render();
  };

  public render(): void {
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  public onResize(width: number, height: number): void {
    if (height <= 0) height = 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setSize(width, height);
    }
  }

  private setupResizeListener(): void {
    window.addEventListener('resize', () => {
      const w = this.container ? this.container.clientWidth : window.innerWidth;
      const h = this.container ? this.container.clientHeight : window.innerHeight;
      this.onResize(w, h);
    });
  }

  public setLightingPreset(preset: LightingPresetName): void {
    if (this.lightingManager) {
      this.lightingManager.setPreset(preset);
    }
  }

  public setShadowsEnabled(enabled: boolean): void {
    this.renderer.shadowMap.enabled = enabled;
    if (this.lightingManager) {
      this.lightingManager.setShadowsEnabled(enabled);
    }
  }

  public setQuality(dprScale: number): void {
    const targetDpr = Math.min(window.devicePixelRatio, Math.max(0.5, dprScale));
    this.renderer.setPixelRatio(targetDpr);
  }

  public getPerformanceMetrics(): IPerformanceMetrics {
    return {
      fps: this.fps,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures
    };
  }

  public getFPS(): number {
    return this.fps;
  }

  public getDrawCalls(): number {
    return this.renderer.info.render.calls;
  }

  public getTriangleCount(): number {
    return this.renderer.info.render.triangles;
  }
}
