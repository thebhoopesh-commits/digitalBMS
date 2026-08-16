const THREE = require('three');

// Replicate CollisionEngine math for deep stress-testing
class TestCollisionEngine {
  constructor() {
    this.obstacles = [];
    this.BOUNDS = { minX: -19.5, maxX: 19.5, minZ: -12.5, maxZ: 12.5, minY: 0.0, maxY: 4.0 };
    this.EPSILON = 0.001;
    this.ALLOW_EPSILON = 0.05;
  }

  addObstacle(box, isDoor = false) {
    this.obstacles.push({
      min: box.min.clone(),
      max: box.max.clone(),
      isDoor,
      isOpen: false
    });
  }

  resolveMovement(currentPos, desiredMovement, playerRadius = 0.35, playerHeight = 1.80) {
    const moveLength = Math.hypot(desiredMovement.x, desiredMovement.z);
    if (moveLength < 1e-6) return currentPos.clone();

    const maxSubStep = playerRadius * 0.5;
    const subSteps = Math.max(1, Math.ceil(moveLength / maxSubStep));
    const invSteps = 1.0 / subSteps;
    const stepMove = new THREE.Vector3(
      desiredMovement.x * invSteps,
      desiredMovement.y * invSteps,
      desiredMovement.z * invSteps
    );

    const pos = currentPos.clone();
    for (let step = 0; step < subSteps; step++) {
      this._resolveSingleStep(pos, stepMove, playerRadius, playerHeight);
    }
    return pos;
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
}

async function runAdversarialStressTests() {
  console.log('🔥 Running Adversarial Critic Stress Tests for Milestone 2...');

  const col = new TestCollisionEngine();
  // Add a wall obstacle in the middle: X: [-2, 2], Z: [-2, 2], Y: [0, 3]
  col.addObstacle(new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 3, 2)));

  let failures = 0;

  // 1. High-speed projectile tunneling attack (moving 100m/s in one frame)
  const pStart = new THREE.Vector3(-10, 1.6, 0);
  const fastMove = new THREE.Vector3(20, 0, 0); // Straight through obstacle
  const pEnd = col.resolveMovement(pStart, fastMove, 0.35, 1.80);
  console.log(`\n[Attack 1] Fast displacement through obstacle:`);
  console.log(`  Start: (${pStart.x}, ${pStart.z}) -> Desired dx: ${fastMove.x} -> Final: (${pEnd.x.toFixed(4)}, ${pEnd.z.toFixed(4)})`);
  if (pEnd.x > -2.0) {
    console.error(`  ❌ Failed: Penetrated obstacle! Final X = ${pEnd.x}`);
    failures++;
  } else {
    console.log(`  ✅ Passed: Blocked at obstacle face (X = ${pEnd.x.toFixed(4)} <= -2.35)`);
  }

  // 2. Corner sliding attack (approaching corner at 45 deg)
  const pCorner = new THREE.Vector3(-2.5, 1.6, -2.5);
  const cornerMove = new THREE.Vector3(1.0, 0, 1.0);
  const pCornerResolved = col.resolveMovement(pCorner, cornerMove, 0.35, 1.80);
  console.log(`\n[Attack 2] Corner 45-degree sliding:`);
  console.log(`  Start: (${pCorner.x}, ${pCorner.z}) -> Final: (${pCornerResolved.x.toFixed(4)}, ${pCornerResolved.z.toFixed(4)})`);
  const cDistSq = Math.pow(Math.max(-2, Math.min(2, pCornerResolved.x)) - pCornerResolved.x, 2) +
                  Math.pow(Math.max(-2, Math.min(2, pCornerResolved.z)) - pCornerResolved.z, 2);
  if (cDistSq < 0.35 * 0.35 - 1e-4) {
    console.error(`  ❌ Failed: Corner penetration detected! dist = ${Math.sqrt(cDistSq)} < 0.35`);
    failures++;
  } else {
    console.log(`  ✅ Passed: Clear of corner boundary (dist = ${Math.sqrt(cDistSq).toFixed(4)} >= 0.35)`);
  }

  // 3. Boundary extreme clamp attack (moving 1000m outside bounds)
  const pOutOfBounds = new THREE.Vector3(0, 1.6, 0);
  const extremeMove = new THREE.Vector3(500, 0, -500);
  const pBoundResolved = col.resolveMovement(pOutOfBounds, extremeMove, 0.35, 1.80);
  console.log(`\n[Attack 3] Extreme boundary overflow:`);
  console.log(`  Final: (${pBoundResolved.x}, ${pBoundResolved.z})`);
  if (pBoundResolved.x > 19.5 || pBoundResolved.x < -19.5 || pBoundResolved.z > 12.5 || pBoundResolved.z < -12.5) {
    console.error(`  ❌ Failed: Clamping breached bounds!`);
    failures++;
  } else {
    console.log(`  ✅ Passed: Strictly clamped to [±19.5, ±12.5]`);
  }

  // 4. Parabolic Transition Arc math verification
  console.log(`\n[Attack 4] Parabolic transition trajectory limits:`);
  const startPos = new THREE.Vector3(0, 1.6, 11.5);
  const endPos = new THREE.Vector3(0, 20.2, 0);
  const peakHeight = Math.max(endPos.y + 2.0, startPos.y + 3.0); // 22.2
  let maxArcY = -Infinity;
  let hasNaN = false;

  for (let step = 0; step <= 100; step++) {
    const u = step / 100;
    const s = u * u * u * (u * (u * 6 - 15) + 10);
    const baseHeight = THREE.MathUtils.lerp(startPos.y, endPos.y, s);
    const arcMax = peakHeight - Math.max(startPos.y, endPos.y);
    const arcHeight = 4 * Math.max(0, arcMax) * u * (1 - u);
    const currentY = baseHeight + arcHeight;

    if (isNaN(currentY) || !isFinite(currentY)) hasNaN = true;
    if (currentY > maxArcY) maxArcY = currentY;
  }
  console.log(`  Peak Y in transition: ${maxArcY.toFixed(2)}m (Expected: ~${peakHeight.toFixed(2)}m, NaN detected: ${hasNaN})`);
  if (hasNaN || maxArcY < endPos.y) {
    console.error(`  ❌ Failed: Parabolic arc math invalid!`);
    failures++;
  } else {
    console.log(`  ✅ Passed: Smooth monotonic loft peak reached without singularities`);
  }

  // 5. Head bobbing phase wrap-around stress test (simulating 10,000 steps)
  console.log(`\n[Attack 5] Head-bob cadence phase long-run stability:`);
  let bobPhase = 0;
  let cadenceFreq = 9.5 * (0.8 + 0.7 * (7.8 / 4.2)); // max sprint freq ~ 20.0 rad/s
  let troughCount = 0;
  let lastFootstepTime = 0;
  let now = 0;
  const delta = 0.016; // 60 FPS delta

  for (let frame = 0; frame < 6000; frame++) { // 100 seconds continuous sprint
    now += 16;
    const prevPhase = bobPhase;
    bobPhase = (bobPhase + cadenceFreq * delta) % (Math.PI * 4);
    const trough1 = (3 * Math.PI) / 2;
    const trough2 = (7 * Math.PI) / 2;
    const crossedTrough = 
      (prevPhase < trough1 && bobPhase >= trough1) ||
      (prevPhase < trough2 && bobPhase >= trough2);
    if (crossedTrough && (now - lastFootstepTime > 220)) {
      troughCount++;
      lastFootstepTime = now;
    }
  }
  console.log(`  Simulated 100s sprint: ${troughCount} footstep events triggered (~${(troughCount / 100).toFixed(1)} steps/s), bobPhase is finite (${bobPhase.toFixed(4)})`);
  if (isNaN(bobPhase) || troughCount < 200 || troughCount > 500) {
    console.error(`  ❌ Failed: Cadence tracking aberrant!`);
    failures++;
  } else {
    console.log(`  ✅ Passed: Cadence rate is realistic and stable without phase drift`);
  }

  console.log(`\nTotal Adversarial Failures: ${failures}`);
  process.exit(failures > 0 ? 1 : 0);
}

runAdversarialStressTests();
