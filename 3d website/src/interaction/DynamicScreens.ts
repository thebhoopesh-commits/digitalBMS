import * as THREE from 'three';
import { IDynamicScreen, ScreenDisplayType } from '../types';

/**
 * Base Dynamic HTML5 Canvas Screen Renderer
 * Supports throttled 15-20 FPS updates to guarantee 60 FPS overall WebGL rendering.
 */
export abstract class BaseDynamicScreen implements IDynamicScreen {
  public id: string;
  public type: ScreenDisplayType;
  public canvas: HTMLCanvasElement;
  public context: CanvasRenderingContext2D;
  public texture: THREE.CanvasTexture;
  public mesh!: THREE.Mesh;

  protected updateInterval: number = 1 / 20; // 20 FPS throttle
  protected timeSinceLastUpdate: number = 0;
  protected isDirty: boolean = true;
  protected totalElapsed: number = 0;

  constructor(id: string, type: ScreenDisplayType, width = 512, height = 512, targetFps = 20) {
    this.id = id;
    this.type = type;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.context = this.canvas.getContext('2d')!;
    this.updateInterval = 1 / Math.max(1, targetFps);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
  }

  public update(delta: number): void {
    this.totalElapsed += delta;
    this.timeSinceLastUpdate += delta;

    if (this.isDirty || this.timeSinceLastUpdate >= this.updateInterval) {
      this.renderCanvas(delta);
      this.texture.needsUpdate = true;
      this.timeSinceLastUpdate = 0;
      this.isDirty = false;
    }
  }

  public markDirty(): void {
    this.isDirty = true;
  }

  public setMesh(mesh: THREE.Mesh): void {
    this.mesh = mesh;
    if (this.mesh.material instanceof THREE.MeshStandardMaterial || this.mesh.material instanceof THREE.MeshBasicMaterial) {
      this.mesh.material.map = this.texture;
      if ('emissiveMap' in this.mesh.material) {
        (this.mesh.material as THREE.MeshStandardMaterial).emissiveMap = this.texture;
        (this.mesh.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0xffffff);
        (this.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9;
      }
      this.mesh.material.needsUpdate = true;
    }
  }

  public dispose(): void {
    if (this.texture) {
      this.texture.dispose();
    }
  }

  protected abstract renderCanvas(delta: number): void;
}

/**
 * 1. PresentationScreen: 85" 4K Multi-Slide Conference Deck
 */
export interface SlideDefinition {
  title: string;
  subtitle: string;
  render: (ctx: CanvasRenderingContext2D, w: number, h: number, elapsed: number) => void;
}

export class PresentationScreen extends BaseDynamicScreen {
  public currentSlideIndex: number = 0;
  private slides: SlideDefinition[] = [];

  constructor(id = 'conf_presentation_screen') {
    super(id, 'slides', 1024, 576, 15);
    this.setupSlides();
    this.markDirty();
  }

  private setupSlides(): void {
    // Slide 1: Executive Overview
    this.slides.push({
      title: 'AURA CORP — ENTERPRISE DIGITAL TWIN',
      subtitle: 'Next-Generation Autonomous Multi-Agent Workspace Engine',
      render: (ctx, w, h) => {
        // Background gradient
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#090d16');
        grad.addColorStop(1, '#0f172a');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Grid lines
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 40) {
          ctx.beginPath();
          ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 0; y < h; y += 40) {
          ctx.beginPath();
          ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // Header Pill
        ctx.fillStyle = 'rgba(14, 165, 233, 0.2)';
        ctx.fillRect(60, 45, 180, 32);
        ctx.strokeStyle = '#38bdf8';
        ctx.strokeRect(60, 45, 180, 32);
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 14px "JetBrains Mono", monospace';
        ctx.fillText('● LIVE EXECUTIVE BRIEF', 74, 66);

        // Main Title
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 34px Inter, sans-serif';
        ctx.fillText('AURA CORP VIRTUAL HEADQUARTERS', 60, 125);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '500 18px Inter, sans-serif';
        ctx.fillText('High-Performance 3D Environment with Real-Time Physical Simulation', 60, 160);

        // 3 Key Pillars
        const pillars = [
          { title: '40x26m Architecture', desc: '4 functional zones with PBR shaders, dynamic soft shadows & lighting presets.', color: '#38bdf8' },
          { title: 'Dual Navigation Rig', desc: 'Sliding AABB collision, WASD eye-height lock + smooth parabolic Orbit arc.', color: '#a855f7' },
          { title: 'Interactive Hotspots', desc: 'Throttled 2D Canvas screens, procedural Web Audio synth & spatial radar.', color: '#22c55e' }
        ];

        pillars.forEach((p, idx) => {
          const bx = 60 + idx * 304;
          const by = 200;
          const bw = 284;
          const bh = 280;

          ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
          ctx.fillRect(bx, by, bw, bh);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(bx, by, bw, bh);

          // Top Accent Bar
          ctx.fillStyle = p.color;
          ctx.fillRect(bx, by, bw, 6);

          ctx.fillStyle = '#f8fafc';
          ctx.font = 'bold 19px Inter, sans-serif';
          ctx.fillText(p.title, bx + 18, by + 42);

          ctx.fillStyle = '#cbd5e1';
          ctx.font = '14px Inter, sans-serif';
          wrapText(ctx, p.desc, bx + 18, by + 80, bw - 36, 22);

          // Metric Badge at bottom of card
          ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
          ctx.fillRect(bx + 18, by + 210, bw - 36, 46);
          ctx.fillStyle = p.color;
          ctx.font = 'bold 13px "JetBrains Mono", monospace';
          ctx.fillText(`STATUS: NOMINAL [100%]`, bx + 30, by + 238);
        });
      }
    });

    // Slide 2: Multi-Agent Architecture
    this.slides.push({
      title: 'SYSTEM ARCHITECTURE & PROTOCOLS',
      subtitle: 'Decoupled Subsystems with Automation Debug Contracts',
      render: (ctx, w, h) => {
        ctx.fillStyle = '#0a0e1a';
        ctx.fillRect(0, 0, w, h);

        // Header
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 14px "JetBrains Mono", monospace';
        ctx.fillText('● SYSTEM ARCHITECTURE [TIER 1 - 4]', 60, 60);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 30px Inter, sans-serif';
        ctx.fillText('Modular Three.js Subsystem Pipeline', 60, 100);

        // Architecture Nodes
        const nodes = [
          { x: 80, y: 160, w: 230, h: 120, title: 'Scene & Materials', sub: 'PBR Shaders\nMerged Wall Batches\nInstancedMesh Geometry' },
          { x: 380, y: 160, w: 240, h: 120, title: 'Dual Nav Rig', sub: 'Kinematic WASD\nSliding AABB Collisions\nParabolic Arc Transitions' },
          { x: 700, y: 160, w: 240, h: 120, title: 'Interaction & Audio', sub: 'Screen-Center Raycast\nDynamic Canvas Screens\nProcedural Web Audio' },
          { x: 80, y: 340, w: 230, h: 120, title: 'Minimap & Radar', sub: 'Affine Coordinate Map\nLive FOV View Cone\nZone Spatial Teleport' },
          { x: 380, y: 340, w: 240, h: 120, title: 'Atmospheric Light', sub: 'Day / Sunset / Night\nDirectional Sun Shadows\nEmissive Screen Glows' },
          { x: 700, y: 340, w: 240, h: 120, title: 'E2E Test Harness', sub: 'Playwright Opaque-Box\n__OFFICE_DEBUG__ Bridge\n60 FPS Soak Testing' }
        ];

        nodes.forEach(n => {
          ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
          ctx.fillRect(n.x, n.y, n.w, n.h);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(n.x, n.y, n.w, n.h);

          ctx.fillStyle = '#38bdf8';
          ctx.font = 'bold 16px Inter, sans-serif';
          ctx.fillText(n.title, n.x + 16, n.y + 32);

          ctx.fillStyle = '#94a3b8';
          ctx.font = '12px "JetBrains Mono", monospace';
          const lines = n.sub.split('\n');
          lines.forEach((l, li) => {
            ctx.fillText(`• ${l}`, n.x + 16, n.y + 60 + li * 20);
          });
        });

        // Connecting lines
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(310, 220); ctx.lineTo(380, 220);
        ctx.moveTo(620, 220); ctx.lineTo(700, 220);
        ctx.moveTo(310, 400); ctx.lineTo(380, 400);
        ctx.moveTo(620, 400); ctx.lineTo(700, 400);
        ctx.stroke();

        // Footer
        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 14px "JetBrains Mono", monospace';
        ctx.fillText('✓ ZERO EXTERNAL ASSET DEPENDENCY | 100% DETERMINISTIC WEBGL', 60, 520);
      }
    });

    // Slide 3: Q3 Telemetry & Growth Metrics
    this.slides.push({
      title: 'Q3 TELEMETRY & WORKSPACE PERFORMANCE',
      subtitle: 'Continuous 60 FPS Rendering and Sub-Millisecond Physics',
      render: (ctx, w, h, elapsed) => {
        ctx.fillStyle = '#070b14';
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 14px "JetBrains Mono", monospace';
        ctx.fillText('● Q3 TELEMETRY & PERFORMANCE AUDIT', 60, 60);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 30px Inter, sans-serif';
        ctx.fillText('Workspace Throughput & Latency Metrics', 60, 100);

        // 4 Metric cards
        const kpis = [
          { label: 'FRAME RATE', value: '60.0 FPS', sub: 'Target: >55 FPS' },
          { label: 'DRAW CALLS', value: '32 DC', sub: 'Budget: <50 DC' },
          { label: 'PHYSICS LATENCY', value: '0.12 ms', sub: 'Sliding AABB' },
          { label: 'AUDIO FOOTPRINT', value: '0 KB', sub: 'Pure Procedural' }
        ];

        kpis.forEach((k, idx) => {
          const kx = 60 + idx * 228;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.fillRect(kx, 140, 214, 90);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
          ctx.strokeRect(kx, 140, 214, 90);

          ctx.fillStyle = '#94a3b8';
          ctx.font = 'bold 11px Inter, sans-serif';
          ctx.fillText(k.label, kx + 16, 166);

          ctx.fillStyle = '#38bdf8';
          ctx.font = 'bold 22px "JetBrains Mono", monospace';
          ctx.fillText(k.value, kx + 16, 196);

          ctx.fillStyle = '#22c55e';
          ctx.font = '11px Inter, sans-serif';
          ctx.fillText(k.sub, kx + 16, 218);
        });

        // Bar Chart
        const chartX = 60;
        const chartY = 260;
        const chartW = 890;
        const chartH = 210;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
        ctx.fillRect(chartX, chartY, chartW, chartH);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.strokeRect(chartX, chartY, chartW, chartH);

        const quarters = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6', 'Week 7', 'Week 8'];
        const values = [48, 52, 60, 58, 64, 75, 88, 96];

        const barWidth = 60;
        const spacing = (chartW - barWidth * quarters.length) / (quarters.length + 1);

        quarters.forEach((q, i) => {
          const bx = chartX + spacing + i * (barWidth + spacing);
          const val = values[i];
          const animatedHeight = (val / 100) * (chartH - 60) * Math.min(1.0, (elapsed % 5) * 0.8 + 0.2);
          const by = chartY + chartH - 30 - animatedHeight;

          const barGrad = ctx.createLinearGradient(0, by, 0, by + animatedHeight);
          barGrad.addColorStop(0, '#0ea5e9');
          barGrad.addColorStop(1, '#0369a1');

          ctx.fillStyle = barGrad;
          ctx.fillRect(bx, by, barWidth, animatedHeight);

          ctx.fillStyle = '#cbd5e1';
          ctx.font = 'bold 12px "JetBrains Mono", monospace';
          ctx.fillText(`${val}%`, bx + 14, by - 8);

          ctx.fillStyle = '#94a3b8';
          ctx.font = '11px Inter, sans-serif';
          ctx.fillText(q, bx + 6, chartY + chartH - 12);
        });
      }
    });

    // Slide 4: Strategic Roadmap
    this.slides.push({
      title: 'STRATEGIC ROADMAP & NEXT MILESTONES',
      subtitle: 'Execution Timeline & Deployment Criteria',
      render: (ctx, w, h) => {
        ctx.fillStyle = '#0a0d16';
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 14px "JetBrains Mono", monospace';
        ctx.fillText('● PRODUCT DELIVERY ROADMAP [M1 - M5]', 60, 60);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 30px Inter, sans-serif';
        ctx.fillText('Project Execution Status', 60, 100);

        const milestones = [
          { tag: 'M1', name: 'Core Engine & 3D Floorplan', status: 'COMPLETED', color: '#22c55e' },
          { tag: 'M2', name: 'Dual Navigation & Collision Physics', status: 'COMPLETED', color: '#22c55e' },
          { tag: 'M3', name: 'Interactive Screens & Web Audio', status: 'ACTIVE IN PROGRESS', color: '#38bdf8' },
          { tag: 'M4', name: 'Real-Time Minimap & HUD Controls', status: 'READY FOR DISPATCH', color: '#f59e0b' },
          { tag: 'M5', name: 'E2E Testing & 60 FPS Hardening', status: 'PLANNED', color: '#94a3b8' }
        ];

        milestones.forEach((m, idx) => {
          const my = 150 + idx * 65;
          ctx.fillStyle = 'rgba(30, 41, 59, 0.7)';
          ctx.fillRect(60, my, 890, 52);
          ctx.strokeStyle = m.color;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(60, my, 890, 52);

          // Tag badge
          ctx.fillStyle = m.color;
          ctx.fillRect(72, my + 10, 48, 32);
          ctx.fillStyle = '#0f172a';
          ctx.font = 'bold 16px "JetBrains Mono", monospace';
          ctx.fillText(m.tag, 84, my + 32);

          // Milestone Name
          ctx.fillStyle = '#f8fafc';
          ctx.font = 'bold 16px Inter, sans-serif';
          ctx.fillText(m.name, 140, my + 32);

          // Status Badge
          ctx.fillStyle = m.color;
          ctx.font = 'bold 13px "JetBrains Mono", monospace';
          ctx.fillText(`[ ${m.status} ]`, 740, my + 32);
        });

        // Footer Instructions
        ctx.fillStyle = '#94a3b8';
        ctx.font = '13px Inter, sans-serif';
        ctx.fillText('💡 Click display or press [E] in FPS mode to cycle through presentation slides.', 60, 515);
      }
    });
  }

  public nextSlide(): void {
    this.currentSlideIndex = (this.currentSlideIndex + 1) % this.slides.length;
    this.markDirty();
  }

  public prevSlide(): void {
    this.currentSlideIndex = (this.currentSlideIndex - 1 + this.slides.length) % this.slides.length;
    this.markDirty();
  }

  public goToSlide(index: number): void {
    if (index >= 0 && index < this.slides.length) {
      this.currentSlideIndex = index;
      this.markDirty();
    }
  }

  public getSlideIndex(): number {
    return this.currentSlideIndex;
  }

  public getTotalSlides(): number {
    return this.slides.length;
  }

  protected renderCanvas(_delta: number): void {
    const slide = this.slides[this.currentSlideIndex];
    if (slide) {
      slide.render(this.context, this.canvas.width, this.canvas.height, this.totalElapsed);
    }

    // Slide Pagination Overlay
    const ctx = this.context;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fillRect(w - 200, h - 50, 160, 32);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.strokeRect(w - 200, h - 50, 160, 32);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.fillText(`SLIDE ${this.currentSlideIndex + 1} OF ${this.slides.length}`, w - 180, h - 29);
  }
}

/**
 * 2. TelemetryScreen: Live Workstation Animated Dashboard
 */
export class TelemetryScreen extends BaseDynamicScreen {
  private historyCPU: number[] = [];
  private historyRAM: number[] = [];
  private historyNet: number[] = [];
  private maxPoints: number = 40;

  constructor(id = 'workstation_telemetry_screen') {
    super(id, 'telemetry', 512, 256, 18);
    for (let i = 0; i < this.maxPoints; i++) {
      this.historyCPU.push(35 + Math.random() * 20);
      this.historyRAM.push(60 + Math.random() * 10);
      this.historyNet.push(40 + Math.random() * 30);
    }
  }

  protected renderCanvas(_delta: number): void {
    const ctx = this.context;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Shift new random metrics
    this.historyCPU.shift();
    this.historyCPU.push(Math.max(10, Math.min(95, this.historyCPU[this.historyCPU.length - 1] + (Math.random() - 0.48) * 8)));

    this.historyRAM.shift();
    this.historyRAM.push(Math.max(40, Math.min(90, this.historyRAM[this.historyRAM.length - 1] + (Math.random() - 0.5) * 3)));

    this.historyNet.shift();
    this.historyNet.push(Math.max(10, Math.min(100, this.historyNet[this.historyNet.length - 1] + (Math.random() - 0.5) * 12)));

    // Dark Background
    ctx.fillStyle = '#060911';
    ctx.fillRect(0, 0, w, h);

    // Header
    ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.fillRect(0, 0, w, 28);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillText('AURA TELEMETRY // NODE CLUSTER #04', 12, 18);

    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(timeStr, w - 120, 18);

    // Left Side Gauges
    const latestCPU = Math.round(this.historyCPU[this.historyCPU.length - 1]);
    const latestRAM = Math.round(this.historyRAM[this.historyRAM.length - 1]);
    const latestNet = Math.round(this.historyNet[this.historyNet.length - 1]);

    this.drawMetricCard(ctx, 12, 38, 140, 58, 'CPU USAGE', `${latestCPU}%`, latestCPU > 80 ? '#ef4444' : '#38bdf8');
    this.drawMetricCard(ctx, 12, 104, 140, 58, 'RAM ALLOC', `${latestRAM}%`, '#a855f7');
    this.drawMetricCard(ctx, 12, 170, 140, 58, 'NET THROUGHPUT', `${latestNet} MB/s`, '#22c55e');

    // Right Side Multi-Line Graph
    const gx = 164;
    const gy = 38;
    const gw = w - 176;
    const gh = 190;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fillRect(gx, gy, gw, gh);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.strokeRect(gx, gy, gw, gh);

    // Graph grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let y = gy + 30; y < gy + gh; y += 35) {
      ctx.beginPath();
      ctx.moveTo(gx, y); ctx.lineTo(gx + gw, y); ctx.stroke();
    }

    this.drawGraphLine(ctx, gx, gy, gw, gh, this.historyCPU, '#38bdf8');
    this.drawGraphLine(ctx, gx, gy, gw, gh, this.historyNet, '#22c55e');

    // Legend
    ctx.fillStyle = '#38bdf8';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText('■ CPU', gx + 10, gy + 18);
    ctx.fillStyle = '#22c55e';
    ctx.fillText('■ NET', gx + 60, gy + 18);
  }

  private drawMetricCard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, val: string, color: string): void {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px Inter, sans-serif';
    ctx.fillText(label, x + 8, y + 18);

    ctx.fillStyle = color;
    ctx.font = 'bold 18px "JetBrains Mono", monospace';
    ctx.fillText(val, x + 8, y + 44);
  }

  private drawGraphLine(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, data: number[], color: string): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const step = w / (data.length - 1);

    data.forEach((val, i) => {
      const px = x + i * step;
      const py = y + h - (val / 100) * (h - 20) - 10;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
}

/**
 * 3. TerminalScreen: Animated Matrix Rain & Unix Log Stream
 */
export class TerminalScreen extends BaseDynamicScreen {
  public isMatrixMode: boolean = true;
  private columns: number = 32;
  private drops: number[] = [];
  private chars: string = '0123456789ABCDEFｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ';
  private logs: string[] = [
    'AuraOS v4.18.0-enterprise x86_64 initialized',
    'GPU Context: WebGL2 ANGLE hardware accelerated',
    'NavigationController: Sliding AABB collision bound',
    'AudioManager: WebAudio procedural synthesizer active',
    'Cluster Sync: 4 pods streaming telemetry at 60 FPS',
    'Ready for user command prompt input...'
  ];

  constructor(id = 'workstation_terminal_screen') {
    super(id, 'matrix', 512, 512, 20);
    for (let i = 0; i < this.columns; i++) {
      this.drops[i] = Math.floor(Math.random() * -30);
    }
  }

  public toggleMode(): void {
    this.isMatrixMode = !this.isMatrixMode;
    this.type = this.isMatrixMode ? 'matrix' : 'terminal';
    this.markDirty();
  }

  protected renderCanvas(_delta: number): void {
    const ctx = this.context;
    const w = this.canvas.width;
    const h = this.canvas.height;

    if (this.isMatrixMode) {
      // Semi-transparent fade for matrix rain trails
      ctx.fillStyle = 'rgba(5, 10, 6, 0.16)';
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#00ff66';
      ctx.font = '14px "JetBrains Mono", monospace';

      const fontSize = 16;
      for (let i = 0; i < this.drops.length; i++) {
        const char = this.chars[Math.floor(Math.random() * this.chars.length)];
        const x = i * fontSize;
        const y = this.drops[i] * fontSize;

        // Bright white head character
        ctx.fillStyle = '#ffffff';
        ctx.fillText(char, x, y);

        // Green character behind head
        ctx.fillStyle = '#00ff66';
        if (y > fontSize) {
          const trailChar = this.chars[Math.floor(Math.random() * this.chars.length)];
          ctx.fillText(trailChar, x, y - fontSize);
        }

        if (y > h && Math.random() > 0.975) {
          this.drops[i] = 0;
        }
        this.drops[i]++;
      }
    } else {
      // Unix System Diagnostic Log Mode
      ctx.fillStyle = '#0a0d14';
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 12px "JetBrains Mono", monospace';
      ctx.fillText('root@aurahq-cluster-node:~$ systemctl status', 16, 24);
      ctx.strokeStyle = '#1e293b';
      ctx.strokeRect(10, 34, w - 20, h - 44);

      ctx.fillStyle = '#22c55e';
      ctx.font = '12px "JetBrains Mono", monospace';
      this.logs.forEach((log, idx) => {
        ctx.fillText(`> [${idx}] ${log}`, 20, 60 + idx * 24);
      });

      // Flashing cursor
      if (Math.floor(this.totalElapsed * 2) % 2 === 0) {
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(20, 60 + this.logs.length * 24 - 10, 10, 14);
      }
    }
  }
}

/**
 * 4. KioskScreen: Interactive Welcome Kiosk for Reception Lobby
 */
export class KioskScreen extends BaseDynamicScreen {
  public currentPage: number = 0;
  private pages = [
    { title: 'WELCOME TO AURA CORP', sub: 'Interactive Digital Twin Experience', items: ['🏢 4 Functional Zones Available', '🧭 Dual FPS / Overview Camera', '🔊 Pure Web Audio Synth Built-In'] },
    { title: 'BUILDING DIRECTORY', sub: 'Floor 14 Virtual Map Guide', items: ['Zone 1: Welcome Reception & Lounge', 'Zone 2: Open Workstations Pods', 'Zone 3: Glass Conference Room', 'Zone 4: Executive Café & Bar'] },
    { title: 'TODAY AT AURA', sub: 'Active Events & Schedules', items: ['10:00 AM: Executive Q3 Review', '02:00 PM: Agentic AI Engineering Sync', '04:30 PM: Tech Showcase in Lounge'] }
  ];

  constructor(id = 'reception_kiosk_screen') {
    super(id, 'slides', 512, 384, 15);
  }

  public nextPage(): void {
    this.currentPage = (this.currentPage + 1) % this.pages.length;
    this.markDirty();
  }

  protected renderCanvas(_delta: number): void {
    const ctx = this.context;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const p = this.pages[this.currentPage];

    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, w, h);

    // Glowing Header
    const grad = ctx.createLinearGradient(0, 0, w, 50);
    grad.addColorStop(0, '#0284c7');
    grad.addColorStop(1, '#0369a1');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, 44);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px Inter, sans-serif';
    ctx.fillText('AURA CORP KIOSK', 16, 28);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillText(`PAGE ${this.currentPage + 1}/${this.pages.length}`, w - 100, 28);

    // Content
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 20px Inter, sans-serif';
    ctx.fillText(p.title, 20, 85);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px Inter, sans-serif';
    ctx.fillText(p.sub, 20, 110);

    p.items.forEach((item, idx) => {
      const iy = 145 + idx * 55;
      ctx.fillStyle = 'rgba(30, 41, 59, 0.7)';
      ctx.fillRect(20, iy, w - 40, 44);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.strokeRect(20, iy, w - 40, 44);

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '14px Inter, sans-serif';
      ctx.fillText(item, 36, iy + 27);
    });

    // Touch button
    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(w - 180, h - 45, 160, 32);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillText('TAP TO CYCLE [E]', w - 160, h - 24);
  }
}

/**
 * Text wrapping utility for 2D Canvas rendering
 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
  const words = text.split(' ');
  let line = '';

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    if (testWidth > maxWidth && n > 0) {
      ctx.fillText(line, x, y);
      line = words[n] + ' ';
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, y);
}
