import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EmotionEngine, MascotState } from './EmotionEngine';
import { HVACDataStore } from '../data/HVACDataStore';

export class MascotManager {
  private scene: THREE.Scene;
  private emotionEngine: EmotionEngine;
  
  private loader: GLTFLoader;
  private mascotGroup: THREE.Group;
  private loadedModels: Map<MascotState, THREE.Group> = new Map();
  private currentModel: THREE.Group | null = null;
  private currentState: MascotState | null = null;
  
  private targetScale = new THREE.Vector3(1.2, 1.2, 1.2);
  private transitionSpeed = 4.0;
  private fadingOutModels: THREE.Group[] = [];
  private floatingTime = 0;
  
  private loadingState: MascotState | null = null;

  constructor(scene: THREE.Scene, hvacStore: HVACDataStore) {
    this.scene = scene;
    this.emotionEngine = new EmotionEngine(hvacStore);
    this.loader = new GLTFLoader();
    this.mascotGroup = new THREE.Group();
    
    // Position Luma in the lobby, visible upon spawn
    this.mascotGroup.position.set(0, 1.0, 7.5);
    // Face the entrance/lobby area
    this.mascotGroup.rotation.y = Math.PI; 
    
    this.scene.add(this.mascotGroup);
    
    // Setup gentle spotlight for the mascot
    const spotLight = new THREE.SpotLight(0xffffff, 2.0);
    spotLight.position.set(0, 3, 6);
    spotLight.target = this.mascotGroup;
    spotLight.angle = 0.6;
    spotLight.penumbra = 0.6;
    this.scene.add(spotLight);

    // Listen to NLP events from ChatManager
    document.addEventListener('nlp-complaint-applied', (e: any) => {
      if (e.detail) {
        const intent = e.detail.intent || '';
        const reasoning = e.detail.reasoning || '';
        this.emotionEngine.handleUserComplaint(intent, reasoning);
      }
    });

    document.addEventListener('mascot-set-state', (e: any) => {
      if (e.detail && e.detail.state) {
        this.emotionEngine.setTemporaryState(e.detail.state as MascotState, e.detail.duration || 5.0);
      }
    });

    // Expose debug mechanism
    (window as any).testMascotState = (state: MascotState) => {
      this.emotionEngine.setTemporaryState(state, 10.0);
      console.log(`[Mascot Debug] Forcing state: ${state} for 10s`);
    };
  }
  
  private async loadModel(state: MascotState): Promise<THREE.Group | null> {
    if (this.loadedModels.has(state)) {
      return this.loadedModels.get(state)!;
    }
    
    try {
      const url = `/mascots/${state}`;
      const gltf = await this.loader.loadAsync(url);
      const model = gltf.scene;
      
      // Standardize scale and shadows
      model.scale.set(0, 0, 0); // Start at 0 for scale transition
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      
      this.loadedModels.set(state, model);
      return model;
    } catch (e) {
      console.error(`Failed to load mascot GLB: ${state}`, e);
      return null;
    }
  }

  public update(delta: number): void {
    const nextState = this.emotionEngine.update(delta);
    
    if (nextState !== this.currentState && this.loadingState !== nextState) {
      this.loadingState = nextState;
      this.loadModel(nextState).then(newModel => {
        if (this.loadingState !== nextState) return; // Superceded by another state change
        this.currentState = nextState;
        this.loadingState = null;
        
        if (newModel && newModel !== this.currentModel) {
          // Prepare cross-transition
          if (this.currentModel) {
            this.fadingOutModels.push(this.currentModel);
          }
          
          this.currentModel = newModel;
          newModel.scale.set(0, 0, 0); // start small
          if (!this.mascotGroup.children.includes(newModel)) {
             this.mascotGroup.add(newModel);
          }
        }
      });
    }
    
    // Idle animation: floating gently
    this.floatingTime += delta;
    this.mascotGroup.position.y = 1.0 + Math.sin(this.floatingTime * 1.5) * 0.08;
    this.mascotGroup.rotation.y = Math.PI + Math.sin(this.floatingTime * 0.5) * 0.1;
    
    // Handle Scale transitions for smooth swapping without flickering
    if (this.currentModel) {
      this.currentModel.scale.lerp(this.targetScale, delta * this.transitionSpeed);
    }
    
    for (let i = this.fadingOutModels.length - 1; i >= 0; i--) {
      const model = this.fadingOutModels[i];
      model.scale.lerp(new THREE.Vector3(0, 0, 0), delta * (this.transitionSpeed * 1.5));
      if (model.scale.length() < 0.05) {
        this.mascotGroup.remove(model);
        this.fadingOutModels.splice(i, 1);
      }
    }
  }

  public setPosition(pos: THREE.Vector3): void {
    this.mascotGroup.position.set(pos.x, pos.y, pos.z);
  }
}

