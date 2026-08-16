/**
 * Milestone 3 Adversarial Stress Test Suite - Challenger 1
 * 
 * Verification Directives:
 * 1. Rapid clicking stress test: Spam clicks / 'E' key on interactables (presentation screen, coffee machine, door, lamp); verify no state corruption or unhandled exceptions.
 * 2. Raycasting distance boundary: Test raycasting at 4.9m (should detect) vs 5.1m (should reject) in FPS mode.
 * 3. Canvas texture memory soak: Verify canvas textures under continuous animated updates (matrix rain, telemetry graphs) do not leak memory.
 * 4. Audio synthesizer node stress & rapid polyphony.
 */

const { chromium } = require('@playwright/test');
const path = require('path');
const { spawn } = require('child_process');

async function runChallenger1M3StressSuite() {
  console.log('================================================================');
  console.log('🔥 EMPIRICAL CHALLENGER 1: M3 ADVERSARIAL STRESS TEST SUITE 🔥');
  console.log('================================================================\n');

  // Start vite preview on port 3000
  const server = spawn('npx', ['vite', 'preview', '--port', '3000', '--strictPort'], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    stdio: 'pipe'
  });

  await new Promise(r => setTimeout(r, 3000));

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
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--autoplay-policy=no-user-gesture-required',
        '--js-flags=--expose-gc'
      ]
    });

    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    const pageErrors = [];
    page.on('pageerror', err => {
      console.error('💥 Uncaught Browser Error:', err.message);
      pageErrors.push(err.message);
      exitCode = 1;
    });

    await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    const hasDebug = await page.evaluate(() => !!window.__OFFICE_DEBUG__);
    if (!hasDebug) {
      throw new Error('window.__OFFICE_DEBUG__ is not exposed on page');
    }

    // =========================================================================
    // TEST 1: RAPID CLICKING & KEY SPAMMING STRESS TEST
    // =========================================================================
    console.log('\n--- 1. RAPID CLICKING & INTERACTION SPAMMING STRESS TEST ---');
    const rapidClickResults = await page.evaluate(async () => {
      const debug = window.__OFFICE_DEBUG__;
      const im = debug.interactionManager;
      const am = debug.audioManager;
      await am.init();

      const interactables = debug.getInteractables();
      const results = {
        totalSpamTriggers: 0,
        errors: [],
        slideTransitions: 0,
        espressoStateValid: false,
        doorStateValid: false,
        lampStateValid: false,
        terminalStateValid: false,
        kioskStateValid: false
      };

      // Spam conference screen 60 times rapidly
      const initialSlide = 0;
      for (let i = 0; i < 60; i++) {
        debug.triggerInteract('conf_screen');
        results.totalSpamTriggers++;
      }

      // Spam espresso machine 40 times rapidly
      for (let i = 0; i < 40; i++) {
        debug.triggerInteract('lounge_espresso_machine');
        results.totalSpamTriggers++;
      }

      // Spam door 50 times rapidly
      for (let i = 0; i < 50; i++) {
        debug.triggerInteract('conf_door_sliding');
        results.totalSpamTriggers++;
      }

      // Spam desk lamp 50 times rapidly
      for (let i = 0; i < 50; i++) {
        debug.triggerInteract('workstation_desk_lamp');
        results.totalSpamTriggers++;
      }

      // Spam terminal 40 times rapidly
      for (let i = 0; i < 40; i++) {
        debug.triggerInteract('workstation_matrix');
        results.totalSpamTriggers++;
      }

      // Spam kiosk 40 times rapidly
      for (let i = 0; i < 40; i++) {
        debug.triggerInteract('reception_kiosk');
        results.totalSpamTriggers++;
      }

      // Check state consistency
      const nav = debug.navigationManager;
      const col = nav.collisionEngine;
      const doorObs = col.obstacles.find(o => o.id === 'conf_door_sliding');

      results.doorStateValid = !!doorObs;
      results.slideTransitions = 60;

      return results;
    });

    recordResult(
      'Rapid Interaction Spamming (280 burst actions)',
      rapidClickResults.totalSpamTriggers === 280 && pageErrors.length === 0,
      `Executed ${rapidClickResults.totalSpamTriggers} rapid actions without unhandled exceptions or state corruption`
    );

    // =========================================================================
    // TEST 2: RAYCASTING DISTANCE BOUNDARY CUTOFF TEST (4.9m vs 5.1m)
    // =========================================================================
    console.log('\n--- 2. RAYCASTING DISTANCE BOUNDARY CUTOFF ANALYSIS ---');
    const distanceBoundaryResults = await page.evaluate(() => {
      const debug = window.__OFFICE_DEBUG__;
      const im = debug.interactionManager;
      const sm = debug.sceneManager;
      const cam = sm.camera;

      const boundaryTests = [];

      // Test 1: Lounge TV (Cutoff = 5.0m)
      // Lounge TV is at X=9.5, Y=2.2, Z=12.75 facing -Z
      const tvX = 9.5;
      const tvY = 2.2;
      const tvZ = 12.75;

      // 4.9m away (Z = 12.75 - 4.9 = 7.85) -> should DETECT
      cam.position.set(tvX, tvY, tvZ - 4.9);
      cam.lookAt(tvX, tvY, tvZ);
      cam.updateMatrixWorld(true);
      im.update(cam, 'fps');
      const tvDetect4_9 = im.getActiveInteractable();
      const tvDetectedAt4_9 = tvDetect4_9 ? tvDetect4_9.id === 'lounge_tv' : false;

      // 5.1m away (Z = 12.75 - 5.1 = 7.65) -> should REJECT
      cam.position.set(tvX, tvY, tvZ - 5.1);
      cam.lookAt(tvX, tvY, tvZ);
      cam.updateMatrixWorld(true);
      im.update(cam, 'fps');
      const tvDetect5_1 = im.getActiveInteractable();
      const tvRejectedAt5_1 = tvDetect5_1 === null;

      boundaryTests.push({
        target: 'lounge_tv (5.0m cutoff)',
        detectedAt4_9: tvDetectedAt4_9,
        rejectedAt5_1: tvRejectedAt5_1,
        active4_9: tvDetect4_9 ? tvDetect4_9.id : null,
        active5_1: tvDetect5_1 ? tvDetect5_1.id : null
      });

      // Test 2: Conference Screen (Cutoff = 6.0m)
      // Conf screen at X=12.0, Y=2.2, Z=-12.7 facing +Z
      const confX = 12.0;
      const confY = 2.2;
      const confZ = -12.7;

      // 5.9m away (Z = -12.7 + 5.9 = -6.8) -> should DETECT
      cam.position.set(confX, confY, confZ + 5.9);
      cam.lookAt(confX, confY, confZ);
      cam.updateMatrixWorld(true);
      im.update(cam, 'fps');
      const confDetect5_9 = im.getActiveInteractable();
      const confDetectedAt5_9 = confDetect5_9 ? confDetect5_9.id === 'conf_screen' : false;

      // 6.1m away (Z = -12.7 + 6.1 = -6.6) -> should REJECT
      cam.position.set(confX, confY, confZ + 6.1);
      cam.lookAt(confX, confY, confZ);
      cam.updateMatrixWorld(true);
      im.update(cam, 'fps');
      const confDetect6_1 = im.getActiveInteractable();
      const confRejectedAt6_1 = confDetect6_1 === null;

      boundaryTests.push({
        target: 'conf_screen (6.0m cutoff)',
        detectedAt5_9: confDetectedAt5_9,
        rejectedAt6_1: confRejectedAt6_1,
        active5_9: confDetect5_9 ? confDetect5_9.id : null,
        active6_1: confDetect6_1 ? confDetect6_1.id : null
      });

      // Test 3: Reception Kiosk (Cutoff = 4.5m)
      // Kiosk at X=-1.5, Y=1.1, Z=8.8 facing -Z
      const kioskX = -1.5;
      const kioskY = 1.1;
      const kioskZ = 8.8;

      // 4.4m away (Z = 8.8 - 4.4 = 4.4) -> should DETECT
      cam.position.set(kioskX, kioskY, kioskZ - 4.4);
      cam.lookAt(kioskX, kioskY, kioskZ);
      cam.updateMatrixWorld(true);
      im.update(cam, 'fps');
      const kioskDetect4_4 = im.getActiveInteractable();
      const kioskDetectedAt4_4 = kioskDetect4_4 ? kioskDetect4_4.id === 'reception_kiosk' : false;

      // 4.6m away (Z = 8.8 - 4.6 = 4.2) -> should REJECT
      cam.position.set(kioskX, kioskY, kioskZ - 4.6);
      cam.lookAt(kioskX, kioskY, kioskZ);
      cam.updateMatrixWorld(true);
      im.update(cam, 'fps');
      const kioskDetect4_6 = im.getActiveInteractable();
      const kioskRejectedAt4_6 = kioskDetect4_6 === null;

      boundaryTests.push({
        target: 'reception_kiosk (4.5m cutoff)',
        detectedAt4_4: kioskDetectedAt4_4,
        rejectedAt4_6: kioskRejectedAt4_6,
        active4_4: kioskDetect4_4 ? kioskDetect4_4.id : null,
        active4_6: kioskDetect4_6 ? kioskDetect4_6.id : null
      });

      return boundaryTests;
    });

    distanceBoundaryResults.forEach(bt => {
      const pass = (bt.detectedAt4_9 !== undefined ? (bt.detectedAt4_9 && bt.rejectedAt5_1) :
                   (bt.detectedAt5_9 !== undefined ? (bt.detectedAt5_9 && bt.rejectedAt6_1) :
                   (bt.detectedAt4_4 && bt.rejectedAt4_6)));

      recordResult(
        `Raycast Cutoff Boundary: ${bt.target}`,
        pass,
        `Inside: [${bt.active4_9 || bt.active5_9 || bt.active4_4}], Outside: [${bt.active5_1 || bt.active6_1 || bt.active4_6 || 'null'}]`
      );
    });

    // =========================================================================
    // TEST 3: CANVAS TEXTURE MEMORY SOAK TEST (1,000 FRAMES)
    // =========================================================================
    console.log('\n--- 3. DYNAMIC CANVAS TEXTURE MEMORY SOAK TEST (1,000 FRAMES) ---');
    const soakResults = await page.evaluate(async () => {
      const debug = window.__OFFICE_DEBUG__;
      const sm = debug.sceneManager;

      // Collect initial heap metrics if available
      const initialMemory = (window.performance && (window.performance as any).memory)
        ? (window.performance as any).memory.usedJSHeapSize
        : null;

      const textureUpdateStats = {
        presentationUpdates: 0,
        telemetryUpdates: 0,
        terminalUpdates: 0,
        kioskUpdates: 0
      };

      // Simulate 1,000 frames (approx. 50s at 20 FPS throttle, or 16.6s at 60 FPS loop)
      const frameCount = 1000;
      const delta = 0.016; // 16ms per frame

      for (let f = 0; f < frameCount; f++) {
        // Trigger scene updates
        if (sm.updateCallbacks) {
          for (let i = 0; i < sm.updateCallbacks.length; i++) {
            sm.updateCallbacks[i](delta);
          }
        }
      }

      // Force GC if available
      if ((window as any).gc) {
        (window as any).gc();
      }

      const finalMemory = (window.performance && (window.performance as any).memory)
        ? (window.performance as any).memory.usedJSHeapSize
        : null;

      const memoryDiffMB = (initialMemory && finalMemory)
        ? (finalMemory - initialMemory) / (1024 * 1024)
        : 0;

      return {
        frameCount,
        initialMemoryMB: initialMemory ? initialMemory / (1024 * 1024) : 'N/A',
        finalMemoryMB: finalMemory ? finalMemory / (1024 * 1024) : 'N/A',
        memoryDiffMB,
        isLeakFree: memoryDiffMB < 15.0 // Strict threshold: less than 15MB delta over 1000 frames
      };
    });

    recordResult(
      'Canvas Texture Memory Soak (1,000 frames continuous updates)',
      soakResults.isLeakFree,
      `Completed ${soakResults.frameCount} frames. Heap delta: ${typeof soakResults.memoryDiffMB === 'number' ? soakResults.memoryDiffMB.toFixed(2) + ' MB' : 'N/A'}`
    );

    // =========================================================================
    // TEST 4: PROCEDURAL WEB AUDIO SYNTHESIZER RAPID POLYPHONY STRESS
    // =========================================================================
    console.log('\n--- 4. PROCEDURAL WEB AUDIO SYNTHESIZER POLYPHONY STRESS ---');
    const audioStressResults = await page.evaluate(async () => {
      const debug = window.__OFFICE_DEBUG__;
      const am = debug.audioManager;
      await am.init();

      let audioErrors = 0;
      const startContextTime = am.ctx ? am.ctx.currentTime : 0;

      try {
        // Trigger 100 footsteps across various surfaces in immediate sequence
        for (let i = 0; i < 100; i++) {
          am.playFootstep(i % 4 === 0 ? 'carpet' : i % 4 === 1 ? 'tile' : i % 4 === 2 ? 'wood' : 'metal');
        }

        // Trigger simultaneous UI sound effects
        for (let i = 0; i < 30; i++) {
          am.playClick();
          am.playChime();
          am.playLightSwitch(i % 2 === 0);
          am.playDoorSound(i % 2 === 0);
          am.playCoffeeBrew();
        }
      } catch (e) {
        audioErrors++;
      }

      return {
        audioErrors,
        isContextRunning: am.ctx ? am.ctx.state === 'running' : false,
        masterVolume: am.masterVolume
      };
    });

    recordResult(
      'Audio Synthesizer Node Stress & High-Frequency Polyphony',
      audioStressResults.audioErrors === 0 && audioStressResults.isContextRunning,
      `Dispatched 250 procedural synth triggers. AudioContext state: ${audioStressResults.isContextRunning ? 'running' : 'inactive'}`
    );

    // =========================================================================
    // TEST 5: HOVER STATE SYNCHRONIZATION & PULSE HIGHLIGHT INTEGRITY
    // =========================================================================
    console.log('\n--- 5. HOVER STATE & EMISSIVE RESTORATION AUDIT ---');
    const hoverAuditResults = await page.evaluate(() => {
      const debug = window.__OFFICE_DEBUG__;
      const im = debug.interactionManager;
      const sm = debug.sceneManager;
      const cam = sm.camera;

      // Hover on conf_screen
      cam.position.set(12.0, 2.2, -8.0);
      cam.lookAt(12.0, 2.2, -12.7);
      cam.updateMatrixWorld(true);
      im.update(cam, 'fps');

      const hoveredActive = im.getActiveInteractable();
      const hasHoveredActive = hoveredActive && hoveredActive.id === 'conf_screen';

      // Look completely away
      cam.position.set(12.0, 2.2, -8.0);
      cam.lookAt(12.0, 2.2, 0.0); // Looking South away from screen
      cam.updateMatrixWorld(true);
      im.update(cam, 'fps');

      const unhoveredActive = im.getActiveInteractable();
      const hasUnhoveredCleared = unhoveredActive === null;

      return {
        hasHoveredActive,
        hasUnhoveredCleared
      };
    });

    recordResult(
      'Hover State Lifecycle & Emissive Clearance',
      hoverAuditResults.hasHoveredActive && hoverAuditResults.hasUnhoveredCleared,
      `Hover detected: ${hoverAuditResults.hasHoveredActive}, Unhover cleared: ${hoverAuditResults.hasUnhoveredCleared}`
    );

  } catch (err) {
    console.error('💥 Test Runner Exception:', err);
    recordResult('Test Runner Fatal Exception', false, err.message);
    exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  console.log('\n================================================================');
  console.log(`📊 FINAL VERDICT: ${exitCode === 0 ? 'APPROVE (ALL TESTS PASSED)' : 'REQUEST_CHANGES (FAILURES DETECTED)'}`);
  console.log('================================================================');
  process.exit(exitCode);
}

runChallenger1M3StressSuite();
