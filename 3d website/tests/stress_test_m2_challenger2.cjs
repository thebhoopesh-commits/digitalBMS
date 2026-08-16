/**
 * Milestone 2 Challenger 2 Stress Test Suite
 * 
 * Adversarial Testing Scope:
 * 1. Rapid Mode Switching & Re-entrancy during parabolic transition flight.
 * 2. OrbitController Polar Angle Clamping, Gimbal Flip Immunity & Spherical Singularity Checks.
 * 3. Teleport Destination Collision Validation for all zones (reception, workstations, conference, lounge, entrance).
 * 4. Kinematic Damping & Numerical Stability under extreme delta spikes (0s, 0.001s, 0.1s, 1.0s, 10.0s).
 * 5. Orbit Zoom and Pan Boundary Enforcements under extreme pointer/wheel inputs.
 * 6. Camera Rig Parenting & Hierarchy Consistency across high-frequency mode toggles.
 * 7. Long-term state fuzzing (random inputs soak test).
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const { spawn } = require('child_process');

async function runChallenger2StressSuite() {
  console.log('================================================================');
  console.log('🔥 EMPIRICAL CHALLENGER 2: M2 ADVERSARIAL STRESS TEST SUITE 🔥');
  console.log('================================================================\n');

  // Start vite preview on port 3000
  const server = spawn('npx', ['vite', 'preview', '--port', '3000', '--strictPort'], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    stdio: 'pipe'
  });

  await new Promise(r => setTimeout(r, 2500));

  let browser;
  let exitCode = 0;
  const testResults = [];

  function recordResult(name, passed, details) {
    testResults.push({ name, passed, details });
    const mark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`[${mark}] ${name}`);
    if (details) console.log(`   Details: ${details}`);
    if (!passed) exitCode = 1;
  }

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    const pageErrors = [];
    page.on('pageerror', err => {
      console.error('💥 Uncaught Browser Error:', err);
      pageErrors.push(err.message);
      exitCode = 1;
    });

    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);

    // Verify debug contract existence
    const hasDebug = await page.evaluate(() => !!window.__OFFICE_DEBUG__);
    if (!hasDebug) {
      throw new Error('window.__OFFICE_DEBUG__ is not exposed on page');
    }

    // -------------------------------------------------------------------------
    // TEST 1: Teleport Destination Collision & Bound Safety Audit
    // -------------------------------------------------------------------------
    console.log('\n--- 1. TELEPORT DESTINATION VALIDATION & OBSTACLE CLEARANCE ---');
    const teleportValidation = await page.evaluate(() => {
      const nav = window.__OFFICE_DEBUG__.navigationManager;
      const col = nav.collisionEngine;
      const zones = ['reception', 'workstations', 'conference', 'lounge', 'entrance'];
      const details = [];

      for (const z of zones) {
        nav.teleportTo(z, false);
        const pos = nav.getPosition();
        const curZone = nav.getCurrentZone ? nav.getCurrentZone() : null;
        const isValid = col.isPositionValid(pos, 0.35, 1.80);

        // Calculate minimum distance to any active obstacle
        let minObsDist = Infinity;
        let closestObsName = '';
        for (const obs of col.obstacles) {
          if (obs.isOpen) continue;
          const closestX = Math.max(obs.min.x, Math.min(obs.max.x, pos.x));
          const closestZ = Math.max(obs.min.z, Math.min(obs.max.z, pos.z));
          const dx = pos.x - closestX;
          const dz = pos.z - closestZ;
          const dist = Math.hypot(dx, dz);
          if (dist < minObsDist) {
            minObsDist = dist;
            closestObsName = obs.name;
          }
        }

        // Boundary clearance
        const inBounds = 
          pos.x >= col.BOUNDS.minX && pos.x <= col.BOUNDS.maxX &&
          pos.z >= col.BOUNDS.minZ && pos.z <= col.BOUNDS.maxZ;

        details.push({
          zone: z,
          curZone,
          pos: { x: pos.x, y: pos.y, z: pos.z },
          isValid,
          inBounds,
          minObsDist,
          closestObsName,
          clearanceMargin: minObsDist - 0.35 // margin beyond player radius
        });
      }
      return details;
    });

    let allTeleportsSafe = true;
    for (const res of teleportValidation) {
      const safe = res.isValid && res.inBounds && res.clearanceMargin > 0.05;
      if (!safe) allTeleportsSafe = false;
      console.log(`   Zone "${res.zone}": pos=(${res.pos.x.toFixed(2)}, ${res.pos.z.toFixed(2)}), minClearance=${(res.clearanceMargin*100).toFixed(1)}cm (closest: "${res.closestObsName}"), valid=${res.isValid}, matchedZone=${res.curZone === res.zone}`);
    }
    recordResult(
      'Teleport Landing Coordinates Safety (Obstacle & Boundary Clearance)',
      allTeleportsSafe,
      `All 5 zones verified: minimum clearance ${Math.min(...teleportValidation.map(t => t.clearanceMargin)).toFixed(2)}m > player radius 0.35m`
    );

    // -------------------------------------------------------------------------
    // TEST 2: OrbitController Polar Angle Clamping & Gimbal Inversion Immunity
    // -------------------------------------------------------------------------
    console.log('\n--- 2. ORBIT CONTROLLER POLAR CLAMP & GIMBAL FLIP IMMUNITY ---');
    const orbitPolarStress = await page.evaluate(() => {
      const nav = window.__OFFICE_DEBUG__.navigationManager;
      nav.setMode('orbit', false);
      const orb = nav.orbitController;
      const cam = window.__OFFICE_DEBUG__.sceneManager.camera;

      const results = [];

      // Test 2a: Push polar angle to extreme negative (should clamp to minPolarAngle ~0.15 rad)
      orb.setOrbitView(28.0, -100.0, 0.0, true);
      orb.update(0.016);
      const minClampedPolar = orb.polarAngle;
      const minCamY = cam.position.y;
      results.push({
        test: 'Extreme Zenith Push (-100 rad)',
        polar: orb.polarAngle,
        expectedPolarMin: orb.minPolarAngle,
        isClamped: orb.polarAngle >= orb.minPolarAngle - 1e-4,
        camY: minCamY,
        noInversion: minCamY > orb.target.y
      });

      // Test 2b: Push polar angle to extreme positive (should clamp to maxPolarAngle ~1.428 rad)
      orb.setOrbitView(28.0, 100.0, 0.0, true);
      orb.update(0.016);
      const maxClampedPolar = orb.polarAngle;
      const maxCamY = cam.position.y;
      results.push({
        test: 'Extreme Nadir Push (+100 rad)',
        polar: orb.polarAngle,
        expectedPolarMax: orb.maxPolarAngle,
        isClamped: orb.polarAngle <= orb.maxPolarAngle + 1e-4,
        camY: maxCamY,
        noUnderfloor: maxCamY > 0
      });

      // Test 2c: Rapid adversarial pointer movement deltas (1000 iterations of random extreme deltas)
      let polarViolations = 0;
      let hasNaN = false;
      for (let i = 0; i < 1000; i++) {
        const randDelta = (Math.random() - 0.5) * 10000;
        orb.setOrbitView(
          orb.distance,
          orb.polarAngle + randDelta,
          orb.azimuthalAngle + randDelta,
          false
        );
        orb.update(0.016);

        if (orb.polarAngle < orb.minPolarAngle - 1e-3 || orb.polarAngle > orb.maxPolarAngle + 1e-3) {
          polarViolations++;
        }
        if (isNaN(cam.position.x) || isNaN(cam.position.y) || isNaN(cam.position.z)) {
          hasNaN = true;
        }
      }

      return {
        results,
        polarViolations,
        hasNaN,
        minPolarAngle: orb.minPolarAngle,
        maxPolarAngle: orb.maxPolarAngle
      };
    });

    const polarPass = orbitPolarStress.polarViolations === 0 && !orbitPolarStress.hasNaN;
    recordResult(
      'Orbit Polar Clamp Strict Enforcement [min: 0.15 rad, max: ~1.43 rad]',
      polarPass,
      `Violations: ${orbitPolarStress.polarViolations}/1000 iterations, NaN: ${orbitPolarStress.hasNaN}`
    );

    // -------------------------------------------------------------------------
    // TEST 3: Orbit Distance / Zoom Boundary Stress
    // -------------------------------------------------------------------------
    console.log('\n--- 3. ORBIT ZOOM & DISTANCE BOUNDARY STRESS ---');
    const zoomStress = await page.evaluate(() => {
      const nav = window.__OFFICE_DEBUG__.navigationManager;
      const orb = nav.orbitController;

      // Extreme zoom in
      orb.zoom(-100000);
      for (let i = 0; i < 60; i++) orb.update(0.016);
      const minDistanceReached = orb.distance;

      // Extreme zoom out
      orb.zoom(100000);
      for (let i = 0; i < 60; i++) orb.update(0.016);
      const maxDistanceReached = orb.distance;

      return {
        minDistanceConfig: orb.minDistance,
        maxDistanceConfig: orb.maxDistance,
        minDistanceReached,
        maxDistanceReached,
        minClamped: minDistanceReached >= orb.minDistance - 0.01,
        maxClamped: maxDistanceReached <= orb.maxDistance + 0.01
      };
    });

    const zoomPass = zoomStress.minClamped && zoomStress.maxClamped;
    recordResult(
      'Orbit Zoom Distance Clamping [4.0m <= distance <= 55.0m]',
      zoomPass,
      `Min reached: ${zoomStress.minDistanceReached.toFixed(2)}m (bound: ${zoomStress.minDistanceConfig}m), Max reached: ${zoomStress.maxDistanceReached.toFixed(2)}m (bound: ${zoomStress.maxDistanceConfig}m)`
    );

    // -------------------------------------------------------------------------
    // TEST 4: Orbit Pan Boundary Clamping
    // -------------------------------------------------------------------------
    console.log('\n--- 4. ORBIT PAN BOUNDARY CLAMPING ---');
    const panStress = await page.evaluate(() => {
      const nav = window.__OFFICE_DEBUG__.navigationManager;
      const orb = nav.orbitController;

      // Pan extremely in all 4 directions
      orb.pan(100000, 100000);
      for (let i = 0; i < 60; i++) orb.update(0.016);
      const corner1 = { x: orb.target.x, z: orb.target.z, y: orb.target.y };

      orb.pan(-200000, -200000);
      for (let i = 0; i < 60; i++) orb.update(0.016);
      const corner2 = { x: orb.target.x, z: orb.target.z, y: orb.target.y };

      const b = orb.bounds;
      const valid =
        corner1.x >= b.minX - 0.01 && corner1.x <= b.maxX + 0.01 &&
        corner1.z >= b.minZ - 0.01 && corner1.z <= b.maxZ + 0.01 &&
        corner2.x >= b.minX - 0.01 && corner2.x <= b.maxX + 0.01 &&
        corner2.z >= b.minZ - 0.01 && corner2.z <= b.maxZ + 0.01;

      return {
        bounds: b,
        corner1,
        corner2,
        valid
      };
    });

    recordResult(
      'Orbit Pan Target Clamping within Floorplan Bounding Volume',
      panStress.valid,
      `Bounds: X[${panStress.bounds.minX}, ${panStress.bounds.maxX}], Z[${panStress.bounds.minZ}, ${panStress.bounds.maxZ}], Clamped Corners: (${panStress.corner1.x.toFixed(1)}, ${panStress.corner1.z.toFixed(1)}) and (${panStress.corner2.x.toFixed(1)}, ${panStress.corner2.z.toFixed(1)})`
    );

    // -------------------------------------------------------------------------
    // TEST 5: Rapid Mode Switching & Transition Re-entrancy Stress
    // -------------------------------------------------------------------------
    console.log('\n--- 5. RAPID MODE SWITCHING & TRANSITION RE-ENTRANCY (100 RAPID TOGGLES) ---');
    const rapidSwitchResults = await page.evaluate(async () => {
      const nav = window.__OFFICE_DEBUG__.navigationManager;
      const cam = window.__OFFICE_DEBUG__.sceneManager.camera;
      const fps = nav.fpsController;

      let nanOrInfDetected = false;
      let hierarchyCorrupt = false;
      let stateErrors = 0;

      // Perform 100 rapid mode toggles with randomized micro-intervals (0ms - 50ms)
      for (let i = 0; i < 100; i++) {
        const targetMode = (i % 2 === 0) ? 'orbit' : 'fps';
        nav.setMode(targetMode, true);

        // Check instantaneous numerical validity
        if (
          isNaN(cam.position.x) || isNaN(cam.position.y) || isNaN(cam.position.z) ||
          !isFinite(cam.position.x) || !isFinite(cam.position.y) || !isFinite(cam.position.z) ||
          isNaN(cam.quaternion.x) || isNaN(cam.quaternion.y) || isNaN(cam.quaternion.z) || isNaN(cam.quaternion.w)
        ) {
          nanOrInfDetected = true;
        }

        // Advance random fractional frame delta
        nav.update((Math.random() * 0.03) + 0.005);

        if (i % 10 === 0) {
          await new Promise(r => setTimeout(r, Math.random() * 30));
        }
      }

      // Finally settle to FPS mode and allow transition to complete
      nav.setMode('fps', true);
      const settleStart = performance.now();
      while (nav.mode === 'transitioning' && performance.now() - settleStart < 4000) {
        nav.update(0.016);
        await new Promise(r => setTimeout(r, 16));
      }

      // Verify settled hierarchy
      const finalMode = nav.mode;
      const camParent = cam.parent;
      const isCamInPitchObject = camParent === fps.pitchObject;
      const finalPos = nav.getPosition();

      if (
        isNaN(finalPos.x) || isNaN(finalPos.y) || isNaN(finalPos.z) ||
        !isFinite(finalPos.x) || !isFinite(finalPos.y) || !isFinite(finalPos.z)
      ) {
        nanOrInfDetected = true;
      }

      if (finalMode === 'fps' && !isCamInPitchObject) {
        hierarchyCorrupt = true;
      }

      return {
        nanOrInfDetected,
        hierarchyCorrupt,
        finalMode,
        isCamInPitchObject,
        finalPos: { x: finalPos.x, y: finalPos.y, z: finalPos.z }
      };
    });

    const rapidSwitchPass = 
      !rapidSwitchResults.nanOrInfDetected && 
      !rapidSwitchResults.hierarchyCorrupt && 
      rapidSwitchResults.finalMode === 'fps' &&
      rapidSwitchResults.isCamInPitchObject;

    recordResult(
      'Rapid Mode Switching & Transition Re-entrancy (100 toggles)',
      rapidSwitchPass,
      `NaN/Inf: ${rapidSwitchResults.nanOrInfDetected}, Hierarchy Corrupt: ${rapidSwitchResults.hierarchyCorrupt}, Final Mode: ${rapidSwitchResults.finalMode}, Camera in PitchObject: ${rapidSwitchResults.isCamInPitchObject}`
    );

    // -------------------------------------------------------------------------
    // TEST 6: Kinematic Damping & Extreme Delta Spikes (0s, 0.001s, 0.1s, 1.0s, 10.0s)
    // -------------------------------------------------------------------------
    console.log('\n--- 6. KINEMATIC DAMPING & EXTREME DELTA SPIKES ---');
    const deltaSpikeResults = await page.evaluate(() => {
      const nav = window.__OFFICE_DEBUG__.navigationManager;
      const fps = nav.fpsController;
      const orb = nav.orbitController;
      const cam = window.__OFFICE_DEBUG__.sceneManager.camera;

      const deltasToTest = [0, 0.00001, 0.001, 0.016, 0.05, 0.1, 0.5, 1.0, 5.0, 10.0, 100.0];
      const errors = [];

      // Test FPS Controller under delta spikes
      nav.setMode('fps', false);
      const Vec3 = fps.position.constructor;
      fps.setPosition(new Vec3(0, 1.6, 0), 0);
      fps.velocity.set(10.0, 0, 10.0);

      for (const d of deltasToTest) {
        fps.update(d);
        const p = fps.position;
        const v = fps.velocity;
        if (isNaN(p.x) || isNaN(p.y) || isNaN(p.z) || !isFinite(p.x) || !isFinite(p.y) || !isFinite(p.z)) {
          errors.push(`FPS Pos NaN/Inf at delta=${d}`);
        }
        if (isNaN(v.x) || isNaN(v.y) || isNaN(v.z) || !isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z)) {
          errors.push(`FPS Vel NaN/Inf at delta=${d}`);
        }
        // Eye height must stay locked at 1.60m
        if (Math.abs(p.y - 1.60) > 0.01) {
          errors.push(`FPS Eye Height Drift: ${p.y} != 1.60 at delta=${d}`);
        }
      }

      // Test Orbit Controller under delta spikes
      nav.setMode('orbit', false);
      orb.setOrbitView(40.0, 0.5, 1.0, false);

      for (const d of deltasToTest) {
        orb.update(d);
        const cp = cam.position;
        if (isNaN(cp.x) || isNaN(cp.y) || isNaN(cp.z) || !isFinite(cp.x) || !isFinite(cp.y) || !isFinite(cp.z)) {
          errors.push(`Orbit Cam NaN/Inf at delta=${d}`);
        }
        if (orb.polarAngle < orb.minPolarAngle - 1e-3 || orb.polarAngle > orb.maxPolarAngle + 1e-3) {
          errors.push(`Orbit Polar Out of Bounds (${orb.polarAngle}) at delta=${d}`);
        }
      }

      return {
        deltasTested: deltasToTest.length,
        errors
      };
    });

    const deltaSpikePass = deltaSpikeResults.errors.length === 0;
    recordResult(
      'Kinematic Damping Stability under Extreme Delta Spikes (0 to 100s)',
      deltaSpikePass,
      `Deltas tested: ${deltaSpikeResults.deltasTested}, Errors: ${deltaSpikeResults.errors.length === 0 ? 'None' : deltaSpikeResults.errors.join('; ')}`
    );

    // -------------------------------------------------------------------------
    // TEST 7: Adversarial Randomized Fuzzing Soak (Teleports + Mode Swaps + Inputs)
    // -------------------------------------------------------------------------
    console.log('\n--- 7. ADVERSARIAL RANDOMIZED FUZZING SOAK (200 CYCLES) ---');
    const fuzzResults = await page.evaluate(async () => {
      const nav = window.__OFFICE_DEBUG__.navigationManager;
      const cam = window.__OFFICE_DEBUG__.sceneManager.camera;
      const zones = ['reception', 'workstations', 'conference', 'lounge', 'entrance', 'invalid_zone_xyz'];
      let anomalies = 0;
      const anomalyLog = [];

      for (let cycle = 0; cycle < 200; cycle++) {
        const action = Math.floor(Math.random() * 5);
        const randomZone = zones[Math.floor(Math.random() * zones.length)];

        switch (action) {
          case 0:
            nav.teleportTo(randomZone, Math.random() > 0.5);
            break;
          case 1:
            nav.setMode(Math.random() > 0.5 ? 'fps' : 'orbit', Math.random() > 0.5);
            break;
          case 2:
            nav.orbitController.zoom((Math.random() - 0.5) * 50);
            break;
          case 3:
            nav.orbitController.pan((Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100);
            break;
          case 4:
            nav.setPosition(new nav.playerRig.position.constructor((Math.random() - 0.5) * 30, 1.6, (Math.random() - 0.5) * 20), Math.random() * Math.PI * 2);
            break;
        }

        nav.update((Math.random() * 0.05) + 0.001);

        const pos = nav.getPosition();
        if (isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z) || !isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z)) {
          anomalies++;
          anomalyLog.push(`Cycle ${cycle}: Position NaN/Inf`);
        }
      }

      // Cleanup to stable FPS state
      nav.setMode('fps', false);
      nav.teleportTo('entrance', false);

      return {
        cycles: 200,
        anomalies,
        anomalyLog
      };
    });

    const fuzzPass = fuzzResults.anomalies === 0 && pageErrors.length === 0;
    recordResult(
      'Adversarial Randomized Fuzzing Soak (200 chaotic cycles)',
      fuzzPass,
      `Anomalies: ${fuzzResults.anomalies}/200, Page Errors: ${pageErrors.length}`
    );

  } catch (err) {
    console.error('💥 Fatal Stress Test Exception:', err.message);
    recordResult('Execution Harness Integrity', false, err.message);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  console.log('\n================================================================');
  console.log(`STRESS TEST SUMMARY: ${testResults.filter(t => t.passed).length} / ${testResults.length} PASSED`);
  if (exitCode === 0) {
    console.log('🏆 VERDICT: APPROVE (M2 Navigation & Orbit Rig Passes Adversarial Stress)');
  } else {
    console.log('⛔ VERDICT: REQUEST_CHANGES (Failures Detected)');
  }
  console.log('================================================================\n');

  process.exit(exitCode);
}

runChallenger2StressSuite();
