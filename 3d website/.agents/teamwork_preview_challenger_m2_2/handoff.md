# Milestone 2 Empirical Challenger Report (Challenger 2)

## 1. Observation

Direct empirical observations from source analysis, Playwright automated testing, and isolated stress testing (`tests/stress_test_m2_challenger2.cjs` and `tests/isolated_orbit_sync_test.cjs`):

### Observation 1.1: Teleport Destination Coordinates & Obstacle Clearance
Teleport landing coordinates across all functional zones were evaluated against all 36+ active AABB obstacles and outer boundary walls ($X \in [-19.5, 19.5], Z \in [-12.5, 12.5]$):
- **Reception** (`pos = (-7.00, 1.60, 9.50)`): Minimum clearance to closest obstacle (`Structural Column col_5`) is **142.3 cm** (player radius = 35 cm, margin = 107.3 cm). Inside zone bounds.
- **Workstations** (`pos = (-7.00, 1.60, -1.00)`): Minimum clearance to closest obstacle (`Workstation Quad Pod`) is **171.2 cm** (margin = 136.2 cm). Inside zone bounds.
- **Conference** (`pos = (12.00, 1.60, -1.50)`): Minimum clearance to closest obstacle (`Conference South Glass Wall`) is **55.0 cm** (margin = 20.0 cm). Inside zone bounds.
- **Lounge** (`pos = (8.00, 1.60, 5.00)`): Minimum clearance to closest obstacle (`Lounge Velvet Chaise Return`) is **105.0 cm** (margin = 70.0 cm). Inside zone bounds.
- **Entrance** (`pos = (0.00, 1.60, 11.50)`): Minimum clearance to closest obstacle (`Welcome Kiosk`) is **224.4 cm** (margin = 189.4 cm). Inside zone bounds.
All 5 spawn positions are verified safe, collision-free, and accurately trigger their respective `onZoneChange` events.

### Observation 1.2: Rapid Mode Switching & Re-entrancy
- 100 rapid mode toggles between `'fps'` and `'orbit'` were executed at microsecond-to-millisecond intervals during active parabolic arc transition flights.
- Results: **0 NaN values**, **0 Infinity values**, **0 quaternion singularities**.
- Camera reparenting resolved cleanly into `fpsController.pitchObject` with local position `(0, 0, 0)` upon returning to FPS mode.

### Observation 1.3: Orbit Controller Boundary Constraints under Pointer / Wheel Inputs
- **Zoom limits**: Min distance reached = **4.00 m** (`minDistance = 4.0`), Max distance reached = **55.00 m** (`maxDistance = 55.0`).
- **Pan limits**: Panning is constrained within bounding box $X \in [-22.0, 22.0]$, $Z \in [-15.0, 15.0]$, $Y \in [0.0, 3.0]$. Clamped corners reached `(22.0, 15.0)` and `(-22.0, -15.0)`.
- **Pointer Polar Clamping**: Under 1,000 extreme pointer input delta impulses, `targetPolarAngle` remained bounded within $[0.1500, 1.4280]$ rad.

### Observation 1.4: Polar Angle and Distance Boundary Breach on Immediate Mode Switch & `syncFromCamera()`
In `src/navigation/OrbitController.ts` lines 248–266:
```typescript
public syncFromCamera(): void {
  if (!this.camera) return;

  const offset = this._scratchVec.subVectors(this.camera.position, this.target);
  this.distance = offset.length();
  this.targetDistance = this.distance;

  if (this.distance > 0.001) {
    this.polarAngle = Math.acos(Math.max(-1, Math.min(1, offset.y / this.distance)));
    this.azimuthalAngle = Math.atan2(offset.x, offset.z);
  } else {
    this.polarAngle = Math.PI / 4;
    this.azimuthalAngle = 0;
  }
  this.targetPolarAngle = this.polarAngle;
  this.targetAzimuthalAngle = this.azimuthalAngle;
  this.targetLookAt.copy(this.target);
}
```
And in `src/navigation/NavigationManager.ts` lines 321–339 (`endTransitionImmediate`):
```typescript
private endTransitionImmediate(targetMode: 'fps' | 'orbit'): void {
  this.transition.isActive = false;
  this.mode = targetMode;

  if (targetMode === 'fps') {
    this.orbitController.setEnabled(false);
    this.fpsController.pitchObject.add(this.camera);
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);
    const zone = OFFICE_ZONES[this.currentZoneId] || OFFICE_ZONES.entrance;
    this.fpsController.setPosition(zone.spawnPosition, zone.spawnYaw);
    this.fpsController.setEnabled(true);
  } else {
    this.fpsController.setEnabled(false);
    this.scene.add(this.camera);
    this.orbitController.setEnabled(true);
    this.orbitController.syncFromCamera();
  }

  if (this.onModeChange) this.onModeChange(targetMode);
}
```
Empirical output from running `tests/isolated_orbit_sync_test.cjs`:
```json
{
  "initialMode": "fps",
  "afterImmediateSwitch": {
    "mode": "orbit",
    "cameraPos": { "x": 0, "y": 0, "z": 0 },
    "polarAngle": 3.141592653589793,
    "polarAngleDeg": 180,
    "distance": 1.2,
    "targetDistance": 1.2,
    "minPolarAngle": 0.15,
    "maxPolarAngle": 1.427996660722633,
    "minDistance": 4,
    "maxDistance": 55,
    "isPolarInverted": true,
    "isDistanceViolated": true
  }
}
```

---

## 2. Logic Chain

1. **Premise 1 (Hierarchy & Coordinates)**: In FPS mode, `camera` is a child of `fpsController.pitchObject` with local position `(0, 0, 0)`.
2. **Premise 2 (Immediate Transition Flaw)**: When an instant mode switch to Orbit is triggered (`navigationManager.setMode('orbit', false)` or `endTransitionImmediate('orbit')`), `this.scene.add(this.camera)` is executed without transforming the camera to world space or setting its default overview coordinates. As a result, the camera's world coordinates become `(0, 0, 0)`.
3. **Premise 3 (Target Vector)**: OrbitController target is initialized at `(0, 1.2, 0)`.
4. **Premise 4 (Unclamped Sync)**: `syncFromCamera()` computes `offset = camera.position - target = (0, -1.2, 0)`. `offset.y / distance = -1.2 / 1.2 = -1.0`. `Math.acos(-1.0)` computes `polarAngle = Math.PI` ($180^\circ$), pointing straight up from below the floor.
5. **Premise 5 (Lack of Invariant Enforcement)**: `syncFromCamera()` does not clamp `polarAngle` to `[minPolarAngle, maxPolarAngle]` (`[0.15, 1.428]`), nor does it clamp `distance` to `[minDistance, maxDistance]` (`[4.0, 55.0]`).
6. **Inference**: The camera in Orbit mode enters an inverted state under the floor ($180^\circ$ elevation vs max allowable $81.8^\circ$, and distance $1.2\text{m} < 4.0\text{m}$).

---

## 3. Caveats

- In smooth mode transitions (`setMode('orbit', true)`), `startParabolicTransition` explicitly calculates `endPos` and positions the camera at the elevated isometric overview point prior to calling `syncFromCamera()`, so the smooth transition path does not trigger this inversion.
- The issue is isolated to instant mode switching (`smooth: false`), immediate cancellation of transitions, or cases where `syncFromCamera()` is called when the camera is below the lookAt target.

---

## 4. Conclusion

**Verdict: REQUEST_CHANGES**

While Milestone 2 exhibits excellent sliding collision physics, rock-solid teleport clearances (> 55 cm everywhere), and robust numerical stability under rapid mode switching, a boundary enforcement vulnerability was discovered and empirically proven in `OrbitController.syncFromCamera()` and `NavigationManager.endTransitionImmediate('orbit')`.

### Required Fixes for Implementer:
1. **In `src/navigation/OrbitController.ts` (`syncFromCamera`)**:
   Enforce boundary clamping on computed spherical coordinates:
   ```typescript
   this.polarAngle = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this.polarAngle));
   this.targetPolarAngle = this.polarAngle;
   this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
   this.targetDistance = this.distance;
   ```
2. **In `src/navigation/NavigationManager.ts` (`endTransitionImmediate`)**:
   When switching immediately to `'orbit'`, set default isometric overview view if transitioning from FPS:
   ```typescript
   } else {
     this.fpsController.setEnabled(false);
     this.scene.add(this.camera);
     this.orbitController.setEnabled(true);
     this.orbitController.setOrbitView(28.0, Math.PI / 3.8, 0.0, true);
   }
   ```

---

## 5. Verification Method

To independently reproduce and verify the findings:
1. Run the targeted isolation test:
   ```powershell
   node tests/isolated_orbit_sync_test.cjs
   ```
   **Expected before fix**: `polarAngle = 3.14159` ($180^\circ$), `isPolarInverted: true`.
   **Expected after fix**: `polarAngle <= 1.428` ($81.8^\circ$), `isPolarInverted: false`.

2. Run the complete adversarial stress harness:
   ```powershell
   node tests/stress_test_m2_challenger2.cjs
   ```
   **Expected after fix**: 7 / 7 test suites passing with 0 errors.
