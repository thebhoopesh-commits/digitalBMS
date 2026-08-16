import { SceneManager } from './scene/SceneManager';
import { LightingManager } from './scene/LightingManager';
import { Materials } from './scene/Materials';
import { OfficeFloorplan } from './scene/OfficeFloorplan';
import { NavigationManager } from './navigation/NavigationManager';
import { AudioManager } from './audio/AudioManager';
import { InteractionManager } from './interaction/InteractionManager';
import { InteractiveProps } from './interaction/InteractiveProps';
import { ChatManager } from './interaction/ChatManager';
import { Minimap } from './hud/Minimap';
import { HVACDataStore } from './data/HVACDataStore';
import { IOfficeDebug, LightingPresetName } from './types';

async function bootstrap() {
  console.log('🏗️ Initializing Aura Corp 3D Office Application...');

  // 1. Resolve DOM Containers
  const webglContainer = document.getElementById('webgl-container') || document.body;

  // 2. Initialize Scene Manager
  const sceneManager = new SceneManager();
  sceneManager.init(webglContainer);

  // 3. Initialize Procedural Materials
  const materials = Materials.getInstance();

  // 4. Initialize Atmospheric Lighting Rig
  const lightingManager = new LightingManager(sceneManager.scene, sceneManager.renderer);
  sceneManager.lightingManager = lightingManager;
  lightingManager.setPreset('day', 0);

  // 5. Build 3D Multi-Zone Office Floorplan
  const floorplan = new OfficeFloorplan(materials);
  floorplan.build();
  sceneManager.scene.add(floorplan.group);

  // 6. Initialize Dual Navigation & Collision Subsystem
  const navigationManager = new NavigationManager(sceneManager.scene, sceneManager.camera);
  navigationManager.init(webglContainer);

  // Register all architectural & furniture obstacles from floorplan into collision engine
  const obstacles = floorplan.getObstacles();
  for (const obs of obstacles) {
    navigationManager.addObstacle(obs.box, obs.name, obs.id, obs.isDoor);
  }

  // 7. Initialize Audio & Interaction Subsystems
  const audioManager = new AudioManager();
  const interactionManager = new InteractionManager();
  const interactiveProps = new InteractiveProps(
    sceneManager.scene,
    floorplan,
    interactionManager,
    audioManager,
    materials,
    navigationManager
  );
  interactiveProps.init();

  // Wire door state toggle directly to collision engine
  interactiveProps.onDoorToggle = (doorId, isOpen) => {
    navigationManager.collisionEngine.setDoorOpen(doorId, isOpen);
  };

  // Wire footsteps from player movement to procedural audio synthesizer
  navigationManager.onFootstep = (surface) => {
    audioManager.playFootstep(surface);
  };

  // 7b. Initialize Minimap Renderer
  const minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement | null;
  const minimap = minimapCanvas ? new Minimap(minimapCanvas) : null;

  // 7c. Initialize Chat Manager
  const chatManager = new ChatManager();

  // 8. Wire Subsystems Update Hooks in Main Render Loop
  let time = 0;
  let lastUpdate = 0;
  const hvacStore = new HVACDataStore();

  sceneManager.registerUpdateCallback((delta) => {
    time += delta;
    
    navigationManager.update(delta);
    interactionManager.update(sceneManager.camera, navigationManager.mode);
    interactiveProps.update(delta);
    hvacStore.update(delta);

    // Update minimap with current player position and facing direction
    if (minimap) {
      const pos = navigationManager.getPosition();
      minimap.update(pos.x, pos.z, navigationManager.getYaw());
    }

    // Update HVAC mock data at 2 FPS to avoid canvas drawing overhead
    if (time - lastUpdate > 0.5) {
      lastUpdate = time;
      if (floorplan.commandGlass) {
        floorplan.commandGlass.updateData(hvacStore.getCommandData());
      }
      
      Object.keys(floorplan.glassBoards).forEach(zone => {
        const data = hvacStore.getZoneData(zone);
        if (data) {
          floorplan.glassBoards[zone].updateData(data);
        }
      });
    }
  });

  // 9. Wire HUD Mode Badge and Reticle
  navigationManager.onModeChange = (mode) => {
    const modeBadge = document.getElementById('mode-text');
    const btnMode = document.getElementById('btn-mode-toggle');
    const reticle = document.getElementById('reticle');

    if (mode === 'orbit') {
      if (modeBadge) modeBadge.textContent = 'ORBIT OVERVIEW';
      if (btnMode) {
        const txt = btnMode.querySelector('.btn-text');
        if (txt) txt.textContent = 'FPS View [V]';
      }
      if (reticle) reticle.classList.add('hidden');
    } else if (mode === 'fps') {
      if (modeBadge) modeBadge.textContent = 'FPS WALKTHROUGH';
      if (btnMode) {
        const txt = btnMode.querySelector('.btn-text');
        if (txt) txt.textContent = 'Orbit View [V]';
      }
      if (reticle) reticle.classList.remove('hidden');
    } else if (mode === 'focus') {
      if (modeBadge) modeBadge.textContent = 'DASHBOARD FOCUS';
      if (btnMode) {
        const txt = btnMode.querySelector('.btn-text');
        if (txt) txt.textContent = 'Exit Focus [B]';
      }
      if (reticle) reticle.classList.add('hidden');
    } else {
      if (modeBadge) modeBadge.textContent = 'TRANSITIONING...';
      if (reticle) reticle.classList.add('hidden');
    }
  };

  // 10. Wire Zone Banner Update
  navigationManager.onZoneChange = (_zoneId, zoneData) => {
    const zoneText = document.getElementById('zone-text');
    if (zoneText) zoneText.textContent = zoneData.displayName;
  };

  // 11. View Mode Toggle
  const toggleViewMode = () => {
    if (navigationManager.mode === 'fps') {
      navigationManager.setMode('orbit', true);
    } else if (navigationManager.mode === 'orbit' || navigationManager.mode === 'focus') {
      navigationManager.setMode('fps', true);
    }
  };

  // 12. Modal and Drawer Toggles
  const toggleSettingsDrawer = () => {
    const drawer = document.getElementById('settings-drawer');
    if (drawer) {
      drawer.classList.toggle('hidden');
    }
  };

  const toggleHelpModal = () => {
    const modal = document.getElementById('help-modal');
    if (modal) {
      modal.classList.toggle('hidden');
    }
  };

  const toggleMute = () => {
    const isMuted = audioManager.toggleMute();
    const audioIcon = document.getElementById('audio-icon');
    if (audioIcon) {
      audioIcon.textContent = isMuted ? '🔇' : '🔊';
    }
  };

  // 13. Keyboard Controls & Shortcuts
  window.addEventListener('keydown', (e) => {
    // If the user is typing in the chat drawer (or any input), ignore hotkeys EXCEPT Escape/C for closing
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      if (e.key === 'Escape' && chatManager.isDrawerOpen()) {
        chatManager.toggleDrawer();
      }
      return;
    }

    switch (e.key) {
      case 'b':
      case 'B':
        if (navigationManager.mode === 'focus') {
          navigationManager.exitFocusMode();
        }
        break;
      case '1':
        navigationManager.teleportTo('lobby', true);
        break;
      case '2':
        navigationManager.teleportTo('open_office', true);
        break;
      case '3':
        navigationManager.teleportTo('conference_room', true);
        break;
      case 'v':
      case 'V':
        toggleViewMode();
        break;
      case 'o':
      case 'O':
        toggleSettingsDrawer();
        break;
      case 'c':
      case 'C':
        chatManager.toggleDrawer();
        break;
      case 'h':
      case 'H':
        toggleHelpModal();
        break;
      case 'm':
      case 'M':
        toggleMute();
        break;
    }
  });

  // 14. Wire HUD UI Buttons
  document.getElementById('btn-start-app')?.addEventListener('click', async () => {
    const overlay = document.getElementById('overlay-start');
    if (overlay) {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.classList.add('hidden'), 400);
    }
    
    // Start backend simulation
    fetch('/api/simulation/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', speed: 1.0 })
    }).catch(err => console.error("Failed to start backend simulation:", err));

    await audioManager.init();
    audioManager.setAmbientEnabled(true);
    navigationManager.fpsController.lock();
  });

  document.getElementById('btn-mode-toggle')?.addEventListener('click', toggleViewMode);
  document.getElementById('btn-settings')?.addEventListener('click', toggleSettingsDrawer);
  document.getElementById('btn-close-settings')?.addEventListener('click', toggleSettingsDrawer);
  document.getElementById('btn-chat')?.addEventListener('click', () => chatManager.toggleDrawer());
  document.getElementById('btn-help')?.addEventListener('click', toggleHelpModal);
  document.getElementById('btn-close-help')?.addEventListener('click', toggleHelpModal);
  document.getElementById('btn-ack-help')?.addEventListener('click', toggleHelpModal);
  document.getElementById('btn-audio-mute')?.addEventListener('click', toggleMute);

  // Quick Teleport Buttons
  document.querySelectorAll('.teleport-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const zone = btn.getAttribute('data-zone');
      if (zone) navigationManager.teleportTo(zone, true);
    });
  });

  // Lighting Preset Buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const preset = btn.getAttribute('data-preset') as LightingPresetName;
      if (preset) {
        sceneManager.setLightingPreset(preset);
      }
    });
  });

  // 15. Per-Frame UI Telemetry Hook
  const fpsStat = document.getElementById('fps-stat');
  const drawStat = document.getElementById('draw-stat');
  const polyStat = document.getElementById('poly-stat');

  sceneManager.registerUpdateCallback(() => {
    if (fpsStat) fpsStat.textContent = `${sceneManager.getFPS()} FPS`;
    if (drawStat) drawStat.textContent = `${sceneManager.getDrawCalls()} DC`;
    if (polyStat) polyStat.textContent = `${Math.round(sceneManager.getTriangleCount() / 1000)}k Tri`;
  });

  // 16. window.__OFFICE_DEBUG__ Automation Contract
  const debugContract: IOfficeDebug = {
    sceneManager,
    navigationManager,
    interactionManager,
    audioManager,
    getFPS: () => sceneManager.getFPS(),
    getDrawCalls: () => sceneManager.getDrawCalls(),
    getTriangleCount: () => sceneManager.getTriangleCount(),
    getPlayerPosition: () => {
      const pos = navigationManager.getPosition();
      return {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        yaw: navigationManager.getYaw()
      };
    },
    getInteractables: () => interactionManager.getInteractableIds(),
    triggerInteract: (id: string) => {
      console.log(`[Debug] Triggered interaction on ${id}`);
      return interactionManager.triggerAction(id);
    },
    teleport: (zone: string) => {
      navigationManager.teleportTo(zone, false);
      return true;
    },
    setLighting: (preset: string) => {
      if (['day', 'sunset', 'night'].includes(preset)) {
        sceneManager.setLightingPreset(preset as LightingPresetName);
        return true;
      }
      return false;
    },
    setMode: (mode: string) => {
      if (mode === 'fps' || mode === 'orbit') {
        navigationManager.setMode(mode as any, false);
        return true;
      }
      return false;
    }
  };

  (window as any).__OFFICE_DEBUG__ = debugContract;

  // 17. Start Rendering Loop
  sceneManager.start();
  console.log('🚀 Aura Corp 3D Virtual Headquarters engine running successfully with Interactive Objects & Audio.');
}

window.addEventListener('DOMContentLoaded', bootstrap);
