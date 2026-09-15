import * as THREE from 'three';
import {
  PresentationScreen,
  TelemetryScreen,
  TerminalScreen,
  KioskScreen,
  BaseDynamicScreen
} from './DynamicScreens';
import { InteractionManager } from './InteractionManager';
import { AudioManager } from '../audio/AudioManager';
import { Materials } from '../scene/Materials';
import { OfficeFloorplan } from '../scene/OfficeFloorplan';
import { NavigationManager } from '../navigation/NavigationManager';

export class InteractiveProps {
  private scene: THREE.Scene;
  public floorplan: any;
  private interactionManager: InteractionManager;
  private audioManager: AudioManager;
  private materials: Materials;
  private navigationManager: NavigationManager;

  // Dynamic Canvas Screens
  public presentationScreen: PresentationScreen;
  public telemetryScreen: TelemetryScreen;
  public terminalScreen: TerminalScreen;
  public kioskScreen: KioskScreen;
  private dynamicScreens: BaseDynamicScreen[] = [];

  // Door Animation State
  public isDoorOpen: boolean = false;
  public doorMesh: THREE.Mesh | null = null;
  public onDoorToggle?: (doorId: string, isOpen: boolean) => void;
  private doorClosedZ: number = -2.75;
  private doorOpenZ: number = -1.35;
  private doorCurrentZ: number = -2.75;
  private doorTargetZ: number = -2.75;

  // Desk Lamp State
  public isDeskLampOn: boolean = true;
  private deskLampLight: THREE.PointLight | null = null;
  private deskLampMesh: THREE.Mesh | null = null;

  // Espresso Machine & Steam State
  public isBrewing: boolean = false;
  private brewTimer: number = 0;
  private espressoLED: THREE.Mesh | null = null;
  private steamGroup: THREE.Group | null = null;
  private steamParticles: { mesh: THREE.Mesh; initialY: number; speed: number; life: number }[] = [];

  // Conference Puck State
  public isConferenceMicMuted: boolean = false;
  private confPuckLED: THREE.Mesh | null = null;

  constructor(
    scene: THREE.Scene,
    floorplan: OfficeFloorplan,
    interactionManager: InteractionManager,
    audioManager: AudioManager,
    materials: Materials,
    navigationManager: NavigationManager
  ) {
    this.scene = scene;
    this.floorplan = floorplan;
    this.interactionManager = interactionManager;
    this.audioManager = audioManager;
    this.materials = materials;
    this.navigationManager = navigationManager;

    // Instantiate dynamic screens
    this.presentationScreen = new PresentationScreen('conf_presentation_screen');
    this.telemetryScreen = new TelemetryScreen('workstation_telemetry_screen');
    this.terminalScreen = new TerminalScreen('workstation_terminal_screen');
    this.kioskScreen = new KioskScreen('reception_kiosk_screen');

    this.dynamicScreens.push(
      this.presentationScreen,
      this.telemetryScreen,
      this.terminalScreen,
      this.kioskScreen
    );
  }

  public init(): void {
    this.setupZone1ReceptionProps();
    this.setupZone2WorkstationProps();
    this.setupZone3ConferenceProps();
    this.setupZone4LoungeProps();
    this.setupGlassBoards();
  }

  // ==========================================
  // GLASS BOARDS (HVAC HUD)
  // ==========================================
  private setupGlassBoards(): void {
    if (this.floorplan.commandGlass) {
      this.registerGlassBoard(this.floorplan.commandGlass.glassMesh, 'Command Glass', 'Hero Operations Dashboard', this.floorplan.commandGlass.group);
    }
    
    Object.keys(this.floorplan.glassBoards).forEach(zone => {
      this.registerGlassBoard(this.floorplan.glassBoards[zone].glassMesh, `Zone ${zone.toUpperCase()} Glass`, `HVAC Telemetry Node`, this.floorplan.glassBoards[zone].group);
    });
  }

  private registerGlassBoard(interactMesh: THREE.Object3D, name: string, desc: string, targetMesh: THREE.Object3D): void {
    this.interactionManager.register({
      id: `glassboard_${name.replace(/\s+/g, '_').toLowerCase()}`,
      name: name,
      category: 'screen',
      mesh: interactMesh,
      prompt: 'Inspect Dashboard [E]',
      distanceCutoff: 4.5,
      onInteract: () => {
        this.navigationManager.focusOnObject(targetMesh, 2.5);
        this.audioManager.playChime();
      },
      getDetails: () => ({
        title: name,
        category: 'Live Dashboard',
        description: desc,
        actions: ['Enter Focus Mode']
      })
    });
  }

  // ==========================================
  // ZONE 1: RECEPTION PROPS
  // ==========================================
  private setupZone1ReceptionProps(): void {
    // 1. Interactive Welcome Kiosk
    if (this.floorplan.kioskScreenMesh) {
      const screenMat = new THREE.MeshStandardMaterial({
        map: this.kioskScreen.texture,
        emissiveMap: this.kioskScreen.texture,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.9,
        roughness: 0.2
      });
      this.floorplan.kioskScreenMesh.material = screenMat;
      this.kioskScreen.setMesh(this.floorplan.kioskScreenMesh);

      const targetMesh = this.floorplan.kioskGroup || this.floorplan.kioskScreenMesh;

      this.interactionManager.register({
        id: 'reception_kiosk',
        name: 'Welcome Directory Kiosk',
        category: 'screen',
        mesh: targetMesh,
        prompt: 'Directory Info [E]',
        distanceCutoff: 4.5,
        onInteract: () => {
          this.kioskScreen.nextPage();
          this.audioManager.playClick();
        },
        getDetails: () => ({
          title: 'Welcome Directory Kiosk',
          category: 'Interactive Directory',
          description: 'Interactive building directory displaying Aura Corp floorplans, active schedules, and executive briefings.',
          actions: ['Cycle Page', 'Inspect Directory']
        })
      });
    }

    // 2. Reception Desk Terminal
    if (this.floorplan.recDeskGroup || this.floorplan.recDeskScreen) {
      const deskMesh = this.floorplan.recDeskGroup || this.floorplan.recDeskScreen!;
      this.interactionManager.register({
        id: 'reception_desk',
        name: 'Receptionist Workstation',
        category: 'screen',
        mesh: deskMesh,
        prompt: 'Check In [E]',
        distanceCutoff: 4.5,
        onInteract: () => {
          this.audioManager.playChime();
          document.dispatchEvent(new CustomEvent('open-centered-chat'));
        },
        getDetails: () => ({
          title: 'Receptionist Terminal',
          category: 'Guest Management',
          description: 'Visitor registry terminal for checking into the Aura Corp digital headquarters.',
          actions: ['Check In', 'Print Guest Pass']
        })
      });
    }
  }

  // ==========================================
  // ZONE 2: WORKSTATION PROPS
  // ==========================================
  private setupZone2WorkstationProps(): void {
    // 1. Pod Telemetry Monitor
    const telemMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.58, 0.34),
      new THREE.MeshStandardMaterial({
        map: this.telemetryScreen.texture,
        emissiveMap: this.telemetryScreen.texture,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.9,
        roughness: 0.2
      })
    );
    // Position on Pod 2 (px = -4.0, pz = -3.5) NE desk facing N
    telemMesh.position.set(-4.0 + 0.85 + 0.32, 0.95, -3.5 - 0.45 - 0.17);
    telemMesh.rotation.y = -0.12;
    this.scene.add(telemMesh);
    this.telemetryScreen.setMesh(telemMesh);

    this.interactionManager.register({
      id: 'workstation_monitors',
      name: 'Telemetry Cluster Monitor',
      category: 'screen',
      mesh: telemMesh,
      prompt: 'Inspect Telemetry [E]',
      distanceCutoff: 4.0,
      onInteract: () => {
        this.audioManager.playClick();
      },
      getDetails: () => ({
        title: 'Cluster Telemetry Monitor',
        category: 'Live Diagnostics',
        description: 'Real-time telemetry stream monitoring CPU utilization, RAM allocation, and network packet throughput across nodes.',
        actions: ['Inspect Node', 'Refresh Stream']
      })
    });

    // 2. Pod Terminal Monitor (Matrix Rain / Unix Terminal)
    const termMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.58, 0.34),
      new THREE.MeshStandardMaterial({
        map: this.terminalScreen.texture,
        emissiveMap: this.terminalScreen.texture,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.9,
        roughness: 0.2
      })
    );
    // Position on Pod 1 (px = -12.5, pz = -8.5) NW desk facing N
    termMesh.position.set(-12.5 - 0.85 - 0.32, 0.95, -8.5 - 0.45 - 0.17);
    termMesh.rotation.y = 0.12;
    this.scene.add(termMesh);
    this.terminalScreen.setMesh(termMesh);

    this.interactionManager.register({
      id: 'workstation_matrix',
      name: 'Unix Developer Terminal',
      category: 'screen',
      mesh: termMesh,
      prompt: 'Toggle Terminal [E]',
      distanceCutoff: 4.0,
      onInteract: () => {
        this.terminalScreen.toggleMode();
        this.audioManager.playClick();
      },
      getDetails: () => ({
        title: 'Developer Workstation Terminal',
        category: 'Kernel Diagnostics',
        description: 'Live terminal displaying Matrix digital rain and Unix system status logs.',
        actions: ['Toggle Rain/Log Mode', 'Execute Command']
      })
    });

    // 3. Workstation Desk Lamp (Interactive Point Light & Shade)
    const lampGroup = new THREE.Group();
    lampGroup.position.set(-4.0 + 0.85 - 0.6, 0.74, -3.5 - 0.45);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.015, 10), this.materials.metalBlackMatte);
    base.position.set(0, 0.008, 0);

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.35, 6), this.materials.metalBlackMatte);
    arm.position.set(0.02, 0.2, 0);
    arm.rotation.z = -0.2;

    const shadeMat = new THREE.MeshStandardMaterial({
      color: 0xffddaa,
      emissive: new THREE.Color(0xffaa44),
      emissiveIntensity: 0.8,
      roughness: 0.3
    });
    this.deskLampMesh = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.12, 10), shadeMat);
    this.deskLampMesh.position.set(0.08, 0.35, 0);
    this.deskLampMesh.rotation.z = 2.2;

    this.deskLampLight = new THREE.PointLight(0xffaa44, 2.0, 4.0, 1.5);
    this.deskLampLight.position.set(0.1, 0.36, 0);
    this.deskLampLight.castShadow = false;

    lampGroup.add(base, arm, this.deskLampMesh, this.deskLampLight);
    this.scene.add(lampGroup);

    this.interactionManager.register({
      id: 'workstation_desk_lamp',
      name: 'Architectural Desk Lamp',
      category: 'light',
      mesh: lampGroup,
      prompt: 'Toggle Desk Lamp [E]',
      distanceCutoff: 3.5,
      onInteract: () => {
        this.isDeskLampOn = !this.isDeskLampOn;
        if (this.deskLampLight) {
          this.deskLampLight.intensity = this.isDeskLampOn ? 2.0 : 0.0;
        }
        if (this.deskLampMesh && this.deskLampMesh.material instanceof THREE.MeshStandardMaterial) {
          this.deskLampMesh.material.emissiveIntensity = this.isDeskLampOn ? 0.8 : 0.05;
        }
        this.audioManager.playLightSwitch(this.isDeskLampOn);
      },
      getDetails: () => ({
        title: 'Task Desk Lamp',
        category: 'Workspace Lighting',
        description: 'Warm 3000K LED task luminaire with anodized black aluminum articulated armature.',
        actions: ['Toggle On/Off']
      })
    });
  }

  // ==========================================
  // ZONE 3: CONFERENCE ROOM PROPS
  // ==========================================
  private setupZone3ConferenceProps(): void {
    // 1. 85" Smart Presentation Display
    if (this.floorplan.confScreenMesh) {
      const screenMat = new THREE.MeshStandardMaterial({
        map: this.presentationScreen.texture,
        emissiveMap: this.presentationScreen.texture,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.95,
        roughness: 0.15
      });
      this.floorplan.confScreenMesh.material = screenMat;
      this.presentationScreen.setMesh(this.floorplan.confScreenMesh);

      this.interactionManager.register({
        id: 'conf_screen',
        name: '85" Smart Presentation Display',
        category: 'screen',
        mesh: this.floorplan.confScreenMesh,
        prompt: 'Advance Slide [E]',
        distanceCutoff: 6.0,
        onInteract: () => {
          this.presentationScreen.nextSlide();
          this.audioManager.playChime();
        },
        getDetails: () => ({
          title: '85" 4K Smart Presentation Display',
          category: 'Conference Presentation',
          description: 'Interactive presentation screen streaming enterprise roadmaps, system architectures, and Q3 metrics.',
          actions: ['Advance Slide', 'Previous Slide', 'Fullscreen']
        })
      });
    }

    // 2. Conference Sliding Glass Door
    if (this.floorplan.confDoorMesh) {
      this.doorMesh = this.floorplan.confDoorMesh;
      if (!this.doorMesh) return; this.doorCurrentZ = this.doorMesh.position.z;
      this.doorTargetZ = this.doorClosedZ;

      this.interactionManager.register({
        id: 'conf_door_sliding',
        name: 'Conference Glass Sliding Door',
        category: 'door',
        mesh: this.doorMesh!,
        prompt: 'Toggle Door [E]',
        distanceCutoff: 4.5,
        onInteract: () => {
          this.toggleDoor();
        },
        getDetails: () => ({
          title: 'Glass Acoustic Sliding Door',
          category: 'Architectural Access',
          description: 'Motorized acoustic glass slider enclosing the conference room.',
          actions: ['Open Door', 'Close Door']
        })
      });
    }

    // 3. Conference Table Speakerphone Puck
    if (this.floorplan.confPuckGroup) {
      this.confPuckLED = this.floorplan.confPuckLED || null;
      this.interactionManager.register({
        id: 'conf_speaker_puck',
        name: 'Conference Speakerphone Hub',
        category: 'appliance',
        mesh: this.floorplan.confPuckGroup,
        prompt: 'Toggle Mute [E]',
        distanceCutoff: 3.5,
        onInteract: () => {
          this.isConferenceMicMuted = !this.isConferenceMicMuted;
          if (this.confPuckLED && this.confPuckLED.material instanceof THREE.MeshBasicMaterial) {
            this.confPuckLED.material.color.setHex(this.isConferenceMicMuted ? 0xef4444 : 0x22c55e);
          }
          this.audioManager.playClick();
        }
      });
    }
  }

  // ==========================================
  // ZONE 4: LOUNGE & CAFE PROPS
  // ==========================================
  private setupZone4LoungeProps(): void {
    // 1. Commercial Espresso Machine
    this.espressoLED = this.floorplan.espressoLED || null;

    // Steam Particle Emitter System attached at espresso machine location (17.4, 1.2, 6.5)
    this.steamGroup = new THREE.Group();
    this.steamGroup.position.set(17.15, 1.25, 6.5);
    this.steamGroup.visible = false;

    const steamMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      depthWrite: false
    });

    for (let i = 0; i < 20; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.025 + Math.random() * 0.025, 6, 6), steamMat.clone());
      p.position.set((Math.random() - 0.5) * 0.08, Math.random() * 0.2, (Math.random() - 0.5) * 0.08);
      this.steamGroup.add(p);
      this.steamParticles.push({
        mesh: p,
        initialY: p.position.y,
        speed: 0.15 + Math.random() * 0.2,
        life: Math.random()
      });
    }
    this.scene.add(this.steamGroup);

    // Create an invisible interaction proxy box around espresso machine if needed or register group
    const espressoBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.6, 0.6),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    espressoBox.position.set(17.4, 1.2, 6.5);
    this.scene.add(espressoBox);

    this.interactionManager.register({
      id: 'lounge_espresso_machine',
      name: 'Commercial Espresso Machine',
      category: 'appliance',
      mesh: espressoBox,
      prompt: 'Brew Espresso [E]',
      distanceCutoff: 3.5,
      onInteract: () => {
        this.triggerBrewEspresso();
      },
      getDetails: () => ({
        title: 'Commercial Dual-Boiler Espresso Machine',
        category: 'Kitchen Appliance',
        description: 'High-pressure commercial espresso machine with PID temperature control and volumetric extraction.',
        actions: ['Brew Espresso Shot', 'Steam Milk']
      })
    });

    // 2. Lounge Wall TV Display
    if (this.floorplan.loungeTVMesh) {
      this.interactionManager.register({
        id: 'lounge_tv',
        name: 'Executive Lounge Smart TV',
        category: 'screen',
        mesh: this.floorplan.loungeTVMesh,
        prompt: 'View Telemetry [E]',
        distanceCutoff: 5.0,
        onInteract: () => {
          this.audioManager.playClick();
          document.dispatchEvent(new CustomEvent('open-tv-dashboard'));
        },
        getDetails: () => ({
          title: 'Lounge 4K Smart TV',
          category: 'Entertainment Display',
          description: 'Ambient TV streaming company announcements, Bloomberg financial news, and tech keynotes.',
          actions: ['Next Channel', 'Mute TV']
        })
      });
    }
  }

  public toggleDoor(): void {
    this.isDoorOpen = !this.isDoorOpen;
    this.doorTargetZ = this.isDoorOpen ? this.doorOpenZ : this.doorClosedZ;
    this.audioManager.playDoorSound(this.isDoorOpen);

    // Update collision obstacle state
      if (typeof this.floorplan.setDoorState === 'function') {
        this.floorplan.setDoorState('conf_door_sliding', this.isDoorOpen);
      }
    if (this.onDoorToggle) {
      this.onDoorToggle('conf_door_sliding', this.isDoorOpen);
    }
  }

  public triggerBrewEspresso(): void {
    if (this.isBrewing) return;
    this.isBrewing = true;
    this.brewTimer = 2.4;
    if (this.steamGroup) this.steamGroup.visible = true;
    if (this.espressoLED && this.espressoLED.material instanceof THREE.MeshBasicMaterial) {
      this.espressoLED.material.color.setHex(0xf59e0b); // Amber during brew
    }
    this.audioManager.playCoffeeBrew();
  }

  public update(delta: number): void {
    // 1. Update dynamic screen textures
    for (let i = 0; i < this.dynamicScreens.length; i++) {
      this.dynamicScreens[i].update(delta);
    }

    // 2. Smoothly animate sliding door
    if (this.doorMesh) {
      this.doorCurrentZ = THREE.MathUtils.lerp(this.doorCurrentZ, this.doorTargetZ, delta * 5.0);
      this.doorMesh.position.z = this.doorCurrentZ;
    }

    // 3. Animate espresso machine brewing and steam particles
    if (this.isBrewing) {
      this.brewTimer -= delta;
      if (this.steamParticles.length > 0) {
        this.steamParticles.forEach((p) => {
          p.mesh.position.y += p.speed * delta;
          p.life += delta * 1.5;
          const scale = 1.0 + p.life * 2.0;
          p.mesh.scale.set(scale, scale, scale);

          if (p.mesh.material instanceof THREE.MeshBasicMaterial) {
            p.mesh.material.opacity = Math.max(0, 0.4 * (1.0 - p.life));
          }

          if (p.life >= 1.0) {
            p.mesh.position.y = p.initialY;
            p.life = 0;
            p.mesh.scale.set(1, 1, 1);
          }
        });
      }

      if (this.brewTimer <= 0) {
        this.isBrewing = false;
        if (this.steamGroup) this.steamGroup.visible = false;
        if (this.espressoLED && this.espressoLED.material instanceof THREE.MeshBasicMaterial) {
          this.espressoLED.material.color.setHex(0x22c55e); // Green when done
        }
      }
    }
  }

  public dispose(): void {
    for (const screen of this.dynamicScreens) {
      screen.dispose?.();
    }
    if (this.steamParticles) {
      for (const p of this.steamParticles) {
        p.mesh.geometry?.dispose();
        if (p.mesh.material) {
          if (Array.isArray(p.mesh.material)) p.mesh.material.forEach(m => m.dispose());
          else p.mesh.material.dispose();
        }
      }
      this.steamParticles = [];
    }
  }
}
