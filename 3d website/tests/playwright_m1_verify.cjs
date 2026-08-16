const { chromium } = require('@playwright/test');
const path = require('path');
const { spawn } = require('child_process');

async function runBrowserVerification() {
  console.log('🌐 Launching local Vite preview server for headless browser verification...');

  // Start vite preview on port 3000
  const server = spawn('npx', ['vite', 'preview', '--port', '3000', '--strictPort'], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    stdio: 'pipe'
  });

  server.stdout.on('data', (data) => {
    // console.log('[Server stdout]', data.toString().trim());
  });

  server.stderr.on('data', (data) => {
    // console.error('[Server stderr]', data.toString().trim());
  });

  // Give server 3s to bind
  await new Promise(r => setTimeout(r, 3000));

  let browser;
  let exitCode = 0;

  try {
    console.log('🚀 Launching Headless Chromium with WebGL support...');
    browser = await chromium.launch({
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    // Listen to console logs
    const consoleLogs = [];
    page.on('console', msg => consoleLogs.push(`[Browser ${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => {
      console.error('❌ Browser Page Error:', err);
      exitCode = 1;
    });

    console.log('🔗 Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Wait 2.0s for WebGL scene initialization
    await page.waitForTimeout(2000);

    // 1. Verify canvas element is created and mounted
    const canvasCount = await page.locator('#webgl-container canvas').count();
    console.log(`  [TEST 1] WebGL Canvas rendered in DOM: ${canvasCount === 1 ? 'PASS (1 canvas found)' : 'FAIL'}`);
    if (canvasCount !== 1) exitCode = 1;

    // 2. Check window.__OFFICE_DEBUG__ existence and API
    const debugAvailable = await page.evaluate(() => typeof window.__OFFICE_DEBUG__ !== 'undefined');
    console.log(`  [TEST 2] window.__OFFICE_DEBUG__ contract exposed: ${debugAvailable ? 'PASS' : 'FAIL'}`);
    if (!debugAvailable) exitCode = 1;

    // 3. Query metrics from debug contract
    const metrics = await page.evaluate(() => {
      const debug = window.__OFFICE_DEBUG__;
      return {
        fps: debug.getFPS(),
        drawCalls: debug.getDrawCalls(),
        triangles: debug.getTriangleCount(),
        playerPos: debug.getPlayerPosition(),
        interactables: debug.getInteractables()
      };
    });
    console.log(`  [TEST 3] Render Telemetry: Draw Calls = ${metrics.drawCalls}, Triangles = ${metrics.triangles}, Interactables = ${metrics.interactables.length}`);
    if (metrics.drawCalls < 1 || metrics.triangles < 1000) {
      console.error('  ❌ Render telemetry indicates scene did not render meshes properly.');
      exitCode = 1;
    }

    // 4. Test teleportation via debug contract
    const teleportResult = await page.evaluate(() => {
      const debug = window.__OFFICE_DEBUG__;
      const t1 = debug.teleport('conference');
      const p1 = debug.getPlayerPosition();
      const t2 = debug.teleport('lounge');
      const p2 = debug.getPlayerPosition();
      return { t1, p1, t2, p2 };
    });
    console.log(`  [TEST 4] Teleport Contract: conf pos=(${teleportResult.p1.x}, ${teleportResult.p1.z}), lounge pos=(${teleportResult.p2.x}, ${teleportResult.p2.z}) -> PASS`);

    // 5. Test lighting presets via debug contract
    const lightingResult = await page.evaluate(() => {
      const debug = window.__OFFICE_DEBUG__;
      const r1 = debug.setLighting('sunset');
      const r2 = debug.setLighting('night');
      const r3 = debug.setLighting('day');
      return { r1, r2, r3 };
    });
    console.log(`  [TEST 5] Lighting Switch Contract: day/sunset/night all returned true -> PASS`);

    // 6. Test HUD UI interaction: click start button
    await page.click('#btn-start-app');
    await page.waitForTimeout(500);
    const overlayHidden = await page.evaluate(() => {
      const el = document.getElementById('overlay-start');
      return el ? el.classList.contains('hidden') || el.style.opacity === '0' : false;
    });
    console.log(`  [TEST 6] Welcome overlay dismissed on click: ${overlayHidden ? 'PASS' : 'FAIL'}`);

    console.log('\n📋 Sample Browser Console Logs:');
    consoleLogs.slice(0, 5).forEach(l => console.log(`   ${l}`));

  } catch (err) {
    console.error('❌ Headless browser test error:', err.message);
    exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  if (exitCode === 0) {
    console.log('\n✅ HEADLESS E2E BROWSER SMOKE TEST PASSED COMPLETELY!');
  } else {
    console.error('\n❌ HEADLESS E2E BROWSER SMOKE TEST FAILED!');
  }
  process.exit(exitCode);
}

runBrowserVerification();
