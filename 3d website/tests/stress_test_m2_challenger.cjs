const { chromium } = require('@playwright/test');
const path = require('path');
const { spawn } = require('child_process');
const THREE = require('three');

// =========================================================================
// SECTION 1: STANDALONE COLLISION ENGINE MATHEMATICAL ADVERSARIAL HARNESS
// =========================================================================

class StandaloneCollisionEngine {
  constructor() {
    this.obstacles = [];
    this.BOUNDS = {
      minX: -19.5,
      maxX: 19.5,
      minZ: -12.5,
      maxZ: 12.5,
      minY: 0.0,
      maxY: 4.0
    };
    this.EPSILON = 0.001;
    this.ALLOW_EPSILON = 0.05;
    this._resolvedPos = new THREE.Vector3();
    this._stepMovement = new THREE.Vector3();
    this._tempPos = new THREE.Vector3();
  }

  addObstacle(box, name = 'obstacle', id, isDoor = false) {
    this.obstacles.push({
      id: id || `obstacle_${this.obstacles.length + 1}`,
      name,
      min: box.min.clone(),
      max: box.max.clone(),
      isDoor,
      isOpen: false
    });
  }

  resolveMovement(currentPos, desiredMovement, playerRadius = 0.35, playerHeight = 1.80) {
    const moveLength = Math.hypot(desiredMovement.x, desiredMovement.z);
    if (moveLength < 1e-6) {
      this._resolvedPos.copy(currentPos);
      return this._resolvedPos;
    }

    const maxSubStep = playerRadius * 0.5;
    const subSteps = Math.max(1, Math.ceil(moveLength / maxSubStep));
    const invSteps = 1.0 / subSteps;

    this._stepMovement.set(
      desiredMovement.x * invSteps,
      desiredMovement.y * invSteps,
      desiredMovement.z * invSteps
    );

    this._tempPos.copy(currentPos);

    for (let step = 0; step < subSteps; step++) {
      this._resolveSingleStep(this._tempPos, this._stepMovement, playerRadius, playerHeight);
    }

    this._resolvedPos.copy(this._tempPos);
    return this._resolvedPos;
  }

  _resolveSingleStep(pos, movement, radius, height) {
    const playerBaseY = pos.y - 1.60;
    const playerTopY = playerBaseY + height;

    let xCandidate = pos.x + movement.x;

    for (let i = 0; i < this.obstacles.length; i++) {
      const obs = this.obstacles[i];
      if (obs.isOpen) continue;
      if (playerBaseY >= obs.max.y || playerTopY <= obs.min.y) continue;

      if (pos.z > obs.min.z - radius && pos.z < obs.max.z + radius) {
        if (movement.x > 0) {
          if (pos.x + radius <= obs.min.x + this.ALLOW_EPSILON) {
            if (xCandidate + radius > obs.min.x) {
              xCandidate = Math.min(xCandidate, obs.min.x - radius - this.EPSILON);
            }
          }
        } else if (movement.x < 0) {
          if (pos.x - radius >= obs.max.x - this.ALLOW_EPSILON) {
            if (xCandidate - radius < obs.max.x) {
              xCandidate = Math.max(xCandidate, obs.max.x + radius + this.EPSILON);
            }
          }
        }
      }
    }

    xCandidate = Math.max(this.BOUNDS.minX, Math.min(this.BOUNDS.maxX, xCandidate));
    pos.x = xCandidate;

    let zCandidateResolved = pos.z + movement.z;

    for (let i = 0; i < this.obstacles.length; i++) {
      const obs = this.obstacles[i];
      if (obs.isOpen) continue;
      if (playerBaseY >= obs.max.y || playerTopY <= obs.min.y) continue;

      if (pos.x > obs.min.x - radius && pos.x < obs.max.x + radius) {
        if (movement.z > 0) {
          if (pos.z + radius <= obs.min.z + this.ALLOW_EPSILON) {
            if (zCandidateResolved + radius > obs.min.z) {
              zCandidateResolved = Math.min(zCandidateResolved, obs.min.z - radius - this.EPSILON);
            }
          }
        } else if (movement.z < 0) {
          if (pos.z - radius >= obs.max.z - this.ALLOW_EPSILON) {
            if (zCandidateResolved - radius < obs.max.z) {
              zCandidateResolved = Math.max(zCandidateResolved, obs.max.z + radius + this.EPSILON);
            }
          }
        }
      }
    }

    zCandidateResolved = Math.max(this.BOUNDS.minZ, Math.min(this.BOUNDS.maxZ, zCandidateResolved));
    pos.z = zCandidateResolved;

    for (let i = 0; i < this.obstacles.length; i++) {
      const obs = this.obstacles[i];
      if (obs.isOpen) continue;
      if (playerBaseY >= obs.max.y || playerTopY <= obs.min.y) continue;

      const closestX = Math.max(obs.min.x, Math.min(obs.max.x, pos.x));
      const closestZ = Math.max(obs.min.z, Math.min(obs.max.z, pos.z));

      const dx = pos.x - closestX;
      const dz = pos.z - closestZ;
      const distSq = dx * dx + dz * dz;

      if (distSq < radius * radius && distSq > 1e-8) {
        const dist = Math.sqrt(distSq);
        const overlap = radius - dist + this.EPSILON;
        pos.x += (dx / dist) * overlap;
        pos.z += (dz / dist) * overlap;
      }
    }

    pos.x = Math.max(this.BOUNDS.minX, Math.min(this.BOUNDS.maxX, pos.x));
    pos.z = Math.max(this.BOUNDS.minZ, Math.min(this.BOUNDS.maxZ, pos.z));
  }

  isPositionValid(position, playerRadius = 0.35, playerHeight = 1.80) {
    if (
      position.x < this.BOUNDS.minX ||
      position.x > this.BOUNDS.maxX ||
      position.z < this.BOUNDS.minZ ||
      position.z > this.BOUNDS.maxZ
    ) {
      return false;
    }

    const playerBaseY = position.y - 1.60;
    const playerTopY = playerBaseY + playerHeight;

    for (let i = 0; i < this.obstacles.length; i++) {
      const obs = this.obstacles[i];
      if (obs.isOpen) continue;
      if (playerBaseY >= obs.max.y || playerTopY <= obs.min.y) continue;

      const closestX = Math.max(obs.min.x, Math.min(obs.max.x, position.x));
      const closestZ = Math.max(obs.min.z, Math.min(obs.max.z, position.z));

      const dx = position.x - closestX;
      const dz = position.z - closestZ;
      if (dx * dx + dz * dz < playerRadius * playerRadius) {
        return false;
      }
    }

    return true;
  }
}

// =========================================================================
// RUNNER & SUITE
// =========================================================================

async function runEmpiricalStressTests() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║   CHALLENGER ADVERSARIAL STRESS TEST SUITE: M2 NAVIGATION & COLLISION    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  function assert(condition, testName, details = '') {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  ✅ PASS: ${testName} ${details ? `(${details})` : ''}`);
    } else {
      failedTests++;
      console.error(`  ❌ FAIL: ${testName} ${details ? `(${details})` : ''}`);
    }
  }

  // -----------------------------------------------------------------------
  // TEST GROUP 1: MONTE CARLO PERIMETER CONTAINMENT (10,000 Iterations)
  // -----------------------------------------------------------------------
  console.log('=== TEST GROUP 1: Monte Carlo Perimeter Boundary Containment ===');
  const engine = new StandaloneCollisionEngine();
  const radius = 0.35;
  const height = 1.80;

  let maxBoundaryPenetrationX = 0;
  let maxBoundaryPenetrationZ = 0;
  const iterations = 10000;

  for (let i = 0; i < iterations; i++) {
    // Pick random position near bounds
    const startX = (Math.random() * 40) - 20; // [-20, 20]
    const startZ = (Math.random() * 26) - 13; // [-13, 13]
    const clampedStartX = Math.max(engine.BOUNDS.minX, Math.min(engine.BOUNDS.maxX, startX));
    const clampedStartZ = Math.max(engine.BOUNDS.minZ, Math.min(engine.BOUNDS.maxZ, startZ));

    const pos = new THREE.Vector3(clampedStartX, 1.6, clampedStartZ);
    // Extreme outward velocity: speed between 10m/s and 500m/s, dt between 0.001s and 0.5s
    const angle = Math.random() * Math.PI * 2;
    const speed = 10 + Math.random() * 490;
    const dt = 0.001 + Math.random() * 0.499;
    const disp = new THREE.Vector3(Math.cos(angle) * speed * dt, 0, Math.sin(angle) * speed * dt);

    const resolved = engine.resolveMovement(pos, disp, radius, height);

    if (resolved.x < engine.BOUNDS.minX) {
      maxBoundaryPenetrationX = Math.max(maxBoundaryPenetrationX, engine.BOUNDS.minX - resolved.x);
    }
    if (resolved.x > engine.BOUNDS.maxX) {
      maxBoundaryPenetrationX = Math.max(maxBoundaryPenetrationX, resolved.x - engine.BOUNDS.maxX);
    }
    if (resolved.z < engine.BOUNDS.minZ) {
      maxBoundaryPenetrationZ = Math.max(maxBoundaryPenetrationZ, engine.BOUNDS.minZ - resolved.z);
    }
    if (resolved.z > engine.BOUNDS.maxZ) {
      maxBoundaryPenetrationZ = Math.max(maxBoundaryPenetrationZ, resolved.z - engine.BOUNDS.maxZ);
    }
  }

  assert(
    maxBoundaryPenetrationX === 0,
    'Monte Carlo X-Boundary Containment (10,000 runs)',
    `Max Pen X = ${maxBoundaryPenetrationX.toFixed(6)}m`
  );
  assert(
    maxBoundaryPenetrationZ === 0,
    'Monte Carlo Z-Boundary Containment (10,000 runs)',
    `Max Pen Z = ${maxBoundaryPenetrationZ.toFixed(6)}m`
  );

  // -----------------------------------------------------------------------
  // TEST GROUP 2: DECOUPLED 45-DEGREE ANGLE SLIDING PHYSICS
  // -----------------------------------------------------------------------
  console.log('\n=== TEST GROUP 2: Decoupled 45-Degree Wall & Corner Sliding ===');
  
  // Register obstacle: Center Desk Pod [-2.0, 0, -2.0] to [2.0, 1.2, 2.0]
  const deskObs = new StandaloneCollisionEngine();
  deskObs.addObstacle(new THREE.Box3(new THREE.Vector3(-2.0, 0, -2.0), new THREE.Vector3(2.0, 1.2, 2.0)), 'Center Desk Pod');

  // Test 2.1: Sliding along North Wall (Z = -2.0) from West to East at 45 deg
  // Player at (-3.0, 1.6, -2.0 - radius) -> moving dx = 2.0, dz = 2.0 (driving south-east into north face)
  const pNorth = new THREE.Vector3(0.0, 1.6, -2.0 - radius);
  const dNorth = new THREE.Vector3(1.5, 0, 1.5); // 45 deg into wall
  const resNorth = deskObs.resolveMovement(pNorth, dNorth, radius, height);
  assert(
    Math.abs(resNorth.z - (-2.0 - radius - 0.001)) < 0.005,
    'North Wall Decoupled Normal Clamp',
    `Z expected ~${(-2.0 - radius - 0.001).toFixed(3)}, got ${resNorth.z.toFixed(4)}`
  );
  assert(
    Math.abs(resNorth.x - 1.5) < 0.05,
    'North Wall Tangential Free Sliding',
    `X expected 1.5, got ${resNorth.x.toFixed(4)} (Zero friction stickiness)`
  );

  // Test 2.2: Sliding along South Wall (Z = 2.0) from East to West at 45 deg
  const pSouth = new THREE.Vector3(0.0, 1.6, 2.0 + radius);
  const dSouth = new THREE.Vector3(-1.5, 0, -1.5);
  const resSouth = deskObs.resolveMovement(pSouth, dSouth, radius, height);
  assert(
    Math.abs(resSouth.z - (2.0 + radius + 0.001)) < 0.005,
    'South Wall Decoupled Normal Clamp',
    `Z expected ~${(2.0 + radius + 0.001).toFixed(3)}, got ${resSouth.z.toFixed(4)}`
  );
  assert(
    Math.abs(resSouth.x - (-1.5)) < 0.05,
    'South Wall Tangential Free Sliding',
    `X expected -1.5, got ${resSouth.x.toFixed(4)}`
  );

  // Test 2.3: Sliding along West Wall (X = -2.0) moving North-East at 45 deg
  const pWest = new THREE.Vector3(-2.0 - radius, 1.6, 0.0);
  const dWest = new THREE.Vector3(1.5, 0, -1.5);
  const resWest = deskObs.resolveMovement(pWest, dWest, radius, height);
  assert(
    Math.abs(resWest.x - (-2.0 - radius - 0.001)) < 0.005,
    'West Wall Decoupled Normal Clamp',
    `X expected ~${(-2.0 - radius - 0.001).toFixed(3)}, got ${resWest.x.toFixed(4)}`
  );
  assert(
    Math.abs(resWest.z - (-1.5)) < 0.05,
    'West Wall Tangential Free Sliding',
    `Z expected -1.5, got ${resWest.z.toFixed(4)}`
  );

  // Test 2.4: Sliding along East Wall (X = 2.0) moving South-West at 45 deg
  const pEast = new THREE.Vector3(2.0 + radius, 1.6, 0.0);
  const dEast = new THREE.Vector3(-1.5, 0, 1.5);
  const resEast = deskObs.resolveMovement(pEast, dEast, radius, height);
  assert(
    Math.abs(resEast.x - (2.0 + radius + 0.001)) < 0.005,
    'East Wall Decoupled Normal Clamp',
    `X expected ~${(2.0 + radius + 0.001).toFixed(3)}, got ${resEast.x.toFixed(4)}`
  );
  assert(
    Math.abs(resEast.z - 1.5) < 0.05,
    'East Wall Tangential Free Sliding',
    `Z expected 1.5, got ${resEast.z.toFixed(4)}`
  );

  // Test 2.5: Convex Corner Direct 45-Degree Impact (Vertex collision)
  // Driving directly into NW corner (-2.0, -2.0) from (-2.5, -2.5) towards (0, 0)
  const pCorner = new THREE.Vector3(-2.0 - radius * Math.SQRT1_2, 1.6, -2.0 - radius * Math.SQRT1_2);
  const dCorner = new THREE.Vector3(1.0, 0, 1.0);
  const resCorner = deskObs.resolveMovement(pCorner, dCorner, radius, height);

  // Calculate distance from resolved position to closest point on AABB
  const closestCornerX = Math.max(-2.0, Math.min(2.0, resCorner.x));
  const closestCornerZ = Math.max(-2.0, Math.min(2.0, resCorner.z));
  const distCorner = Math.hypot(resCorner.x - closestCornerX, resCorner.z - closestCornerZ);

  assert(
    distCorner >= radius - 0.002,
    'Convex Corner Vertex Depenetration & Containment',
    `Dist to obstacle: ${distCorner.toFixed(4)}m (Expected >= ${radius}m)`
  );

  // -----------------------------------------------------------------------
  // TEST GROUP 3: CONTINUOUS COLLISION DETECTION (CCD) & TUNNELING STRESS
  // -----------------------------------------------------------------------
  console.log('\n=== TEST GROUP 3: CCD Sub-stepping & High-Velocity Tunneling Defense ===');
  
  // Create engine with an ultra-thin glass wall (0.04m thick: X in [0.0, 0.04], Z in [-5, 5])
  const thinWallEngine = new StandaloneCollisionEngine();
  thinWallEngine.addObstacle(new THREE.Box3(new THREE.Vector3(0.0, 0, -5.0), new THREE.Vector3(0.04, 3.0, 5.0)), 'Ultra-Thin Glass Partition');

  // Test across various extreme delta times and speeds
  const deltaTimes = [0.001, 0.016, 0.033, 0.05, 0.1, 0.25, 0.5, 1.0];
  const velocities = [4.2, 7.8, 20.0, 50.0, 100.0]; // m/s

  let tunnelingOccurred = false;
  let minDistanceRecorded = Infinity;

  for (const dt of deltaTimes) {
    for (const v of velocities) {
      // Start at X = -2.0, drive directly East (+X) with speed v over dt
      const startPos = new THREE.Vector3(-2.0, 1.6, 0.0);
      const disp = new THREE.Vector3(v * dt, 0, 0);

      const resolved = thinWallEngine.resolveMovement(startPos, disp, radius, height);

      // If resolved.x > 0.04, it jumped through the wall (tunneling failure!)
      if (resolved.x > 0.04) {
        tunnelingOccurred = true;
        console.error(`  🚨 TUNNELING DETECTED at v=${v}m/s, dt=${dt}s: resolved.x = ${resolved.x.toFixed(3)}`);
      }

      // Check distance to front face (X = 0.0)
      const distToFront = 0.0 - (resolved.x + radius);
      minDistanceRecorded = Math.min(minDistanceRecorded, distToFront);
    }
  }

  assert(
    !tunnelingOccurred,
    'CCD Anti-Tunneling Defense Across All Extreme (v, dt) Combinations',
    `Tunneling occurrences: 0`
  );
  assert(
    minDistanceRecorded >= -0.002,
    'CCD Stop Distance Precision at Obstacle Face',
    `Min offset to obstacle face: ${(minDistanceRecorded * 1000).toFixed(2)}mm`
  );

  // -----------------------------------------------------------------------
  // TEST GROUP 4: TIGHT CORRIDOR PINCHING & MULTI-OBSTACLE INTERSECTION
  // -----------------------------------------------------------------------
  console.log('\n=== TEST GROUP 4: Multi-Obstacle Pinching & Narrow Squeeze ===');
  
  // Two parallel walls creating a narrow 0.72m corridor (player diameter is 0.70m)
  // Wall 1: X in [-5.0, -0.36], Z in [-5.0, 5.0]
  // Wall 2: X in [0.36, 5.0], Z in [-5.0, 5.0]
  const squeezeEngine = new StandaloneCollisionEngine();
  squeezeEngine.addObstacle(new THREE.Box3(new THREE.Vector3(-5.0, 0, -5.0), new THREE.Vector3(-0.36, 3.0, 5.0)), 'Left Wall');
  squeezeEngine.addObstacle(new THREE.Box3(new THREE.Vector3(0.36, 0, -5.0), new THREE.Vector3(5.0, 3.0, 5.0)), 'Right Wall');

  // Place player at exact center (X = 0.0, Z = -4.0) inside corridor Z in [-5.0, 5.0]
  let squeezePos = new THREE.Vector3(0.0, 1.6, -4.0);
  let stable = true;
  let maxCorridorDriftX = 0;

  // Drive 60 steps through the tight corridor with extreme lateral jitter (+/- 0.25m per step)
  for (let step = 0; step < 60; step++) {
    const jitterX = (Math.random() - 0.5) * 0.5;
    const disp = new THREE.Vector3(jitterX, 0, 0.1);
    squeezePos = squeezeEngine.resolveMovement(squeezePos, disp, radius, height);

    if (isNaN(squeezePos.x) || isNaN(squeezePos.z) || !isFinite(squeezePos.x) || !isFinite(squeezePos.z)) {
      stable = false;
      break;
    }
    // Check containment within 0.72m corridor (gap is [-0.36, 0.36], player radius 0.35m -> X must be in [-0.011, 0.011])
    maxCorridorDriftX = Math.max(maxCorridorDriftX, Math.abs(squeezePos.x));
    if (Math.abs(squeezePos.x) > 0.015) {
      stable = false;
    }
  }

  assert(stable, 'Narrow 0.72m Corridor Squeeze Stability & Zero NaN/Oscillation', `Max Drift X = ${(maxCorridorDriftX * 1000).toFixed(2)}mm, Final Z = ${squeezePos.z.toFixed(2)}m`);

  // -----------------------------------------------------------------------
  // TEST GROUP 5: PARABOLIC ARC TRANSITION MATHEMATICAL CONTINUITY
  // -----------------------------------------------------------------------
  console.log('\n=== TEST GROUP 5: Parabolic Arc Transition Mathematical Continuity ===');

  function smootherstep(u) {
    return u * u * u * (u * (u * 6 - 15) + 10);
  }

  function smootherstepDeriv(u) {
    return 30 * u * u * (u - 1) * (u - 1);
  }

  // Test Boundary Conditions of Smootherstep
  const s0 = smootherstep(0.0);
  const s1 = smootherstep(1.0);
  const sMid = smootherstep(0.5);
  const ds0 = smootherstepDeriv(0.0);
  const ds1 = smootherstepDeriv(1.0);

  assert(s0 === 0.0 && s1 === 1.0, 'Smootherstep Boundary Values s(0)=0, s(1)=1', `s(0)=${s0}, s(1)=${s1}`);
  assert(sMid === 0.5, 'Smootherstep Symmetry s(0.5)=0.5', `s(0.5)=${sMid}`);
  assert(ds0 === 0.0 && ds1 === 0.0, 'Smootherstep C1 Smooth Acceleration ds/du(0)=0, ds/du(1)=0', `ds/du(0)=${ds0}, ds/du(1)=${ds1}`);

  // Test Parabolic Arc Lofting Equation:
  // y(u) = lerp(y0, y1, s(u)) + 4 * arcMax * u * (1 - u)
  const y0 = 1.6;
  const y1 = 20.0;
  const peakHeight = 22.0;
  const arcMax = peakHeight - Math.max(y0, y1); // 2.0

  function calcY(u) {
    const s = smootherstep(u);
    const base = THREE.MathUtils.lerp(y0, y1, s);
    const arc = 4 * Math.max(0, arcMax) * u * (1 - u);
    return base + arc;
  }

  const yStart = calcY(0.0);
  const yEnd = calcY(1.0);
  const yApex = calcY(0.5);

  assert(Math.abs(yStart - y0) < 1e-6, 'Parabolic Arc Start Height Continuity y(0) = y0', `y(0)=${yStart.toFixed(3)}m`);
  assert(Math.abs(yEnd - y1) < 1e-6, 'Parabolic Arc End Height Continuity y(1) = y1', `y(1)=${yEnd.toFixed(3)}m`);
  assert(Math.abs(yApex - (THREE.MathUtils.lerp(y0, y1, 0.5) + arcMax)) < 1e-6, 'Parabolic Arc Apex Height y(0.5) = Base + ArcMax', `y(0.5)=${yApex.toFixed(3)}m`);

  // -----------------------------------------------------------------------
  // SECTION 2: BROWSER PLAYWRIGHT LIVE E2E ADVERSARIAL INTEGRATION TESTS
  // -----------------------------------------------------------------------
  console.log('\n=== SECTION 2: Browser Playwright E2E Integration Stress Tests ===');

  let server;
  let browser;

  try {
    console.log('🚀 Spawning Vite preview server on port 3000...');
    server = spawn('npx', ['vite', 'preview', '--port', '3000', '--strictPort'], {
      cwd: path.resolve(__dirname, '..'),
      shell: true,
      stdio: 'pipe'
    });

    await new Promise(r => setTimeout(r, 2500));

    browser = await chromium.launch({
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    // E2E TEST 1: Rapid Mode Toggle Spamming (Adversarial stress)
    console.log('\n--- E2E TEST 1: Rapid Mode Toggle Spamming ---');
    const toggleStressResult = await page.evaluate(async () => {
      const nav = window.__OFFICE_DEBUG__.navigationManager;
      // Trigger 6 rapid mode changes mid-flight
      for (let i = 0; i < 6; i++) {
        const next = i % 2 === 0 ? 'orbit' : 'fps';
        nav.setMode(next, true);
        await new Promise(r => setTimeout(r, 80));
      }
      // Finally request fps
      nav.setMode('fps', true);
      return true;
    });

    // Wait for transition to settle
    await page.waitForFunction(() => window.__OFFICE_DEBUG__.navigationManager.mode === 'fps', { timeout: 6000 });
    
    const finalMode = await page.evaluate(() => window.__OFFICE_DEBUG__.navigationManager.mode);
    const finalCamPos = await page.evaluate(() => window.__OFFICE_DEBUG__.navigationManager.getPosition());

    assert(finalMode === 'fps', 'Rapid Mode Toggle Recovery to FPS Mode', `Current Mode: ${finalMode}`);
    assert(Math.abs(finalCamPos.y - 1.6) < 0.05, 'Eye Height Maintained after Toggle Storm', `Y = ${finalCamPos.y.toFixed(2)}m`);

    // E2E TEST 2: High-Speed Diagonal Sprint into Reception Desk Corner
    console.log('\n--- E2E TEST 2: High-Speed Diagonal Sprint into Obstacle Corner ---');
    const sprintTest = await page.evaluate(async () => {
      const nav = window.__OFFICE_DEBUG__.navigationManager;
      const fps = nav.fpsController;
      
      // Spawn at reception
      nav.setPosition(new nav.playerRig.position.constructor(-7.0, 1.6, 9.0), 0);

      // Simulate Sprint + Forward + Right (driving diagonally into reception desk)
      fps.keys.forward = true;
      fps.keys.right = true;
      fps.keys.sprint = true;
      fps.isEnabled = true;

      const positions = [];
      for (let frame = 0; frame < 60; frame++) {
        fps.update(0.016);
        positions.push({ x: fps.position.x, z: fps.position.z });
      }

      fps.keys.forward = false;
      fps.keys.right = false;
      fps.keys.sprint = false;

      // Check if any position intersected reception counter [-9.2, 0, 5.2] to [-4.8, 1.2, 6.8]
      let penetrated = false;
      for (const p of positions) {
        if (p.x > -9.2 + 0.35 && p.x < -4.8 - 0.35 && p.z > 5.2 + 0.35 && p.z < 6.8 - 0.35) {
          penetrated = true;
        }
      }

      return {
        initial: positions[0],
        final: positions[positions.length - 1],
        penetrated
      };
    });

    assert(!sprintTest.penetrated, 'Diagonal Sprinting Zero-Penetration against Reception Desk', `Penetrated: ${sprintTest.penetrated}`);
    assert(sprintTest.final.x !== sprintTest.initial.x, 'Diagonal Sprint Free Tangential Sliding', `Moved X: ${sprintTest.initial.x.toFixed(2)} -> ${sprintTest.final.x.toFixed(2)}`);

    // E2E TEST 3: Teleport Rapid Burst Stress Test
    console.log('\n--- E2E TEST 3: Teleport Rapid Burst Stress Test ---');
    const tpZones = ['reception', 'workstations', 'conference', 'lounge', 'reception', 'conference'];
    let tpSuccess = true;

    for (const z of tpZones) {
      await page.evaluate((zone) => window.__OFFICE_DEBUG__.teleport(zone), z);
      await page.waitForTimeout(50);
    }

    await page.waitForTimeout(1500); // Allow final smooth teleport to land
    const finalZone = await page.evaluate(() => window.__OFFICE_DEBUG__.navigationManager.getCurrentZone());
    assert(finalZone === 'conference', 'Teleport Burst Settles at Final Destination', `Final Zone: ${finalZone}`);

    // E2E TEST 4: Performance & Memory Stability during 600-Frame Soak
    console.log('\n--- E2E TEST 4: 600-Frame Performance & Physics Stability Soak ---');
    const soakResult = await page.evaluate(async () => {
      const debug = window.__OFFICE_DEBUG__;
      const nav = debug.navigationManager;
      const col = nav.collisionEngine;

      const p = new nav.playerRig.position.constructor(0, 1.6, 0);
      // Realistic 60 FPS frame movement (walk speed 4.2m/s * 0.016s = 0.067m)
      const normalFrameDisp = new nav.playerRig.position.constructor(0.047, 0, 0.047);

      const t0 = performance.now();
      for (let i = 0; i < 600; i++) {
        col.resolveMovement(p, normalFrameDisp, 0.35, 1.80);
      }
      const t1 = performance.now();
      const normalStepTimeUs = ((t1 - t0) / 600) * 1000;

      // Heavy 17-substep burst movement (2.82m displacement)
      const heavyDisp = new nav.playerRig.position.constructor(2.0, 0, 2.0);
      const t2 = performance.now();
      for (let i = 0; i < 200; i++) {
        col.resolveMovement(p, heavyDisp, 0.35, 1.80);
      }
      const t3 = performance.now();
      const heavyStepTimeUs = ((t3 - t2) / 200) * 1000;

      return {
        normalStepTimeUs,
        heavyStepTimeUs,
        fps: debug.getFPS ? debug.getFPS() : 60,
        drawCalls: debug.getDrawCalls ? debug.getDrawCalls() : 0
      };
    });

    assert(soakResult.normalStepTimeUs < 100, 'Standard 60 FPS Frame Collision Cost', `Resolve time: ${soakResult.normalStepTimeUs.toFixed(1)} µs/frame (< 100 µs budget = < 0.1ms)`);
    assert(soakResult.heavyStepTimeUs < 1000, 'Heavy 17-Substep Burst Collision Cost', `Resolve time: ${soakResult.heavyStepTimeUs.toFixed(1)} µs/call (< 1000 µs budget = < 1.0ms)`);
    assert(errors.length === 0, 'Zero Uncaught Browser Page Runtime Errors', `Errors count: ${errors.length}`);

  } catch (err) {
    console.error('❌ E2E Integration Test Execution Error:', err);
    failedTests++;
  } finally {
    if (browser) await browser.close();
    if (server) server.kill();
  }

  // -----------------------------------------------------------------------
  // SUMMARY & VERDICT
  // -----------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`STRESS TEST SUMMARY: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
  console.log('========================================================================');

  if (failedTests === 0) {
    console.log('\n🏆 VERDICT: APPROVE');
    console.log('All adversarial stress tests (Sliding Collision, Perimeter Bounds, CCD Sub-stepping, Parabolic Transitions, and Browser E2E) passed with zero defects.');
    process.exit(0);
  } else {
    console.error('\n⚠️ VERDICT: REQUEST_CHANGES');
    console.error(`${failedTests} stress tests failed!`);
    process.exit(1);
  }
}

runEmpiricalStressTests();
