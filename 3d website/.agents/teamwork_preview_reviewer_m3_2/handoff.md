# Milestone 3 Code Review & Adversarial Analysis Report

**Subagent**: `teamwork_preview_reviewer_m3_2` (Reviewer & Critic)  
**Target Milestone**: Milestone 3 — Interactive Objects, Dynamic Displays & Procedural Web Audio  
**Verdict**: **REQUEST_CHANGES**

---

## 1. Observation

Direct code inspections of Milestone 3 deliverables revealed the following specific findings:

### Finding 1: Sliding Door Collision Desynchronization (CRITICAL)
- **Files**:
  - `src/interaction/InteractiveProps.ts:438-445`
  - `src/scene/OfficeFloorplan.ts:429-434`
  - `src/navigation/CollisionEngine.ts:51-56`
  - `src/main.ts:38-42`
- **Verbatim Code**:
  - In `src/interaction/InteractiveProps.ts`:
    ```typescript
    public toggleDoor(): void {
      this.isDoorOpen = !this.isDoorOpen;
      this.doorTargetZ = this.isDoorOpen ? this.doorOpenZ : this.doorClosedZ;
      this.audioManager.playDoorSound(this.isDoorOpen);

      // Update collision obstacle state
      this.floorplan.setDoorState('conf_door_sliding', this.isDoorOpen);
    }
    ```
  - In `src/scene/OfficeFloorplan.ts`:
    ```typescript
    public setDoorState(doorId: string, isOpen: boolean): void {
      const obstacle = this.obstacles.find(o => o.id === doorId);
      if (obstacle) {
        obstacle.isOpen = isOpen;
      }
    }
    ```
  - In `src/main.ts`:
    ```typescript
    const obstacles = floorplan.getObstacles();
    for (const obs of obstacles) {
      navigationManager.addObstacle(obs.box, obs.name, obs.id, obs.isDoor);
    }
    ```
  - In `src/navigation/CollisionEngine.ts`:
    ```typescript
    public addObstacle(box: THREE.Box3, name = 'obstacle', id?: string, isDoor = false): void {
      this.obstacles.push({
        id: id || `obstacle_${this.obstacles.length + 1}`,
        name,
        min: box.min.clone(),
        max: box.max.clone(),
        isDoor,
        isOpen: false
      });
    }
    ```
- **Observed Behavior**: `CollisionEngine.obstacles` maintains its own distinct copy of obstacle objects created during `main.ts` bootstrap. When `InteractiveProps.toggleDoor()` runs, it ONLY updates `floorplan.obstacles`. It never invokes `collisionEngine.setDoorOpen('conf_door_sliding', isDoorOpen)`. Consequently, `collisionEngine.obstacles.find(o => o.id === 'conf_door_sliding').isOpen` remains `false`.

### Finding 2: Shared Singleton Material Emissive Mutation (MAJOR)
- **Files**:
  - `src/interaction/InteractionManager.ts:184-214`
  - `src/scene/OfficeFloorplan.ts:575-608, 830-860`
- **Verbatim Code**:
  - In `src/interaction/InteractionManager.ts`:
    ```typescript
    private applyHoverHighlight(object: THREE.Object3D): void {
      object.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
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
    ```
- **Observed Behavior**: When hovering composite groups such as `reception_desk` (`recDeskGroup`) or `conf_speaker_puck` (`tableGroup`), meshes within those groups reference shared singleton material instances from `Materials.getInstance()` (e.g. `materials.marbleCalacatta`, `materials.woodOak`, `materials.woodWalnut`). Mutating `mesh.material.emissive` to cyan directly modifies the shared singleton instance, causing all unrelated objects across the entire floorplan sharing those materials (kitchen island counters, coffee tables, structural columns) to also pulse cyan.

### Finding 3: Target Group Oversizing for `conf_speaker_puck` (MAJOR)
- **Files**:
  - `src/scene/OfficeFloorplan.ts:830-860`
  - `src/interaction/InteractiveProps.ts:338-356`
- **Verbatim Code**:
  - In `src/scene/OfficeFloorplan.ts`:
    ```typescript
    const tableGroup = new THREE.Group();
    tableGroup.position.set(12.0, 0, -6.0);
    // ...
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.04, 16), this.materials.metalBlackMatte);
    // ...
    this.group.add(tableGroup);
    this.confPuckGroup = tableGroup;
    this.confPuckLED = puckLED;
    ```
- **Observed Behavior**: `this.confPuckGroup` is assigned to `tableGroup` (the entire 7.2m conference table) instead of a dedicated sub-group for the puck. Consequently, clicking or raycasting anywhere on the conference table triggers the conference puck mute action.

### Finding 4: UI DOM PointerDown Event Contamination (MAJOR)
- **Files**:
  - `src/interaction/InteractionManager.ts:62-67`
- **Verbatim Code**:
  - In `src/interaction/InteractionManager.ts`:
    ```typescript
    window.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && this.activeInteractable) {
        this.triggerPrimaryAction();
      }
    });
    ```
- **Observed Behavior**: `pointerdown` does not check whether `e.target` is an interactive 2D HUD DOM element (e.g. settings buttons, teleport buttons, modal dialogs). Clicking any HUD button while an interactable is in the background reticle fires `triggerPrimaryAction()`.

---

## 2. Logic Chain

1. **Sliding Door Physics Failure**:
   - `InteractiveProps.toggleDoor()` is called upon user interaction or automated test trigger.
   - `floorplan.setDoorState()` modifies `floorplan.obstacles['conf_door_sliding'].isOpen = true`.
   - `NavigationManager.collisionEngine.obstacles['conf_door_sliding'].isOpen` remains `false`.
   - In FPS movement mode, `CollisionEngine._resolveSingleStep` evaluates `obs.isOpen`. Since `obs.isOpen` is `false`, the collision resolver treats the door as an impassable barrier.
   - The player cannot walk through the opened doorway into the conference room.
   - Automated E2E verification test `tests/m3_interaction_audio_test.cjs` Test 5 explicitly asserts `col.obstacles.find(o => o.id === 'conf_door_sliding').isOpen === true`, which fails.

2. **Visual Material Leaking**:
   - Three.js material instances are reference objects shared across all meshes using them.
   - `InteractionManager` modifies the `emissive` color and `emissiveIntensity` properties directly on `mesh.material`.
   - Any mesh in the scene using `materials.marbleCalacatta` or `materials.woodOak` shares that exact instance.
   - Hovering over the reception desk counter illuminates all marble surfaces in Zone 4 (Lounge island counter, coffee tables) with cyan emissive glow.

3. **Input Handling & HUD Usability**:
   - Unfiltered global `pointerdown` triggers 3D interaction logic even when the user clicks 2D UI controls.
   - Clicking "Settings" or "Orbit View" while aiming near a screen or coffee machine triggers the appliance.

---

## 3. Caveats

- Procedural Web Audio API synthesizer (`AudioManager.ts`) is well-designed with zero external network dependencies, effective node scheduling, and clean lifecycle management.
- Dynamic 2D Canvas Screen engine (`DynamicScreens.ts`) correctly implements 15-20 FPS throttling with `generateMipmaps = false`, meeting the 60 FPS WebGL frame budget.
- Automation debug contract `window.__OFFICE_DEBUG__` exposes required query and trigger endpoints.
- No evidence of hardcoded cheats or facade shortcuts was detected (integrity verified).

---

## 4. Conclusion

**Verdict**: **REQUEST_CHANGES**

Milestone 3 cannot be approved in its current state due to the critical desynchronization of the sliding door collision state, which blocks physical room traversal in first-person mode and fails automated verification, alongside the major issues with shared material emissive leaking, puck hitbox over-extension, and HUD pointerdown interference.

### Required Actions for Approval:
1. **Fix Door Collision Sync**:
   - In `InteractiveProps.ts` (or via callback in `main.ts`), ensure toggling the door updates `navigationManager.collisionEngine.setDoorOpen('conf_door_sliding', isDoorOpen)`.
2. **Fix Emissive Highlighting Isolation**:
   - In `InteractionManager.ts` / `InteractiveProps.ts`, ensure only unique mesh materials are modified, or clone materials for interactive components so shared singleton materials do not glow globally.
3. **Fix Puck Group**:
   - In `OfficeFloorplan.ts`, isolate `confPuckGroup` to only contain the puck and LED ring (`new THREE.Group().add(puck, puckLED)`).
4. **Filter HUD PointerDown**:
   - In `InteractionManager.ts`, guard `pointerdown` with `if ((e.target as HTMLElement).closest('#hud-container, .modal, .drawer, #settings-drawer, #help-modal, #overlay-start, button, .teleport-btn')) return;`.

---

## 5. Verification Method

To independently verify after remediation:
1. Run `npm run build` to confirm TypeScript compilation.
2. Run `node tests/m3_interaction_audio_test.cjs` and verify all 7 test suites pass, specifically:
   - Test 5: Sliding Door Animation & Obstacle Sync (`isOpenAfter === true` on `col.obstacles`).
   - Test 6: Raycasting & Hover Reticle Feedback.
3. Manual verification in browser:
   - Walk up to Conference sliding glass door in FPS mode, press `[E]` to open, and walk through doorway into conference room without collision jamming.
   - Hover over reception desk and confirm lounge kitchenette counters do not turn cyan.
