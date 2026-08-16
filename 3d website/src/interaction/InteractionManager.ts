import * as THREE from 'three';
import {
  IInteractionManager,
  IInteractable,
  NavigationMode
} from '../types';

export class InteractionManager implements IInteractionManager {
  private interactables: Map<string, IInteractable> = new Map();
  private raycaster: THREE.Raycaster;
  private activeInteractable: IInteractable | null = null;
  private hoveredMesh: THREE.Object3D | null = null;

  // Emissive highlight cache
  private originalEmissive: Map<THREE.Mesh, { color: THREE.Color; intensity: number }> = new Map();
  private clonedMeshes: Set<THREE.Mesh> = new Set();
  private pulseTime: number = 0;

  // DOM elements cache
  private reticleElement: HTMLElement | null = null;
  private promptElement: HTMLElement | null = null;
  private promptTextElement: HTMLElement | null = null;

  // Mouse NDC coordinates for Orbit mode raycasting
  private mouseNDC: THREE.Vector2 = new THREE.Vector2(0, 0);

  constructor() {
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 50.0; // Max raycast length

    this.cacheDOMElements();
    this.setupInputListeners();
  }

  private cacheDOMElements(): void {
    if (typeof document !== 'undefined') {
      this.reticleElement = document.getElementById('reticle');
      this.promptElement = document.getElementById('interaction-prompt');
      this.promptTextElement = document.getElementById('prompt-action-text');
    }
  }

  private setupInputListeners(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('mousemove', (e) => {
      this.mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === 'e' || e.key === 'E' || e.key === ' ') {
        if (this.activeInteractable) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.triggerPrimaryAction();
        }
      }
    });

    window.addEventListener('pointerdown', (e) => {
      if (e.target instanceof HTMLElement) {
        if (e.target.closest('#hud-container, .modal, .drawer, #settings-drawer, #help-modal, #overlay-start, button, .teleport-btn, .settings-toggle, .hotkey-hint')) {
          return;
        }
      }
      if (e.button === 0 && this.activeInteractable) {
        // Left click on active interactable
        this.triggerPrimaryAction();
      }
    });
  }

  public register(interactable: IInteractable): void {
    this.interactables.set(interactable.id, interactable);
  }

  public unregister(id: string): void {
    const interactable = this.interactables.get(id);
    if (interactable && this.activeInteractable === interactable) {
      this.clearHoverState();
    }
    this.interactables.delete(id);
  }

  public getActiveInteractable(): IInteractable | null {
    return this.activeInteractable;
  }

  public getInteractables(): IInteractable[] {
    return Array.from(this.interactables.values());
  }

  public getInteractableIds(): string[] {
    return Array.from(this.interactables.keys());
  }

  public triggerAction(id: string): boolean {
    const interactable = this.interactables.get(id);
    if (interactable) {
      if (interactable.onInteract) {
        interactable.onInteract();
      }
      return true;
    }
    return false;
  }

  public triggerPrimaryAction(): void {
    if (this.activeInteractable && this.activeInteractable.onInteract) {
      this.activeInteractable.onInteract();
    }
  }

  public update(camera: THREE.Camera, mode: NavigationMode, mouseCoords?: THREE.Vector2): void {
    this.pulseTime += 0.016;

    if (mode === 'transitioning') {
      this.clearHoverState();
      return;
    }

    // Determine ray origin & direction
    if (mode === 'fps') {
      // Cast from camera center in FPS walkthrough mode
      this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    } else {
      // Cast from mouse pointer in Orbit overview mode
      const coords = mouseCoords || this.mouseNDC;
      this.raycaster.setFromCamera(coords, camera);
    }

    // Collect all candidate target meshes
    const targetObjects: THREE.Object3D[] = [];
    const objectToInteractable: Map<THREE.Object3D, IInteractable> = new Map();

    this.interactables.forEach((interactable) => {
      if (interactable.mesh && interactable.mesh.visible) {
        targetObjects.push(interactable.mesh);
        interactable.mesh.traverse((child) => {
          objectToInteractable.set(child, interactable);
        });
      }
    });

    const intersections = this.raycaster.intersectObjects(targetObjects, true);

    let nearestInteractable: IInteractable | null = null;
    let hitMesh: THREE.Object3D | null = null;

    for (let i = 0; i < intersections.length; i++) {
      const hit = intersections[i];
      const interactable = objectToInteractable.get(hit.object);
      if (interactable) {
        const maxDist = mode === 'fps' ? (interactable.distanceCutoff ?? 5.0) : 40.0;
        if (hit.distance <= maxDist) {
          nearestInteractable = interactable;
          hitMesh = hit.object;
          break;
        }
      }
    }

    if (nearestInteractable !== this.activeInteractable) {
      this.clearHoverState();

      if (nearestInteractable) {
        this.activeInteractable = nearestInteractable;
        this.hoveredMesh = hitMesh;

        if (this.activeInteractable.onHover) {
          this.activeInteractable.onHover(true);
        }

        this.applyHoverHighlight(this.activeInteractable.mesh);
        this.updateHUD(true, this.activeInteractable.prompt);
      } else {
        this.updateHUD(false);
      }
    }

    // Animate emissive pulse on hovered mesh
    if (this.activeInteractable) {
      this.pulseHoverHighlight();
    }
  }

  private applyHoverHighlight(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        if (child.userData.disablePulse) return; // Skip highlight for this mesh

        if (Array.isArray(child.material)) {
          child.material = child.material.map(m => m.clone());
        } else if (!this.clonedMeshes.has(child)) {
          child.material = child.material.clone();
          this.clonedMeshes.add(child);
        }

        const mat = child.material;
        if (mat instanceof THREE.MeshStandardMaterial) {
          if (!this.originalEmissive.has(child)) {
            this.originalEmissive.set(child, {
              color: mat.emissive.clone(),
              intensity: mat.emissiveIntensity
            });
          }
        }
      }
    });
  }

  private pulseHoverHighlight(): void {
    const pulseFactor = 0.5 + 0.5 * Math.sin(this.pulseTime * 8);
    this.originalEmissive.forEach((orig, mesh) => {
      if (mesh.material instanceof THREE.MeshStandardMaterial) {
        const baseColor = orig.color.clone();
        if (baseColor.r === 0 && baseColor.g === 0 && baseColor.b === 0) {
          // If material has no default emissive color, illuminate with cyan highlight
          mesh.material.emissive.setHex(0x38bdf8);
          mesh.material.emissiveIntensity = 0.2 + pulseFactor * 0.4;
        } else {
          mesh.material.emissiveIntensity = orig.intensity * (1.0 + pulseFactor * 0.5);
        }
      }
    });
  }

  private clearHoverState(): void {
    if (this.activeInteractable) {
      if (this.activeInteractable.onHover) {
        this.activeInteractable.onHover(false);
      }

      // Restore original emissive material properties
      this.originalEmissive.forEach((orig, mesh) => {
        if (mesh.material instanceof THREE.MeshStandardMaterial) {
          mesh.material.emissive.copy(orig.color);
          mesh.material.emissiveIntensity = orig.intensity;
        }
      });
      this.originalEmissive.clear();

      this.activeInteractable = null;
      this.hoveredMesh = null;
      this.updateHUD(false);
    }
  }

  private updateHUD(isHovered: boolean, promptText?: string): void {
    if (!this.reticleElement) this.cacheDOMElements();

    if (this.reticleElement) {
      if (isHovered) {
        this.reticleElement.classList.add('reticle-hover');
      } else {
        this.reticleElement.classList.remove('reticle-hover');
      }
    }

    if (this.promptElement && this.promptTextElement) {
      if (isHovered && promptText) {
        this.promptTextElement.textContent = promptText;
        this.promptElement.classList.remove('hidden');
      } else {
        this.promptElement.classList.add('hidden');
      }
    }
  }
}
