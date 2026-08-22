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
import { NPCManager } from './scene/NPCManager';
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
  const chatManager = new ChatManager(() => navigationManager.getCurrentZone());

  // 8. Wire Subsystems Update Hooks in Main Render Loop
  let time = 0;
  let lastUpdate = 0;
  const hvacStore = new HVACDataStore();
  const npcManager = new NPCManager(sceneManager.scene, hvacStore);

  sceneManager.registerUpdateCallback((delta) => {
    time += delta;
    
    navigationManager.update(delta);
    interactionManager.update(sceneManager.camera, navigationManager.mode);
    interactiveProps.update(delta);
    hvacStore.update(delta);
    npcManager.update(delta);

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
  navigationManager.onZoneChange = (zoneId: string, zoneData: any) => {
    const zoneText = document.getElementById('zone-text');
    if (zoneText) zoneText.textContent = zoneData.displayName;
    // Live temp will be updated each frame in the render callback below
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

  const toggleActivityDrawer = () => {
    const drawer = document.getElementById('activity-drawer');
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

  const toggleTVDashboard = () => {
    const overlay = document.getElementById('tv-dashboard-overlay');
    if (overlay) {
      overlay.classList.toggle('hidden');
      if (!overlay.classList.contains('hidden')) {
        navigationManager.fpsController.unlock();
      }
    }
  };
  
  document.addEventListener('open-tv-dashboard', () => {
    const overlay = document.getElementById('tv-dashboard-overlay');
    if (overlay && overlay.classList.contains('hidden')) {
      toggleTVDashboard();
    }
  });

  document.addEventListener('open-centered-chat', () => {
    const chat = document.getElementById('chat-drawer');
    if (chat) {
      chat.classList.add('chat-centered');
      chat.classList.remove('hidden');
      navigationManager.fpsController.unlock();
    }
  });

  const toggleMute = () => {
    const isMuted = audioManager.toggleMute();
    const audioIcon = document.getElementById('audio-icon');
    if (audioIcon) {
      audioIcon.textContent = isMuted ? '🔇' : '🔊';
    }
  };

  // 12b. Toast Notifications
  document.addEventListener('temp-setpoint-changed', (e: any) => {
    const detail = e.detail;
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    // Format Zone Name
    const zoneName = detail.zone.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    
    const isHeating = detail.newVal > detail.oldVal;
    const icon = isHeating ? '🔥' : '❄️';
    const actionText = isHeating ? 'Heating Adjusted' : 'Cooling Adjusted';
    const borderColor = isHeating ? '#ef4444' : '#3b82f6';
    const valueClass = isHeating ? 'value-up' : 'value-down';
    const newVal = detail.newVal.toFixed(1);

    // --- Toast ---
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.style.borderLeft = `4px solid ${borderColor}`;
    toast.innerHTML = `
      <div class="toast-header">${icon} ${zoneName}</div>
      <div class="toast-body" style="justify-content: center; font-weight: bold; padding: 6px 0;">
        <span class="${valueClass}">${actionText} → ${newVal}°C</span>
      </div>
    `;
    container.appendChild(toast);
    
    // Auto-dismiss after 4 seconds
    setTimeout(() => {
      toast.classList.add('toast-hide');
      toast.addEventListener('animationend', () => {
        if (toast.parentElement) toast.remove();
      });
    }, 4000);

    // --- Activity Log ---
    const logContent = document.getElementById('activity-log-content');
    const emptyMsg = document.getElementById('activity-log-empty');
    if (logContent) {
      if (emptyMsg) emptyMsg.style.display = 'none';

      const logItem = document.createElement('div');
      logItem.style.cssText = `background: rgba(15, 23, 42, 0.4); border: 1px solid rgba(255, 255, 255, 0.1); border-left: 3px solid ${borderColor}; border-radius: 8px; padding: 12px; font-size: 13px; color: #f8fafc;`;
      
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      logItem.innerHTML = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 11px; color: #94a3b8;">
          <span style="color: #38bdf8; font-weight: bold;">${icon} ${zoneName}</span>
          <span>${timeStr}</span>
        </div>
        <div>${actionText} — Setpoint: <span class="${valueClass}" style="font-weight: bold;">${newVal}°C</span></div>
      `;
      
      logContent.prepend(logItem);
    }
  });

  // 13. Keyboard Controls & Shortcuts
  window.addEventListener('keydown', (e) => {
    // If chat drawer is open, intercept all keys so the user doesn't accidentally trigger hotkeys
    // when the chat input loses focus.
    if (chatManager.isDrawerOpen()) {
      if (e.key === 'Escape') {
        chatManager.toggleDrawer();
        return;
      }
      // If typing a printable character, ensure input is focused
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const chatInput = document.getElementById('chat-input') as HTMLInputElement;
        if (chatInput && document.activeElement !== chatInput) {
          chatInput.focus();
        }
      }
      // Ignore all other global hotkeys while chat is open
      return;
    }

    // If typing in any other input (like settings), ignore hotkeys
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    switch (e.key) {
      case 'Enter':
        const startOverlay = document.getElementById('overlay-start');
        if (startOverlay && !startOverlay.classList.contains('hidden')) {
          document.getElementById('btn-start-app')?.click();
        }
        break;
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
      case 'l':
      case 'L':
        toggleActivityDrawer();
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

  // Backend connectivity check on load
  (async () => {
    const statusDot = document.getElementById('backend-status-dot');
    const statusText = document.getElementById('backend-status-text');
    try {
      const res = await fetch('/api/status', { signal: AbortSignal.timeout(3000) });
      const ok = res.ok;
      if (statusDot) {
        statusDot.style.background = ok ? '#22c55e' : '#ef4444';
        statusDot.style.boxShadow = ok ? '0 0 8px #22c55e' : '0 0 8px #ef4444';
      }
      if (statusText) statusText.textContent = ok ? 'Backend Connected' : 'Backend Error';
    } catch {
      if (statusDot) { statusDot.style.background = '#ef4444'; statusDot.style.boxShadow = '0 0 8px #ef4444'; }
      if (statusText) statusText.textContent = 'Backend Offline';
    }
  })();

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
      body: JSON.stringify({ action: 'start', speed: 0.2 })
    }).catch(err => console.error("Failed to start backend simulation:", err));

    await audioManager.init();
    audioManager.setAmbientEnabled(true);
    navigationManager.fpsController.lock();
  });

  document.getElementById('btn-mode-toggle')?.addEventListener('click', toggleViewMode);
  document.getElementById('btn-settings')?.addEventListener('click', toggleSettingsDrawer);
  document.getElementById('btn-activity')?.addEventListener('click', toggleActivityDrawer);
  document.getElementById('btn-close-activity')?.addEventListener('click', toggleActivityDrawer);
  document.getElementById('btn-chat')?.addEventListener('click', () => {
    chatManager.toggleDrawer();
  });
  document.getElementById('btn-help')?.addEventListener('click', toggleHelpModal);
  document.getElementById('btn-close-help')?.addEventListener('click', toggleHelpModal);
  document.getElementById('btn-ack-help')?.addEventListener('click', toggleHelpModal);
  document.getElementById('btn-audio-mute')?.addEventListener('click', toggleMute);
  document.getElementById('btn-toggle-weather')?.addEventListener('click', () => {
    document.getElementById('weather-dropdown')?.classList.toggle('hidden');
  });
  document.getElementById('btn-close-tv')?.addEventListener('click', toggleTVDashboard);

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

  const timeText = document.getElementById('time-text');

  sceneManager.registerUpdateCallback(() => {
    if (timeText) {
      const totalHours = hvacStore.currentSimHour % 24;
      const hours = Math.floor(totalHours);
      const minutes = Math.floor((totalHours - hours) * 60);
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const hr12 = hours % 12 === 0 ? 12 : hours % 12;
      timeText.textContent = `${hr12.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} ${ampm}`;
    }

    const weatherText = document.getElementById('weather-text');
    if (weatherText) weatherText.textContent = `${hvacStore.outdoorTemp.toFixed(1)}°C`;
    
    const outTemp = document.getElementById('weather-out-temp');
    if (outTemp) outTemp.textContent = `${hvacStore.outdoorTemp.toFixed(1)}°C`;
    
    const outHum = document.getElementById('weather-out-hum');
    if (outHum) outHum.textContent = `${Math.round(hvacStore.outdoorHum)}%`;
    
    const outSolar = document.getElementById('weather-out-solar');
    if (outSolar) outSolar.textContent = `${Math.round(hvacStore.solarIrr)} W/m²`;
    
    const outPrice = document.getElementById('weather-out-price');
    if (outPrice) outPrice.textContent = `$${hvacStore.elecPrice.toFixed(2)}/kWh`;

    // TV Dashboard Updates
    const tvZoneData = hvacStore.getZoneData('open_office');
    if (tvZoneData) {
      const tvTemp = document.getElementById('tv-stat-temp');
      if (tvTemp) tvTemp.textContent = `${tvZoneData.temp.toFixed(1)}°C`;
      
      const tvHum = document.getElementById('tv-stat-hum');
      if (tvHum) tvHum.textContent = `${Math.round(tvZoneData.humidity)}%`;
      
      const tvCfm = document.getElementById('tv-stat-cfm');
      if (tvCfm) tvCfm.textContent = `${Math.round(tvZoneData.airflowCFM)}`;
      
      const tvCo2 = document.getElementById('tv-stat-co2');
      if (tvCo2) tvCo2.textContent = `${Math.round(tvZoneData.co2)} ppm`;
      
      const tvPwr = document.getElementById('tv-stat-pwr');
      if (tvPwr) tvPwr.textContent = `${tvZoneData.powerDraw.toFixed(2)} kW`;
      
      const tvSet = document.getElementById('tv-stat-setpoint');
      if (tvSet) tvSet.textContent = `${tvZoneData.targetTemp.toFixed(1)}°C`;
    }

    // Live zone temperature in HUD zone pill
    const currentZoneId = navigationManager.getCurrentZone();
    const zoneHudTemp = document.getElementById('zone-live-temp');
    if (zoneHudTemp && currentZoneId) {
      const zd = hvacStore.getZoneData(currentZoneId);
      if (zd) {
        zoneHudTemp.textContent = `${zd.temp.toFixed(1)}°C`;
      }
    }
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
