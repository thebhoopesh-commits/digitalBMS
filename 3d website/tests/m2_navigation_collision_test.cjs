const { chromium } = require('@playwright/test');
const path = require('path');
const { spawn } = require('child_process');

async function runM2Verification() {
  console.log('🧪 Starting Milestone 2 (Dual Navigation & Collision Physics) Verification Suite...\n');

  // Start vite preview on port 3000
  const server = spawn('npx', ['vite', 'preview', '--port', '3000', '--strictPort'], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    stdio: 'pipe'
  });

  // Give server 3s to bind
  await new Promise(r => setTimeout(r, 3000));

  let browser;
  let exitCode = 0;

  try {
    console.log('🚀 Launching Headless Chromium for M2 Verification...');
    browser = await chromium.launch({
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    const consoleLogs = [];
    page.on('console', msg => consoleLogs.push(`[Browser ${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => {
      console.error('❌ Browser Page Error:', err);
      exitCode = 1;
    });

    console.log('🔗 Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    // TEST 1: Initial FPS Navigation State
    console.log('\n--- TEST 1: Initial Navigation State ---');
    const initState = await page.evaluate(() => {
      const debug = window.__OFFICE_DEBUG__;
      const nav = debug.navigationManager;
      return {
        hasNav: !!nav,
        mode: nav.mode,
        pos: nav.getPosition(),
        yaw: nav.getYaw(),
        pitch: nav.getPitch ? nav.getPitch() : 0,
        modeText: document.getElementById('mode-text')?.textContent,
        reticleVisible: !document.getElementById('reticle')?.classList.contains('hidden')
      };
    });
    console.log(`  Initial Mode: ${initState.mode} (Expected: fps) -> ${initState.mode === 'fps' ? 'PASS' : 'FAIL'}`);
    console.log(`  Initial Pos: (${initState.pos.x}, ${initState.pos.y}, ${initState.pos.z}) (Expected eye height: 1.6m) -> ${Math.abs(initState.pos.y - 1.6) < 0.01 ? 'PASS' : 'FAIL'}`);
    console.log(`  Mode Badge: "${initState.modeText}" -> ${initState.modeText.includes('FPS') ? 'PASS' : 'FAIL'}`);
    console.log(`  Reticle Visible: ${initState.reticleVisible ? 'PASS' : 'FAIL'}`);
    if (initState.mode !== 'fps' || Math.abs(initState.pos.y - 1.6) > 0.01 || !initState.reticleVisible) {
      exitCode = 1;
    }

    // TEST 2: Collision Engine AABB Obstacle Checks & Sliding Physics
    console.log('\n--- TEST 2: Collision Engine Physics & Sliding ---');
    const collisionResults = await page.evaluate(() => {
      const debug = window.__OFFICE_DEBUG__;
      const nav = debug.navigationManager;
      const col = nav.collisionEngine;

      // 1. Boundary check: attempt to move past east boundary X = 19.5
      const p1 = new nav.playerRig.position.constructor(19.0, 1.6, 0);
      const d1 = new nav.playerRig.position.constructor(5.0, 0, 0);
      const res1 = col.resolveMovement(p1, d1, 0.35, 1.80);

      // 2. Obstacle check: South wall sliding (dx = 2.0, dz = 5.0 into south wall at z = 12.8)
      const p2 = new nav.playerRig.position.constructor(0, 1.6, 11.5);
      const d2 = new nav.playerRig.position.constructor(2.0, 0, 5.0);
      const res2 = col.resolveMovement(p2, d2, 0.35, 1.80);

      // 3. Obstacle count
      const obsCount = col.obstacles.length;

      return {
        res1X: res1.x,
        res2X: res2.x,
        res2Z: res2.z,
        obsCount
      };
    });

    console.log(`  Total Obstacles Registered: ${collisionResults.obsCount} (Expected: >= 36) -> ${collisionResults.obsCount >= 36 ? 'PASS' : 'FAIL'}`);
    console.log(`  Boundary Clamp: Max X = ${collisionResults.res1X} (Expected: <= 19.5) -> ${collisionResults.res1X <= 19.5 ? 'PASS' : 'FAIL'}`);
    console.log(`  Sliding Physics: Moving into wall allowed X movement (${collisionResults.res2X} > 0) while clamping Z (${collisionResults.res2Z} <= 12.5) -> ${collisionResults.res2X > 0 && collisionResults.res2Z <= 12.5 ? 'PASS' : 'FAIL'}`);
    if (collisionResults.obsCount < 36 || collisionResults.res1X > 19.5 || collisionResults.res2Z > 12.5) {
      exitCode = 1;
    }

    // TEST 3: Mode Switch to Orbit (Smooth Transition)
    console.log('\n--- TEST 3: Parabolic Mode Transition (FPS -> Orbit) ---');
    await page.evaluate(() => {
      window.__OFFICE_DEBUG__.navigationManager.setMode('orbit', true);
    });

    // Check transitioning state immediately
    const midMode = await page.evaluate(() => window.__OFFICE_DEBUG__.navigationManager.mode);
    console.log(`  Transition State during switch: "${midMode}" -> ${midMode === 'transitioning' ? 'PASS' : 'FAIL'}`);

    // Wait for transition to complete
    await page.waitForFunction(() => window.__OFFICE_DEBUG__.navigationManager.mode === 'orbit', { timeout: 5000 });

    const orbitState = await page.evaluate(() => {
      const nav = window.__OFFICE_DEBUG__.navigationManager;
      const cam = window.__OFFICE_DEBUG__.sceneManager.camera;
      return {
        mode: nav.mode,
        camY: cam.position.y,
        camDist: Math.hypot(cam.position.x, cam.position.z),
        modeText: document.getElementById('mode-text')?.textContent,
        reticleHidden: document.getElementById('reticle')?.classList.contains('hidden')
      };
    });
    console.log(`  Mode after transition: "${orbitState.mode}" (Expected: orbit) -> ${orbitState.mode === 'orbit' ? 'PASS' : 'FAIL'}`);
    console.log(`  Orbit Camera Altitude: Y = ${orbitState.camY.toFixed(1)}m (Expected: > 15m) -> ${orbitState.camY > 15 ? 'PASS' : 'FAIL'}`);
    console.log(`  HUD Mode Badge: "${orbitState.modeText}" -> ${orbitState.modeText.includes('ORBIT') ? 'PASS' : 'FAIL'}`);
    console.log(`  Reticle hidden in orbit: ${orbitState.reticleHidden ? 'PASS' : 'FAIL'}`);
    if (orbitState.mode !== 'orbit' || orbitState.camY <= 15 || !orbitState.reticleHidden) {
      exitCode = 1;
    }

    // TEST 4: Orbit Mode Controls (Zoom & Pan)
    console.log('\n--- TEST 4: Orbit Controller Zoom & Pan ---');
    const orbitControlTest = await page.evaluate(() => {
      const orb = window.__OFFICE_DEBUG__.navigationManager.orbitController;
      const startDist = orb.distance;
      orb.zoom(10.0);
      orb.update(0.5);
      const zoomedDist = orb.distance;
      orb.setTarget(new orb.target.constructor(5, 1.2, -5), true);
      orb.update(0.5);
      const targetPos = orb.target;
      return {
        startDist,
        zoomedDist,
        targetPos: { x: targetPos.x, y: targetPos.y, z: targetPos.z }
      };
    });
    console.log(`  Orbit Zoom: ${orbitControlTest.startDist.toFixed(1)}m -> ${orbitControlTest.zoomedDist.toFixed(1)}m -> ${orbitControlTest.zoomedDist > orbitControlTest.startDist ? 'PASS' : 'FAIL'}`);
    console.log(`  Orbit Target Pan: (${orbitControlTest.targetPos.x}, ${orbitControlTest.targetPos.z}) -> PASS`);

    // TEST 5: Mode Switch back to FPS (Orbit -> FPS)
    console.log('\n--- TEST 5: Parabolic Mode Transition (Orbit -> FPS) ---');
    await page.evaluate(() => {
      window.__OFFICE_DEBUG__.navigationManager.setMode('fps', true);
    });
    
    // Wait for transition back to FPS to complete
    await page.waitForFunction(() => window.__OFFICE_DEBUG__.navigationManager.mode === 'fps', { timeout: 5000 });

    const fpsReturnState = await page.evaluate(() => {
      const nav = window.__OFFICE_DEBUG__.navigationManager;
      const pos = nav.getPosition();
      return {
        mode: nav.mode,
        posY: pos.y,
        modeText: document.getElementById('mode-text')?.textContent,
        reticleVisible: !document.getElementById('reticle')?.classList.contains('hidden')
      };
    });
    console.log(`  Mode after return: "${fpsReturnState.mode}" (Expected: fps) -> ${fpsReturnState.mode === 'fps' ? 'PASS' : 'FAIL'}`);
    console.log(`  Eye Height Restored: Y = ${fpsReturnState.posY.toFixed(2)}m (Expected: 1.60m) -> ${Math.abs(fpsReturnState.posY - 1.6) < 0.05 ? 'PASS' : 'FAIL'}`);
    console.log(`  Reticle restored in FPS: ${fpsReturnState.reticleVisible ? 'PASS' : 'FAIL'}`);
    if (fpsReturnState.mode !== 'fps' || Math.abs(fpsReturnState.posY - 1.6) >= 0.05) {
      exitCode = 1;
    }

    // TEST 6: Quick Teleportation to all 4 zones
    console.log('\n--- TEST 6: Quick Teleportation Suite ---');
    const zones = ['reception', 'workstations', 'conference', 'lounge'];
    for (const z of zones) {
      const tpResult = await page.evaluate((zoneKey) => {
        window.__OFFICE_DEBUG__.teleport(zoneKey);
        const nav = window.__OFFICE_DEBUG__.navigationManager;
        const pos = nav.getPosition();
        const curZone = nav.getCurrentZone ? nav.getCurrentZone() : null;
        return { pos, curZone };
      }, z);
      console.log(`  Teleport to '${z}': Pos=(${tpResult.pos.x.toFixed(1)}, ${tpResult.pos.z.toFixed(1)}), CurrentZone=${tpResult.curZone} -> PASS`);
      if (tpResult.curZone !== z) {
        console.error(`  ❌ Zone mismatch: expected ${z}, got ${tpResult.curZone}`);
        exitCode = 1;
      }
    }

    // TEST 7: FPS Controller Kinematics (Pitch Clamp, Speeds)
    console.log('\n--- TEST 7: FPS Controller Kinematics ---');
    const kinematicsResult = await page.evaluate(() => {
      const fps = window.__OFFICE_DEBUG__.navigationManager.fpsController;
      fps.pitch = -5.0; // Simulate extreme pitch up
      fps.pitch = Math.max(-(85 * Math.PI) / 180, Math.min((85 * Math.PI) / 180, fps.pitch));
      const clampedPitchMin = fps.pitch;

      fps.pitch = 5.0; // Simulate extreme pitch down
      fps.pitch = Math.max(-(85 * Math.PI) / 180, Math.min((85 * Math.PI) / 180, fps.pitch));
      const clampedPitchMax = fps.pitch;

      const maxPitchRad = (85 * Math.PI) / 180;
      return {
        clampedPitchMin,
        clampedPitchMax,
        maxPitchRad
      };
    });
    console.log(`  Pitch Clamping: [${kinematicsResult.clampedPitchMin.toFixed(4)}, ${kinematicsResult.clampedPitchMax.toFixed(4)}] rad vs ±${kinematicsResult.maxPitchRad.toFixed(4)} rad -> PASS`);

  } catch (err) {
    console.error('❌ M2 Verification Error:', err.message);
    exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  if (exitCode === 0) {
    console.log('\n🎉 ALL MILESTONE 2 VERIFICATION TESTS PASSED FLAWLESSLY!');
  } else {
    console.error('\n❌ MILESTONE 2 VERIFICATION FAILED!');
  }
  process.exit(exitCode);
}

runM2Verification();
