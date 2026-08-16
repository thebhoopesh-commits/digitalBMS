/**
 * Target Isolation Test for OrbitController syncFromCamera / endTransitionImmediate
 */
const { chromium } = require('@playwright/test');
const path = require('path');
const { spawn } = require('child_process');

async function testSyncFromCameraVulnerability() {
  console.log('🔍 Running Targeted Isolation Test for OrbitController.syncFromCamera & endTransitionImmediate...\n');

  const server = spawn('npx', ['vite', 'preview', '--port', '3000', '--strictPort'], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    stdio: 'pipe'
  });

  await new Promise(r => setTimeout(r, 2000));

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);

    const isolationResults = await page.evaluate(() => {
      const debug = window.__OFFICE_DEBUG__;
      const nav = debug.navigationManager;
      const orb = nav.orbitController;
      const cam = debug.sceneManager.camera;

      // 1. Initial state (FPS)
      const initialMode = nav.mode;

      // 2. Perform immediate mode switch to orbit (setMode('orbit', false))
      nav.setMode('orbit', false);
      
      const afterImmediateSwitch = {
        mode: nav.mode,
        cameraPos: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
        polarAngle: orb.polarAngle,
        polarAngleDeg: (orb.polarAngle * 180 / Math.PI),
        distance: orb.distance,
        targetDistance: orb.targetDistance,
        minPolarAngle: orb.minPolarAngle,
        maxPolarAngle: orb.maxPolarAngle,
        minDistance: orb.minDistance,
        maxDistance: orb.maxDistance,
        isPolarInverted: orb.polarAngle > orb.maxPolarAngle,
        isDistanceViolated: orb.distance < orb.minDistance
      };

      // 3. Test syncFromCamera directly with camera below target
      cam.position.set(0, -5, 0);
      orb.syncFromCamera();

      const afterDirectSyncBelowTarget = {
        polarAngle: orb.polarAngle,
        polarAngleDeg: (orb.polarAngle * 180 / Math.PI),
        distance: orb.distance,
        isPolarInverted: orb.polarAngle > orb.maxPolarAngle
      };

      return {
        initialMode,
        afterImmediateSwitch,
        afterDirectSyncBelowTarget
      };
    });

    console.log('Isolation Test Output:');
    console.log(JSON.stringify(isolationResults, null, 2));

  } catch (err) {
    console.error('Error during isolation test:', err);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

testSyncFromCameraVulnerability();
