import * as THREE from 'three';
import { EnvironmentId, IEnvironmentScene } from '../types';
import { Materials } from './Materials';
import { CorporateScene } from './corporate/CorporateScene';
import { HealthcareScene } from './healthcare/HealthcareScene';

export class EnvironmentManager {
  private parentScene: THREE.Scene;
  private environments: Map<EnvironmentId, IEnvironmentScene> = new Map();
  private activeEnvironmentId: EnvironmentId = 'corporate';
  private activeScene!: IEnvironmentScene;
  private isTransitioning: boolean = false;
  private listeners: Set<(envId: EnvironmentId, scene: IEnvironmentScene) => void> = new Set();
  private materials: Materials;

  constructor(parentScene: THREE.Scene, materials?: Materials) {
    this.parentScene = parentScene;
    this.materials = materials || Materials.getInstance();

    // Register standard environments
    this.registerEnvironment(new CorporateScene(this.materials));
    this.registerEnvironment(new HealthcareScene(this.materials));
  }

  public registerEnvironment(scene: IEnvironmentScene): void {
    this.environments.set(scene.id, scene);
  }

  public getEnvironment(id: EnvironmentId): IEnvironmentScene | undefined {
    return this.environments.get(id);
  }

  public getActiveScene(): IEnvironmentScene {
    return this.activeScene;
  }

  public getActiveEnvironmentId(): EnvironmentId {
    return this.activeEnvironmentId;
  }

  public getAvailableEnvironments(): EnvironmentId[] {
    return Array.from(this.environments.keys());
  }

  public isTransitioningActive(): boolean {
    return this.isTransitioning;
  }

  public mount(scene: IEnvironmentScene): void {
    scene.mount(this.parentScene);
  }

  public unmount(scene: IEnvironmentScene, dispose = false): void {
    scene.unmount(this.parentScene);
    if (dispose) {
      scene.dispose();
    }
  }

  public async init(initialEnvId: EnvironmentId = 'corporate'): Promise<IEnvironmentScene> {
    const scene = this.environments.get(initialEnvId);
    if (!scene) {
      throw new Error(`[EnvironmentManager] Environment "${initialEnvId}" not registered.`);
    }

    if (scene.group.children.length === 0) {
      await scene.build();
    }

    this.mount(scene);
    this.activeEnvironmentId = initialEnvId;
    this.activeScene = scene;

    return this.activeScene;
  }

  /**
   * Switches the active 3D environment scene without reloading the page.
   */
  public async switchEnvironment(
    targetEnvId: EnvironmentId,
    disposeOld: boolean = false
  ): Promise<IEnvironmentScene> {
    if (this.isTransitioning) {
      console.warn(`[EnvironmentManager] Transition already in progress, ignoring switch request.`);
      return this.activeScene;
    }

    if (this.activeEnvironmentId === targetEnvId && this.activeScene) {
      console.log(`[EnvironmentManager] Already in environment: ${targetEnvId}`);
      return this.activeScene;
    }

    const nextScene = this.environments.get(targetEnvId);
    if (!nextScene) {
      throw new Error(`[EnvironmentManager] Target environment "${targetEnvId}" not registered.`);
    }

    this.isTransitioning = true;

    try {
      // 1. Unmount active scene
      if (this.activeScene) {
        this.unmount(this.activeScene, disposeOld);
      }

      // 2. Build incoming scene if needed
      if (nextScene.group.children.length === 0) {
        await nextScene.build();
      }

      // 3. Mount incoming scene
      this.mount(nextScene);
      this.activeEnvironmentId = targetEnvId;
      this.activeScene = nextScene;

      // 4. Notify listeners
      this.listeners.forEach(fn => fn(targetEnvId, nextScene));

      console.log(`[EnvironmentManager] Successfully switched to: ${nextScene.name} (${targetEnvId})`);
      return this.activeScene;
    } finally {
      this.isTransitioning = false;
    }
  }

  public update(delta: number, time: number): void {
    if (this.activeScene) {
      this.activeScene.update(delta, time);
    }
  }

  public onEnvironmentChange(callback: (envId: EnvironmentId, scene: IEnvironmentScene) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  public dispose(): void {
    for (const [_, scene] of this.environments) {
      scene.dispose();
    }
    this.environments.clear();
  }
}
