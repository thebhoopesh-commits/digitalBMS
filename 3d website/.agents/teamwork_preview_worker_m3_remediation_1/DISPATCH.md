# Subagent Assignment: Worker M3 Remediation

## Identity
- Role: Implementation Worker
- Working Directory: C:\Users\thebh\.gemini\antigravity\scratch\corporate_office_3d\.agents\teamwork_preview_worker_m3_remediation_1

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A forensic auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Task
Fix the 4 issues identified during Milestone 3 Review and Adversarial Testing:

1. **Sliding Door Collision Synchronization**:
   - In `src/navigation/CollisionEngine.ts`: Ensure `setDoorOpen(id: string, isOpen: boolean)` updates `this.obstacles.find(o => o.id === id).isOpen`.
   - In `src/interaction/InteractiveProps.ts` & `src/main.ts`: Ensure `InteractiveProps.toggleDoor()` directly updates the collision engine's obstacle state via `navigationManager.collisionEngine.setDoorOpen('conf_door_sliding', this.isDoorOpen)` (or via a clean callback).
   
2. **Emissive Highlighting Material Isolation**:
   - In `src/interaction/InteractionManager.ts`: When highlighting an interactable, ensure modifying `mesh.material.emissive` does not mutate shared singleton materials from `Materials.getInstance()`. Either clone the material per interactive mesh upon first highlight / setup, or manage unique material instances for interactables. Ensure proper cleanup on un-hover.

3. **Conference Puck Hitbox Isolation**:
   - In `src/scene/OfficeFloorplan.ts`: Isolate `this.confPuckGroup` into a dedicated `THREE.Group` that contains ONLY the puck and its LED ring (`puck` and `puckLED`), rather than assigning `this.confPuckGroup = tableGroup` (which made the entire 7.2m conference table trigger the puck).

4. **HUD PointerDown Event Filtering**:
   - In `src/interaction/InteractionManager.ts`: Guard the `pointerdown` listener to ignore clicks when `(e.target as HTMLElement).closest('#hud-container, .modal, .drawer, #settings-drawer, #help-modal, #overlay-start, button, .teleport-btn, .settings-toggle, .hotkey-hint')` is clicked.

5. **Build and Test Verification**:
   - Run `npm run build`
   - Run `node tests/m3_interaction_audio_test.cjs`
   - Run `node tests/stress_test_m3_challenger1.cjs`
   - Run `node tests/stress_test_m3_challenger2.mjs`

## Output
Write your handoff report to `C:\Users\thebh\.gemini\antigravity\scratch\corporate_office_3d\.agents\teamwork_preview_worker_m3_remediation_1\handoff.md` and send a message when complete.
