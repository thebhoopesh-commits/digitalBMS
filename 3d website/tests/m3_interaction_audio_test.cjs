const { chromium } = require('@playwright/test');
const path = require('path');
const { spawn } = require('child_process');

async function runM3Verification() {
  console.log('🧪 Starting Milestone 3 (Interactive Objects, Dynamic Displays & Web Audio) Verification Suite...\n');

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
    console.log('🚀 Launching Headless Chromium for M3 Verification...');
    browser = await chromium.launch({
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
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

    // TEST 1: Subsystem Initialization & Automation Contract
    console.log('\n--- TEST 1: Subsystems & Automation Contract ---');
    const initCheck = await page.evaluate(() => {
      const debug = window.__OFFICE_DEBUG__;
      const hasDebug = !!debug;
      const hasInteraction = !!(debug && debug.interactionManager);
      const hasAudio = !!(debug && debug.audioManager);
      const interactables = debug ? debug.getInteractables() : [];

      return {
        hasDebug,
        hasInteraction,
        hasAudio,
        interactableCount: interactables.length,
        interactables
      };
    });

    console.log(`  Debug Interface Present: ${initCheck.hasDebug ? 'PASS' : 'FAIL'}`);
    console.log(`  InteractionManager Present: ${initCheck.hasInteraction ? 'PASS' : 'FAIL'}`);
    console.log(`  AudioManager Present: ${initCheck.hasAudio ? 'PASS' : 'FAIL'}`);
    console.log(`  Registered Hotspots (${initCheck.interactableCount}): [${initCheck.interactables.join(', ')}] -> ${initCheck.interactableCount >= 6 ? 'PASS' : 'FAIL'}`);

    if (!initCheck.hasDebug || !initCheck.hasInteraction || !initCheck.hasAudio || initCheck.interactableCount < 6) {
      exitCode = 1;
    }

    // TEST 2: Procedural Web Audio API Engine
    console.log('\n--- TEST 2: Procedural Web Audio API Engine ---');
    const audioResults = await page.evaluate(async () => {
      const audio = window.__OFFICE_DEBUG__.audioManager;
      await audio.init();

      // Test volume & mute controls
      const initialVol = audio.masterVolume;
      audio.setMasterVolume(0.45);
      const updatedVol = audio.masterVolume;

      const mute1 = audio.toggleMute();
      const mute1State = audio.isMuted;
      const mute2 = audio.toggleMute();
      const mute2State = audio.isMuted;

      // Test sound triggers (synthesizer nodes construction)
      let sfxPassed = true;
      try {
        audio.playFootstep('carpet');
        audio.playFootstep('tile');
        audio.playFootstep('wood');
        audio.playFootstep('metal');
        audio.playClick();
        audio.playChime();
        audio.playCoffeeBrew();
        audio.playDoorSound(true);
        audio.playDoorSound(false);
        audio.playLightSwitch(true);
        audio.setAmbientEnabled(true);
      } catch (e) {
        console.error('Audio sfx exception:', e);
        sfxPassed = false;
      }

      return {
        initialVol,
        updatedVol,
        mute1,
        mute1State,
        mute2,
        mute2State,
        sfxPassed
      };
    });

    console.log(`  Volume Control: ${audioResults.initialVol} -> ${audioResults.updatedVol} -> ${audioResults.updatedVol === 0.45 ? 'PASS' : 'FAIL'}`);
    console.log(`  Mute Toggle: ${audioResults.mute1State} -> ${audioResults.mute2State} -> ${audioResults.mute1State === true && audioResults.mute2State === false ? 'PASS' : 'FAIL'}`);
    console.log(`  Procedural Synthesis Pipeline: ${audioResults.sfxPassed ? 'PASS' : 'FAIL'}`);

    if (audioResults.updatedVol !== 0.45 || !audioResults.mute1State || audioResults.mute2State || !audioResults.sfxPassed) {
      exitCode = 1;
    }

    // TEST 3: Dynamic 2D Canvas Presentation Screen (Multi-Slide Deck)
    console.log('\n--- TEST 3: Dynamic Presentation Screen & Slide Deck ---');
    const presResults = await page.evaluate(() => {
      const debug = window.__OFFICE_DEBUG__;
      const im = debug.interactionManager;
      const interactables = im.getInteractables();
      const confScreen = interactables.find(i => (typeof i === 'string' ? i : i.id) === 'conf_screen');

      // Trigger interaction on conference screen
      const beforeSlide = 0;
      debug.triggerInteract('conf_screen');

      // Advance again
      debug.triggerInteract('conf_screen');

      return {
        hasConfScreen: !!confScreen
      };
    });

    console.log(`  Conference Screen Hotspot Registered: ${presResults.hasConfScreen ? 'PASS' : 'FAIL'}`);
    if (!presResults.hasConfScreen) {
      exitCode = 1;
    }

    // TEST 4: Appliance Interaction (Espresso Machine & Steam Particles)
    console.log('\n--- TEST 4: Appliance Hotspot (Commercial Espresso Machine) ---');
    const espressoResults = await page.evaluate(() => {
      const debug = window.__OFFICE_DEBUG__;
      const triggered = debug.triggerInteract('lounge_espresso_machine');
      return {
        triggered
      };
    });

    console.log(`  Espresso Machine Trigger: ${espressoResults.triggered ? 'PASS' : 'FAIL'}`);
    if (!espressoResults.triggered) {
      exitCode = 1;
    }

    // TEST 5: Sliding Door Animation & Collision Physics State
    console.log('\n--- TEST 5: Glass Sliding Door Animation & Obstacle Sync ---');
    const doorResults = await page.evaluate(() => {
      const debug = window.__OFFICE_DEBUG__;
      const nav = debug.navigationManager;
      const col = nav.collisionEngine;

      const doorObsBefore = col.obstacles.find(o => o.id === 'conf_door_sliding');
      const wasOpenBefore = doorObsBefore ? doorObsBefore.isOpen : false;

      // Trigger door open
      debug.triggerInteract('conf_door_sliding');

      const doorObsAfter = col.obstacles.find(o => o.id === 'conf_door_sliding');
      const isOpenAfter = doorObsAfter ? doorObsAfter.isOpen : false;

      return {
        wasOpenBefore,
        isOpenAfter
      };
    });

    console.log(`  Door Obstacle State: Closed (${!doorResults.wasOpenBefore}) -> Open (${doorResults.isOpenAfter}) -> ${!doorResults.wasOpenBefore && doorResults.isOpenAfter ? 'PASS' : 'FAIL'}`);
    if (doorResults.wasOpenBefore || !doorResults.isOpenAfter) {
      exitCode = 1;
    }

    // TEST 6: Raycasting & Hover Reticle Simulation
    console.log('\n--- TEST 6: Raycasting & Hover Reticle Feedback ---');
    const raycastResults = await page.evaluate(() => {
      const debug = window.__OFFICE_DEBUG__;
      const nav = debug.navigationManager;
      const im = debug.interactionManager;
      const cam = debug.sceneManager.camera;

      // Teleport right in front of conference screen looking at it
      nav.setPosition(new cam.position.constructor(12.0, 1.6, -10.5), Math.PI); // Facing -Z towards display at Z=-12.75
      im.update(cam, 'fps');

      const active = im.getActiveInteractable();
      const reticleHover = document.getElementById('reticle')?.classList.contains('reticle-hover');
      const promptVisible = !document.getElementById('interaction-prompt')?.classList.contains('hidden');
      const promptText = document.getElementById('prompt-action-text')?.textContent;

      return {
        activeId: active ? active.id : null,
        activeName: active ? active.name : null,
        reticleHover,
        promptVisible,
        promptText
      };
    });

    console.log(`  Active Raycast Target: ${raycastResults.activeId} ("${raycastResults.activeName}")`);
    console.log(`  Reticle Pulse State: ${raycastResults.reticleHover ? 'PASS' : 'FAIL'}`);
    console.log(`  Interaction Prompt: "${raycastResults.promptText}" (Visible: ${raycastResults.promptVisible ? 'PASS' : 'FAIL'})`);

    if (!raycastResults.activeId || !raycastResults.reticleHover || !raycastResults.promptVisible) {
      exitCode = 1;
    }

    // TEST 7: Workstation Dynamic Telemetry & Terminal Streams
    console.log('\n--- TEST 7: Workstation Telemetry & Terminal Dashboards ---');
    const wsResults = await page.evaluate(() => {
      const debug = window.__OFFICE_DEBUG__;
      const im = debug.interactionManager;

      // Trigger telemetry & terminal actions
      const telemTriggered = debug.triggerInteract('workstation_monitors');
      const termTriggered = debug.triggerInteract('workstation_matrix');
      const lampTriggered = debug.triggerInteract('workstation_desk_lamp');

      return {
        telemTriggered,
        termTriggered,
        lampTriggered
      };
    });

    console.log(`  Telemetry Monitor Hotspot: ${wsResults.telemTriggered ? 'PASS' : 'FAIL'}`);
    console.log(`  Terminal Matrix Hotspot: ${wsResults.termTriggered ? 'PASS' : 'FAIL'}`);
    console.log(`  Desk Lamp Hotspot: ${wsResults.lampTriggered ? 'PASS' : 'FAIL'}`);

    if (!wsResults.telemTriggered || !wsResults.termTriggered || !wsResults.lampTriggered) {
      exitCode = 1;
    }

  } catch (err) {
    console.error('❌ M3 Verification Error:', err.message);
    exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  if (exitCode === 0) {
    console.log('\n🎉 ALL MILESTONE 3 VERIFICATION TESTS PASSED FLAWLESSLY!');
  } else {
    console.error('\n❌ MILESTONE 3 VERIFICATION FAILED!');
  }
  process.exit(exitCode);
}

runM3Verification();
